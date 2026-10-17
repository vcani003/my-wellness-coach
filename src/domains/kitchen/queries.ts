/**
 * Kitchen reads (backend-data.md §6): state, version, changes since a version, and a recipe.
 * Every function takes a `KitchenScope`, so the membership check can't be skipped.
 * Reads never throw because of bad or missing rows (0018).
 */
import { and, asc, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { changeSets, items, kitchens, mealIdeas } from "@/db/schema";
import type { Queryable } from "@/db/client";
import { ChangeSetSummary, type ChangeSetSummary as ChangeSetSummaryT } from "@/contracts/apply-result";
import type { BatchRow, KitchenState, RecipeView, ShoppingItemRow } from "@/contracts/kitchen-state";
import { MealIdea, type MealIdea as MealIdeaT } from "@/contracts/stream";
import type { Fact } from "@/contracts/common";
import { computeAllergenFlags } from "@/shared/profile/allergens";
import { loadNames } from "@/shared/identity";
import { listMembers, type KitchenScope } from "@/shared/membership";
import { loadProfiles } from "@/shared/profile/store";
import type { Restriction } from "@/shared/profile/state";
import type { Via } from "@/shared/events/types";
import { actorRef, buildKitchenState, buildRecipeView } from "./read-model";
import type { KitchenEntities } from "./state";
import { loadKitchenEntities } from "./store";
import { computeUseItUpSignals, type UseItUpSignal } from "./use-it-up";
import type { WeekNeeds } from "@/contracts/week-plan";
import { computeWeekNeeds, weekNeedsRange } from "./week-needs";

export { computeUseItUpSignals, signalFor, type UseItUpSignal } from "./use-it-up";
export { findPastMealsByTitle, listPastMeals } from "./past-meals";

export async function getKitchenVersion(db: Queryable, scope: KitchenScope): Promise<number> {
  const rows = await db.select({ version: kitchens.version }).from(kitchens).where(eq(kitchens.id, scope.kitchenId));
  return rows[0]?.version ?? 0;
}

function actorIds(kitchen: KitchenEntities): string[] {
  const ids = new Set<string>();
  for (const m of Object.values(kitchen.meals)) {
    if (m.noteBy) ids.add(m.noteBy);
    if (m.cookedBy) ids.add(m.cookedBy);
  }
  for (const coll of [kitchen.items, kitchen.meals, kitchen.recipes, kitchen.ticks, kitchen.reviews, kitchen.shopping]) {
    for (const e of Object.values(coll)) {
      ids.add(e.createdBy);
      ids.add(e.updatedBy);
    }
  }
  for (const e of Object.values(kitchen.shopping)) if (e.tickedBy) ids.add(e.tickedBy);
  for (const i of Object.values(kitchen.items)) {
    for (const b of i.batches ?? []) {
      ids.add(b.createdBy);
      ids.add(b.updatedBy);
    }
  }
  return [...ids];
}

/** Everything the read model needs besides the entities. */
export async function loadReadContext(db: Queryable, kitchenId: string, kitchen: KitchenEntities) {
  const members = await listMembers(db, kitchenId);
  const profiles = await loadProfiles(
    db,
    members.map((m) => m.userId),
  );
  const restrictions: Restriction[] = Object.values(profiles.restrictions);
  const names = await loadNames(db, actorIds(kitchen));
  for (const m of members) names.set(m.userId, m.displayName);
  return { names, restrictions };
}

/** Internal: also used by commands inside their transaction. */
export async function readKitchenState(db: Queryable, kitchenId: string): Promise<KitchenState> {
  const [kitchen, versionRows] = await Promise.all([
    loadKitchenEntities(db, kitchenId),
    db.select({ version: kitchens.version }).from(kitchens).where(eq(kitchens.id, kitchenId)),
  ]);
  const ctx = await loadReadContext(db, kitchenId, kitchen);
  return buildKitchenState(kitchen, { kitchenId, version: versionRows[0]?.version ?? 0, ...ctx });
}

export async function getKitchenState(db: Queryable, scope: KitchenScope): Promise<KitchenState> {
  return readKitchenState(db, scope.kitchenId);
}

/** The shared shopping list (0027): open items in the order added. Same as `KitchenState.shoppingList`. */
export async function getShoppingList(db: Queryable, scope: KitchenScope): Promise<ShoppingItemRow[]> {
  return (await readKitchenState(db, scope.kitchenId)).shoppingList;
}

/** The latest recipe for a meal, or null. */
export async function getRecipe(db: Queryable, scope: KitchenScope, mealId: string): Promise<RecipeView | null> {
  const kitchen = await loadKitchenEntities(db, scope.kitchenId);
  const ctx = await loadReadContext(db, scope.kitchenId, kitchen);
  return buildRecipeView(kitchen, mealId, ctx);
}

/**
 * The week's missing ingredients (0045 KOS12): the preview the Add sheet shows, and what the
 * add uses. `today` is the person's own day (their time zone); range defaults in `weekNeedsRange`.
 */
export async function getWeekNeeds(
  db: Queryable,
  scope: KitchenScope,
  args: { today: string; from?: string; to?: string; includeUndated?: boolean },
): Promise<WeekNeeds> {
  const kitchen = await loadKitchenEntities(db, scope.kitchenId);
  return computeWeekNeeds(kitchen, weekNeedsRange(args.today, args));
}

/** Change-set summaries after `sinceVersion`, oldest first: "Since your last visit". */
export async function getChangesSince(
  db: Queryable,
  scope: KitchenScope,
  sinceVersion: number,
): Promise<ChangeSetSummaryT[]> {
  const rows = await db
    .select()
    .from(changeSets)
    .where(
      and(eq(changeSets.kitchenId, scope.kitchenId), isNotNull(changeSets.version), gt(changeSets.version, sinceVersion)),
    )
    .orderBy(asc(changeSets.version));
  const names = await loadNames(
    db,
    rows.map((r) => r.actorId),
  );
  const out: ChangeSetSummaryT[] = [];
  for (const r of rows) {
    const parsed = ChangeSetSummary.safeParse({
      changeSetId: r.id,
      version: r.version,
      actor: actorRef(r.actorId, names),
      via: r.via as Via,
      at: r.createdAt.toISOString(),
      summaries: r.summaries,
      undone: r.revertedByChangeSetId !== null,
    });
    if (parsed.success) out.push(parsed.data);
    else console.error("kitchen.read: dropped a change-set summary", { id: r.id, issues: parsed.error.issues });
  }
  return out;
}

// ─── Meals: ideas and context (0005, 0009, 0013, 0019) ──────────────────────────────────

/** A stored idea set, in card order. */
export interface IdeaSet {
  setId: string;
  basedOnVersion: number;
  ideas: MealIdeaT[];
}

/** Every member's allergies count, whoever is asking (0019); flags are computed on every read. */
async function memberRestrictions(db: Queryable, kitchenId: string): Promise<Restriction[]> {
  const members = await listMembers(db, kitchenId);
  const profiles = await loadProfiles(
    db,
    members.map((m) => m.userId),
  );
  return Object.values(profiles.restrictions);
}

/** Current names of these items in this kitchen (unknown IDs are simply absent). */
export async function itemNames(db: Queryable, kitchenId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.kitchenId, kitchenId), inArray(items.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.id, (r.name as Fact<string>).value]));
}

