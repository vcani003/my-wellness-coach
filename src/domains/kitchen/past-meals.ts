/**
 * "Cooked before" (0040 A1; RB1, RB3, RB5, RB8, RB9) and the title lookup chat uses to ask "The
 * one from 15 Oct, or a new one?" (B1, RB7).
 *
 * One database query reads only this kitchen's Done meals (indexed on kitchen + status) with their
 * cooked recipe's version and ingredients: never the whole kitchen or its history. Folding
 * (case and accents, 0032's normaliser), grouping and matching then run in code, because
 * Postgres's accent-stripping extension isn't available on every database we run (PGlite). At
 * household scale that's a few hundred short rows. If it grows, a folded search column can move
 * the matching into SQL without changing this interface.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { meals, recipes } from "@/db/schema";
import {
  PAST_MEALS_DEFAULT_LIMIT,
  PAST_MEALS_MAX_LIMIT,
  PastMeal,
  type PastMeal as PastMealT,
} from "@/contracts/past-meals";
import type { RecipeIngredient } from "@/contracts/operations";
import { actorRef, loadNames } from "@/shared/identity";
import { matchesSearchWords, nameSearchWords } from "@/shared/item-search";
import { listMembers, type KitchenScope } from "@/shared/membership";
import { computeAllergenFlags } from "@/shared/profile/allergens";
import type { Restriction } from "@/shared/profile/state";
import { loadProfiles } from "@/shared/profile/store";
import { FILLER, foldText } from "@/shared/text";
import { ACTIVE_STATUSES } from "./lifecycle";

/** One Done meal, as read for the list. */
export interface DoneMealRow {
  mealId: string;
  title: string;
  cookedAt: Date;
  /** Who marked it Done; null on a row from before migration 0011 (then `updatedBy`). */
  cookedBy: string | null;
  updatedBy: string;
  note: string | null;
  /** Who wrote the note; null on a row from before migration 0011 (then the cook). */
  noteBy: string | null;
  recipe: { id: string; version: number; source: "user" | "ai"; ingredients: RecipeIngredient[] } | null;
}

/** One dish (RB3): its Done meals, newest first. */
export interface DishGroup {
  key: string;
  cooks: DoneMealRow[];
}

/** The grouping key: the title folded (case, accents, punctuation, spacing). */
export const dishKey = (title: string) => foldText(title);

async function loadDoneMeals(db: Queryable, kitchenId: string): Promise<DoneMealRow[]> {
  const rows = await db
    .select({
      mealId: meals.id,
      title: meals.title,
      cookedAt: meals.cookedAt,
      cookedBy: meals.cookedBy,
      updatedAt: meals.updatedAt,
      updatedBy: meals.updatedBy,
      note: meals.note,
      noteBy: meals.noteBy,
      recipeId: recipes.id,
      version: recipes.version,
      source: recipes.source,
      ingredients: recipes.ingredients,
    })
    .from(meals)
    .leftJoin(recipes, and(eq(recipes.kitchenId, meals.kitchenId), eq(recipes.id, meals.recipeId)))
    .where(and(eq(meals.kitchenId, kitchenId), eq(meals.status, "done")))
    .orderBy(desc(meals.cookedAt), desc(meals.id));
  return rows.map((r) => ({
    mealId: r.mealId,
    title: r.title,
    // A Done meal always has `cooked_at`; fall back to its last change rather than drop it (0018).
    cookedAt: r.cookedAt ?? r.updatedAt,
    cookedBy: r.cookedBy,
    updatedBy: r.updatedBy,
    note: r.note,
    noteBy: r.noteBy,
    recipe:
      r.recipeId !== null && r.version !== null
        ? {
            id: r.recipeId,
            version: r.version,
            source: r.source === "user" ? "user" : "ai",
            ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
          }
        : null,
  }));
}

/** RBX1: each dish's live "made again" copy (most recently chosen), by dish key. */
async function loadActiveCopies(db: Queryable, kitchenId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: meals.id, title: meals.title, chosenAt: meals.chosenAt })
    .from(meals)
    .where(
      and(
        eq(meals.kitchenId, kitchenId),
        inArray(meals.status, [...ACTIVE_STATUSES]),
        isNotNull(meals.madeAgainFromMealId),
      ),
    )
    .orderBy(desc(meals.chosenAt), desc(meals.id));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(dishKey(r.title))) out.set(dishKey(r.title), r.id);
  return out;
}

