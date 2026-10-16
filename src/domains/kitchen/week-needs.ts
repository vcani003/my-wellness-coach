/**
 * The week's missing ingredients (0045 KOS12), computed from the kitchen's events state. Pure.
 *
 * - Meals: **planned** meals dated in the range (default today to 6 days ahead), plus undated
 *   planned meals unless `includeUndated` is false. Cooking meals are left out: they're already
 *   being made. Plan order.
 * - Ingredients: each recipe's **Need** group, exactly as the recipe screen shows it
 *   (`buildRecipeView` + `isRecipeNeed`): not in the kitchen, not an assumed basic (0019).
 * - Merged by standard name across meals; `onList` when it's already open on the shopping list.
 */
import { isRecipeNeed } from "@/contracts/kitchen-state";
import type { WeekNeeds, WeekNeedsItem, WeekNeedsMeal } from "@/contracts/week-plan";
import { addDays, daysBetween, isIsoDay, type IsoDay } from "@/shared/plan-dates";
import { standardName } from "@/shared/text";
import { buildRecipeView } from "./read-model";
import type { KitchenEntities, Meal } from "./state";

export const WEEK_NEEDS_DAYS = 7;
/** Longest range a caller may ask for: the plan window's length. */
export const WEEK_NEEDS_MAX_DAYS = 23;

export interface WeekNeedsRange {
  from: IsoDay;
  to: IsoDay;
  includeUndated: boolean;
}

/** Defaults and limits: from today, 7 days, undated included; `to` before `from` → `from`. */
export function weekNeedsRange(
  today: IsoDay,
  opts: { from?: string; to?: string; includeUndated?: boolean } = {},
): WeekNeedsRange {
  const from = opts.from && isIsoDay(opts.from) ? opts.from : today;
  let to = opts.to && isIsoDay(opts.to) ? opts.to : addDays(from, WEEK_NEEDS_DAYS - 1);
  if (daysBetween(from, to) < 0) to = from;
  if (daysBetween(from, to) > WEEK_NEEDS_MAX_DAYS - 1) to = addDays(from, WEEK_NEEDS_MAX_DAYS - 1);
  return { from, to, includeUndated: opts.includeUndated ?? true };
}

function inRange(meal: Meal, range: WeekNeedsRange): boolean {
  if (meal.status !== "planned") return false;
  if (!meal.plannedFor) return range.includeUndated;
  return daysBetween(range.from, meal.plannedFor) >= 0 && daysBetween(meal.plannedFor, range.to) >= 0;
}

export function computeWeekNeeds(kitchen: KitchenEntities, range: WeekNeedsRange): WeekNeeds {
  const meals = Object.values(kitchen.meals)
    .filter((m) => inRange(m, range))
    // Dated first by day, then undated; each by plan position (0013).
    .sort(
      (a, b) =>
        (a.plannedFor ? 0 : 1) - (b.plannedFor ? 0 : 1) ||
        (a.plannedFor ?? "").localeCompare(b.plannedFor ?? "") ||
        (a.planPosition ?? 0) - (b.planPosition ?? 0) ||
        a.id.localeCompare(b.id),
    );

  const onList = new Set(
    Object.values(kitchen.shopping)
      .filter((e) => e.status === "open")
      .map((e) => e.standardName),
  );
  const items = new Map<string, WeekNeedsItem>();
  const mealRows: WeekNeedsMeal[] = [];
  for (const meal of meals) {
    let view: ReturnType<typeof buildRecipeView> = null;
    try {
      view = buildRecipeView(kitchen, meal.id, { names: new Map(), restrictions: [] });
    } catch (error) {
      // One bad recipe never sinks the rest (0018).
      console.error("kitchen.weekNeeds: couldn't read a recipe", { mealId: meal.id, error });
    }
    mealRows.push({ mealId: meal.id, title: meal.title, ...(meal.plannedFor ? { plannedFor: meal.plannedFor } : {}), hasRecipe: view !== null });
    if (!view) continue;
    for (const ing of view.ingredients) {
      if (!isRecipeNeed(ing)) continue;
      const std = standardName(ing.name);
      if (!std) continue;
      const entry = items.get(std) ?? { name: ing.name.trim(), standardName: std, meals: [], onList: onList.has(std) };
      if (!entry.meals.some((m) => m.mealId === meal.id)) entry.meals.push({ mealId: meal.id, title: meal.title });
      items.set(std, entry);
    }
  }
  return { ...range, meals: mealRows, items: [...items.values()] };
}