/**
 * Allergen flags for an idea card: over its name, the kitchen items it uses (by their names, so
 * an idea using the kitchen's shrimp is flagged even if its name doesn't say so) and what's missing.
 */
export function ideaFlags(
  idea: { name: string; uses: string[]; missing: string[] },
  names: Map<string, string>,
  restrictions: Restriction[],
) {
  const used = idea.uses.flatMap((id) => (names.has(id) ? [names.get(id)!] : []));
  return computeAllergenFlags([idea.name, ...used, ...idea.missing], restrictions);
}

type IdeaDbRow = typeof mealIdeas.$inferSelect;

async function toIdeaSet(db: Queryable, kitchenId: string, rows: IdeaDbRow[]): Promise<IdeaSet | null> {
  if (rows.length === 0) return null;
  const [restrictions, names] = await Promise.all([
    memberRestrictions(db, kitchenId),
    itemNames(db, kitchenId, rows.flatMap((r) => r.uses)),
  ]);
  const ideas: MealIdeaT[] = [];
  for (const r of [...rows].sort((a, b) => a.position - b.position)) {
    const parsed = MealIdea.safeParse({
      ideaId: r.id,
      name: r.name,
      why: r.why,
      uses: r.uses,
      missing: r.missing,
      allergenFlags: ideaFlags(r, names, restrictions),
    });
    if (parsed.success) ideas.push(parsed.data);
    else console.error("kitchen.read: dropped a meal idea", { id: r.id, issues: parsed.error.issues });
  }
  return { setId: rows[0].setId, basedOnVersion: rows[0].basedOnVersion, ideas };
}