/** Group Done meals by dish, newest dish first; each group's cooks newest first. Pure. */
export function groupDishes(rows: readonly DoneMealRow[]): DishGroup[] {
  const byKey = new Map<string, DoneMealRow[]>();
  for (const row of rows) {
    const key = dishKey(row.title);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const newestFirst = (a: DoneMealRow, b: DoneMealRow) =>
    b.cookedAt.getTime() - a.cookedAt.getTime() || b.mealId.localeCompare(a.mealId);
  return [...byKey.entries()]
    .map(([key, cooks]) => ({ key, cooks: [...cooks].sort(newestFirst) }))
    .sort((a, b) => newestFirst(a.cooks[0], b.cooks[0]));
}

/** RB9: the dish's name, or an ingredient of any of its cooks. Accent- and case-insensitive (0032). */
export function dishMatches(group: DishGroup, q: string): boolean {
  const names = [group.cooks[0].title, ...group.cooks.flatMap((c) => c.recipe?.ingredients.map((i) => i.name) ?? [])];
  return matchesSearchWords(q, nameSearchWords(names));
}

/**
 * B1: does what the person called the dish name this one? Every word they said (minus filler like
 * "the", "that") starts a word of the title: "the curry" and "chicken curry" both name "Chicken
 * curry"; "curry" also names "Thai green curry", so chat asks "Which one?". Code decides, so a
 * past meal is never invented (0040 plan). Nothing left after the filler → no match.
 */
export function titleNames(said: string, title: string): boolean {
  const words = foldText(said)
    .split(" ")
    .filter((w) => w && !FILLER.has(w) && w !== "that" && w !== "again");
  if (words.length === 0) return false;
  return matchesSearchWords(words.join(" "), nameSearchWords([title]));
}

async function memberRestrictions(db: Queryable, kitchenId: string): Promise<{ restrictions: Restriction[]; names: Map<string, string> }> {
  const members = await listMembers(db, kitchenId);
  const profiles = await loadProfiles(
    db,
    members.map((m) => m.userId),
  );
  return { restrictions: Object.values(profiles.restrictions), names: new Map(members.map((m) => [m.userId, m.displayName])) };
}

/** Build the rows; a row that fails its schema is left out and logged (0018). */
async function toPastMeals(db: Queryable, kitchenId: string, groups: DishGroup[]): Promise<PastMealT[]> {
  if (groups.length === 0) return [];
  const [{ restrictions, names: memberNames }, activeCopies] = await Promise.all([
    memberRestrictions(db, kitchenId),
    loadActiveCopies(db, kitchenId),
  ]);
  const cookIds = groups.map((g) => g.cooks[0].cookedBy ?? g.cooks[0].updatedBy);
  const noteIds = groups.map((g, i) => g.cooks[0].noteBy ?? cookIds[i]);
  const names = await loadNames(db, [...cookIds, ...noteIds]);
  for (const [id, name] of memberNames) names.set(id, name);
  const out: PastMealT[] = [];
  for (const [i, g] of groups.entries()) {
    const latest = g.cooks[0];
    try {
      const parsed = PastMeal.safeParse({
        mealId: latest.mealId,
        title: latest.title,
        timesCooked: g.cooks.length,
        lastCookedAt: latest.cookedAt.toISOString(),
        lastCookedBy: actorRef(cookIds[i], names),
        ...(latest.recipe ? { recipe: { id: latest.recipe.id, version: latest.recipe.version, source: latest.recipe.source } } : {}),
        allergenFlags: computeAllergenFlags([latest.title, ...(latest.recipe?.ingredients.map((x) => x.name) ?? [])], restrictions),
        ...(latest.note ? { note: { text: latest.note, by: actorRef(noteIds[i], names) } } : {}),
        ...(activeCopies.has(g.key) ? { activeCopyMealId: activeCopies.get(g.key) } : {}),
      });
      if (parsed.success) out.push(parsed.data);
      else console.error("kitchen.read: dropped a past meal", { mealId: latest.mealId, issues: parsed.error.issues });
    } catch (error) {
      console.error("kitchen.read: could not read a past meal", { mealId: latest.mealId, error });
    }
  }
  return out;
}

const clampLimit = (limit: number | undefined, fallback: number) =>
  Math.max(1, Math.min(PAST_MEALS_MAX_LIMIT, Math.trunc(limit ?? fallback) || fallback));

/**
 * "Cooked before" (0040 A1): the kitchen's Done meals, one row per dish, newest first. Kitchen-wide
 * (RB5): every member sees every cook. `q` matches the name or any ingredient (RB9).
 */
export async function listPastMeals(
  db: Queryable,
  scope: KitchenScope,
  opts: { q?: string; limit?: number } = {},
): Promise<PastMealT[]> {
  const q = opts.q?.trim() ?? "";
  const groups = groupDishes(await loadDoneMeals(db, scope.kitchenId)).filter((g) => !q || dishMatches(g, q));
  return toPastMeals(db, scope.kitchenId, groups.slice(0, clampLimit(opts.limit, PAST_MEALS_DEFAULT_LIMIT)));
}

/**
 * For chat (B1, RB7): the dishes this kitchen has cooked whose title the person named, newest
 * first, with dates from code. None → it's a new dish; one → "The one from 15 Oct, or a new one?";
 * several → "Which one?". Title only: an ingredient never makes a match here.
 */
export async function findPastMealsByTitle(
  db: Queryable,
  scope: KitchenScope,
  said: string,
  opts: { limit?: number } = {},
): Promise<PastMealT[]> {
  const groups = groupDishes(await loadDoneMeals(db, scope.kitchenId)).filter((g) => titleNames(said, g.cooks[0].title));
  return toPastMeals(db, scope.kitchenId, groups.slice(0, clampLimit(opts.limit, 5)));
}
