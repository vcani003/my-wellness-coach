/**
 * Builds the KitchenState the UI and AI read (backend-data.md §6), defensively (0018):
 * - a missing referenced row (meal, actor, item) comes back as `{ id, missing: true }`;
 * - each row is checked with its Zod schema on the way out; a row that fails is left out and
 *   logged, and the rest is returned.
 * Pure, so it never throws for bad data.
 */
import type { z } from "zod";
import type { AllergenFlag, MealRef } from "@/contracts/common";
import {
  ItemRow,
  MealRow,
  type KitchenState,
  RecipeView,
  ReviewRow,
  ShoppingItemRow,
  StapleRow,
  TickRow,
} from "@/contracts/kitchen-state";
import { stapleNeed, type NeedContext } from "@/shared/staples";
import { actorRef, type NameDirectory } from "@/shared/identity";
import { computeAllergenFlags } from "@/shared/profile/allergens";
import type { Restriction } from "@/shared/profile/state";
import { resolveItem } from "./validate";
import { ACTIVE_STATUSES } from "./lifecycle";
import { openBatches } from "./batches";
import { effectiveCategory } from "./categories";
import type { KitchenEntities, Meal, Recipe, Review } from "./state";

export interface ReadContext {
  kitchenId: string;
  version: number;
  /** userId → display name, for anyone who may appear as an actor (+ who deleted their data). */
  names: NameDirectory;
  /** Every current member's restrictions: allergies count whoever is asking (0019). */
  restrictions: Restriction[];
}

export { actorRef };

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

function audit(e: { createdAt: string; createdBy: string; updatedAt: string; updatedBy: string }, names: NameDirectory) {
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
      // Open batches only, oldest first (0025); closed ones stay in history.
      (i) => ({
        ...i,
        // CAT1: items saved before categories read as the kitchen's guess (never written back).
        category: effectiveCategory(i, kitchen),
        batches: openBatches(i).map((b) => ({ ...b, ...audit(b, names) })),
        ...audit(i, names),
      }),
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

  // A shopping-list card shows only what's still open on the list (named as on the list now), and
  // drops out once nothing is: bought in chat, removed, or added with "Done shopping". An Undo
  // that puts items back on the list brings them back here too.
  const reviewItems = (r: Review) =>
    r.origin !== "shopping-list"
      ? r.items
      : r.items.flatMap((e) => {
          const entry = e.shoppingItemId ? kitchen.shopping[e.shoppingItemId] : undefined;
          return entry?.status === "open" ? [{ ...e, name: entry.name.value }] : [];
        });
  const toReview = checked(
    ReviewRow,
    safeMap(
      Object.values(kitchen.reviews)
        .filter((r) => r.status === "pending")
        .map((r) => ({ r, items: reviewItems(r) }))
        .filter(({ r, items }) => r.origin !== "shopping-list" || items.length > 0),
      ({ r, items }) => ({
        id: r.id,
        kind: r.kind,
        origin: r.origin,
        ...(r.mealId !== undefined ? { meal: mealRef(r.mealId, kitchen) } : {}),
        items,
        status: r.status,
        ...audit(r, names),
      }),
      "review",
    ),
    "review",
  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // The shopping list (0027): open items, in the order they were added.
  const shoppingList = checked(
    ShoppingItemRow,
    safeMap(
      Object.values(kitchen.shopping)
        .filter((e) => e.status === "open")
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
      (e) => ({
        id: e.id,
        name: e.name,
        standardName: e.standardName,
        ...(e.quantity ? { quantity: e.quantity } : {}),
        ...(e.store ? { store: e.store } : {}),
        source: e.source,
        ...(e.tickedAt && e.tickedBy ? { ticked: { by: actorRef(e.tickedBy, names), at: e.tickedAt } } : {}),
        ...audit(e, names),
      }),
      "shopping",
    ),
    "shopping",
  );

  // Staples (0054): each one's need is computed now from the kitchen and the list (SS3).
  const needs = needContext(kitchen);
  const staples = checked(
    StapleRow,
    safeMap(
      Object.values(kitchen.staples ?? {}).sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.standardName.localeCompare(b.standardName),
      ),
      (s) => ({
        id: s.standardName,
        name: s.name,
        standardName: s.standardName,
        ...(s.store ? { store: s.store } : {}),
        ...stapleNeed({ name: s.name.value, standardName: s.standardName }, needs),
        ...audit(s, names),
      }),
      "staple",
    ),
    "staple",
  );

  return { kitchenId: ctx.kitchenId, version: ctx.version, items, meals, plan, ticks, toReview, shoppingList, staples };
}

/** What a staple's need is computed from (0054): items in the kitchen, items that are Out, the open list. */
export function needContext(kitchen: KitchenEntities): NeedContext {
  const all = Object.values(kitchen.items);
  const isOpen = (i: (typeof all)[number]) => openBatches(i).length > 0;
  return {
    current: all.filter(isOpen).map((i) => ({
      id: i.id,
      name: i.name.value,
      standardName: i.standardName,
      ...(i.stock && i.stock.value !== "out" ? { stock: i.stock.value } : {}),
    })),
    out: all.filter((i) => !isOpen(i)).map((i) => ({ name: i.name.value, standardName: i.standardName })),
    list: Object.values(kitchen.shopping)
      .filter((e) => e.status === "open")
      .map((e) => ({ id: e.id, name: e.name.value, standardName: e.standardName })),
  };
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
        return {
          name: ing.name,
          ...(ing.amount ? { amount: ing.amount } : {}),
          ...(ing.basic ? { basic: true } : {}),
          ...(item ? { item } : {}),
        };
      }),
      steps: recipe.steps,
      basicsAssumed: recipe.basicsAssumed,
      allergenFlags: computeAllergenFlags(
        [meal?.title ?? "", ...recipe.ingredients.map((i) => i.name)].filter(Boolean),
        ctx.restrictions,
      ),
      // RBX3: an older note with no writer recorded reads as the cook's.
      ...(meal?.note
        ? { note: { text: meal.note, by: actorRef(meal.noteBy ?? meal.cookedBy ?? meal.updatedBy, ctx.names) } }
        : {}),
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