/** One stored idea set, in card order, or null. */
export async function getIdeaSet(db: Queryable, scope: KitchenScope, setId: string): Promise<IdeaSet | null> {
  const rows = await db
    .select()
    .from(mealIdeas)
    .where(and(eq(mealIdeas.kitchenId, scope.kitchenId), eq(mealIdeas.setId, setId)));
  return toIdeaSet(db, scope.kitchenId, rows);
}

/**
 * The idea cards THIS user was last shown in this kitchen, in card order (0013), so "the second
 * one" resolves. Chats are private (H2), so another member's cards never count. Null = none yet.
 */
export async function getLatestIdeaSet(db: Queryable, scope: KitchenScope): Promise<IdeaSet | null> {
  const [latest] = await db
    .select({ setId: mealIdeas.setId })
    .from(mealIdeas)
    .where(and(eq(mealIdeas.kitchenId, scope.kitchenId), eq(mealIdeas.createdBy, scope.userId)))
    .orderBy(desc(mealIdeas.createdAt), desc(mealIdeas.position))
    .limit(1);
  return latest ? getIdeaSet(db, scope, latest.setId) : null;
}

/** What every idea or recipe call needs besides the kitchen (ai.md §2, 0012, 0019). */
export interface MealProfileContext {
  /** Members with display names, so an allergy line can say whose it is. */
  members: { userId: string; name: string }[];
  /** Every member's allergies and diets, each with the person's own note (0019). */
  restrictions: Restriction[];
  /** The asker's lasting preferences only, as said (0012). */
  preferences: string[];
}

export async function getMealProfileContext(db: Queryable, scope: KitchenScope): Promise<MealProfileContext> {
  const members = await listMembers(db, scope.kitchenId);
  const profiles = await loadProfiles(
    db,
    members.map((m) => m.userId),
  );
  return {
    members: members.map((m) => ({ userId: m.userId, name: m.displayName })),
    restrictions: Object.values(profiles.restrictions),
    preferences: Object.values(profiles.preferences)
      .filter((p) => p.userId === scope.userId)
      .map((p) => p.statement.value),
  };
}

/** Whether a proposal ID was already applied in this kitchen (a retried follow-up). */
export async function wasApplied(db: Queryable, scope: KitchenScope, proposalId: string): Promise<boolean> {
  const rows = await db
    .select({ id: changeSets.id })
    .from(changeSets)
    .where(and(eq(changeSets.kitchenId, scope.kitchenId), eq(changeSets.proposalId, proposalId)))
    .limit(1);
  return rows.length > 0;
}

/** One stored idea card's content, for writing its recipe or refining it; null if unknown here. */
export async function getIdea(
  db: Queryable,
  scope: KitchenScope,
  ideaId: string,
): Promise<{ name: string; why: string; uses: string[]; missing: string[]; notes?: string } | null> {
  const [row] = await db
    .select({ name: mealIdeas.name, why: mealIdeas.why, uses: mealIdeas.uses, missing: mealIdeas.missing, notes: mealIdeas.notes })
    .from(mealIdeas)
    .where(and(eq(mealIdeas.kitchenId, scope.kitchenId), eq(mealIdeas.id, ideaId)))
    .limit(1);
  if (!row) return null;
  const { notes, ...rest } = row;
  return notes ? { ...rest, notes } : rest;
}

// ─── Batches and "use it up" (0025) ───────────────────────────────────────────────────

/** An item's open batches, oldest first (the view-only list behind the row). Null = no such current item. */
export async function getItemBatches(db: Queryable, scope: KitchenScope, itemId: string): Promise<BatchRow[] | null> {
  const state = await getKitchenState(db, scope);
  return state.items.find((i) => i.id === itemId)?.batches ?? null;
}

/** What the meal AI ranks "use it up" on: oldest batch, defrosted, Low (0025, AI8). */
export async function getUseItUpSignals(db: Queryable, scope: KitchenScope, now: Date = new Date()): Promise<UseItUpSignal[]> {
  return computeUseItUpSignals(await getKitchenState(db, scope), now);
}
