/**
 * Builds the KitchenState the UI and AI read (backend-data.md §6), defensively (0018):
 * - a missing referenced row (meal, actor, item) comes back as `{ id, missing: true }`;
 * - each row is checked with its Zod schema on the way out; a row that fails is left out and
 *   logged, and the rest is returned.
 * Pure, so it never throws for bad data.
 */
import type { z } from "zod";
import type { ActorRef, AllergenFlag, MealRef } from "@/contracts/common";
import {
  ItemRow,
  MealRow,
  type KitchenState,
  RecipeView,
  ReviewRow,
  TickRow,
} from "@/contracts/kitchen-state";
import { computeAllergenFlags } from "@/shared/profile/allergens";
import type { Restriction } from "@/shared/profile/state";
import { resolveItem } from "./validate";
import { ACTIVE_STATUSES } from "./lifecycle";
import type { KitchenEntities, Meal, Recipe } from "./state";

export interface ReadContext {
  kitchenId: string;
  version: number;
  /** userId → display name, for anyone who may appear as an actor. */
  names: ReadonlyMap<string, string>;
  /** Every current member's restrictions: allergies count whoever is asking (0019). */
  restrictions: Restriction[];
}

export function actorRef(id: string, names: ReadonlyMap<string, string>): ActorRef {
  const name = names.get(id);
  return name === undefined ? { id, missing: true } : { id, name };
}

function mealRef(id: string, kitchen: KitchenEntities): MealRef {
  const meal = kitchen.meals[id];
  return meal ? { id, title: meal.title } : { id, missing: true };
}

/** Keep rows that pass their schema; log and drop the rest. */
function checked<S extends z.ZodType>(schema: S, rows: unknown[], what: string): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
    else {
      const id = (row as { id?: unknown })?.id;
      console.error(`kitchen.read: dropped a ${what} row that failed its schema`, { id, issues: parsed.error.issues });
    }
  }
  return out;
}

function audit(e: { createdAt: string; createdBy: string; updatedAt: string; updatedBy: string }, names: ReadonlyMap<string, string>) {
  return {
    createdAt: e.createdAt,
    createdBy: actorRef(e.createdBy, names),
    updatedAt: e.updatedAt,
    updatedBy: actorRef(e.updatedBy, names),
  };
}

export function mealAllergenFlags(meal: Meal, recipe: Recipe | undefined, restrictions: Restriction[]): AllergenFlag[] {
  const names = [meal.title, ...(recipe?.ingredients.map((i) => i.name) ?? [])];
  return computeAllergenFlags(names, restrictions);
}

/** Never throws: anything unexpected in one row only loses that row. */
function safeMap<T, R>(values: T[], fn: (v: T) => R, what: string): unknown[] {
  const out: unknown[] = [];
  for (const v of values) {
    try {
      out.push(fn(v));
    } catch (error) {
      console.error(`kitchen.read: could not read a ${what} row`, { error });
    }
  }
  return out;
}

export function buildKitchenState(kitchen: KitchenEntities, ctx: ReadContext): KitchenState {
  const { names } = ctx;

  const items = checked(
    ItemRow,
    safeMap(
      Object.values(kitchen.items).filter((i) => i.stock?.value !== "out"),
      (i) => ({ ...i, ...audit(i, names) }),
      "item",
    ),
    "item",
  ).sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.standardName.localeCompare(b.standardName) || a.id.localeCompare(b.id));

  const meals = checked(
    MealRow,
    safeMap(
      Object.values(kitchen.meals).filter((m) => ACTIVE_STATUSES.includes(m.status)),
      (m) => {
        const recipe = m.recipeId ? kitchen.recipes[m.recipeId] : undefined;
        const { recipeId: _recipeId, ...rest } = m;
        void _recipeId;
        return {
          ...rest,
          ...(recipe ? { recipe: { id: recipe.id, version: recipe.version, source: recipe.source } } : {}),
          allergenFlags: mealAllergenFlags(m, recipe, ctx.restrictions),
          ...audit(m, names),
        };
      },
      "meal",
    ),
    "meal",
  ).sort((a, b) => a.chosenAt.localeCompare(b.chosenAt) || a.id.localeCompare(b.id));

  // Plan order: cooking first, then planned; each by position (0013).
  const plan = meals
    .filter((m) => m.status === "cooking" || m.status === "planned")
    .sort(
      (a, b) =>
        (a.status === "cooking" ? 0 : 1) - (b.status === "cooking" ? 0 : 1) ||
        (a.planPosition ?? 0) - (b.planPosition ?? 0),
    )
    .map((m) => m.id);

  const ticks = checked(
    TickRow,
    safeMap(
      Object.values(kitchen.ticks),
      (t) => ({ meal: mealRef(t.mealId, kitchen), ingredient: t.ingredient, ...audit(t, names) }),
      "tick",
    ),
    "tick",
  );

  const toReview = checked(
    ReviewRow,
    safeMap(
      Object.values(kitchen.reviews).filter((r) => r.status === "pending"),
      (r) => ({ id: r.id, kind: r.kind, meal: mealRef(r.mealId, kitchen), items: r.items, status: r.status, ...audit(r, names) }),
      "review",
    ),
    "review",
  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { kitchenId: ctx.kitchenId, version: ctx.version, items, meals, plan, ticks, toReview };
}

/** The latest recipe for a meal, with item references resolved defensively. */
export function buildRecipeView(
  kitchen: KitchenEntities,
  mealId: string,
  ctx: Pick<ReadContext, "names" | "restrictions">,
): RecipeView | null {
  const meal = kitchen.meals[mealId];
  const recipe =
    (meal?.recipeId ? kitchen.recipes[meal.recipeId] : undefined) ??
    Object.values(kitchen.recipes)
      .filter((r) => r.mealId === mealId)
      .sort((a, b) => b.version - a.version)[0];
  if (!recipe) return null;
  try {
    const view = {
      id: recipe.id,
      meal: mealRef(mealId, kitchen),
      version: recipe.version,
      source: recipe.source,
      text: recipe.text,
      ingredients: recipe.ingredients.map((ing) => {
        let item: { id: string; name: string } | { id: string; missing: true } | undefined;
        if (ing.itemId) {
          const found = kitchen.items[ing.itemId];
          item = found ? { id: found.id, name: found.name.value } : { id: ing.itemId, missing: true };
        } else if (!ing.basic) {
          const m = resolveItem({ name: ing.name }, kitchen);
          if (m.kind === "found" && m.item.stock?.value !== "out") item = { id: m.item.id, name: m.item.name.value };
        }
        return { name: ing.name, ...(ing.basic ? { basic: true } : {}), ...(item ? { item } : {}) };
      }),
      steps: recipe.steps,
      basicsAssumed: recipe.basicsAssumed,
      allergenFlags: computeAllergenFlags(
        [meal?.title ?? "", ...recipe.ingredients.map((i) => i.name)].filter(Boolean),
        ctx.restrictions,
      ),
      ...audit(recipe, ctx.names),
    };
    const parsed = RecipeView.safeParse(view);
    if (parsed.success) return parsed.data;
    console.error("kitchen.read: recipe failed its schema", { id: recipe.id, issues: parsed.error.issues });
    return null;
  } catch (error) {
    console.error("kitchen.read: could not read recipe", { id: recipe.id, error });
    return null;
  }
}
