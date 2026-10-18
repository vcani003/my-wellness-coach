/**
 * The dated week plan (0045 KOS1) and the week's missing ingredients (KOS12), as read models.
 * Pure Zod; no server-only imports. `buildWeekPlan` (src/shared/week-plan.ts) builds a WeekPlan
 * from KitchenState on the client or server; WeekNeeds comes from the server (it needs recipes).
 */
import { z } from "zod";
import { Id, PlanDate } from "./common";

/** One day of the week view: the meals planned for it, in plan order (cooking first). */
export const WeekPlanDay = z.object({ date: PlanDate, mealIds: z.array(Id) });
export type WeekPlanDay = z.infer<typeof WeekPlanDay>;

/**
 * The plan grouped by day, ready for a week view. Every planned or cooking meal is in exactly one
 * group: a day in `days`, `earlier` (dated before `from`, e.g. yesterday), `later` (after `to`), or
 * `undated` (the list as before KOS1). Within each group, plan order.
 */
export const WeekPlan = z.object({
  /** Today for the person reading (their time zone). */
  today: PlanDate,
  from: PlanDate,
  to: PlanDate,
  /** Every day from `from` to `to`, empty days included. */
  days: z.array(WeekPlanDay),
  earlier: z.array(Id),
  later: z.array(Id),
  undated: z.array(Id),
  /** The days a meal may be planned for: yesterday to 21 days ahead (KOS1). For the date picker. */
  window: z.object({ from: PlanDate, to: PlanDate }),
});
export type WeekPlan = z.infer<typeof WeekPlan>;

/** A planned meal the week's needs were collected from. */
export const WeekNeedsMeal = z.object({
  mealId: Id,
  title: z.string(),
  /** Absent = undated. */
  plannedFor: PlanDate.optional(),
  /** false: no recipe yet, so its ingredients aren't known (the UI can say so). */
  hasRecipe: z.boolean(),
});
export type WeekNeedsMeal = z.infer<typeof WeekNeedsMeal>;

/** One missing ingredient, merged across meals by standard name. */
export const WeekNeedsItem = z.object({
  /** As written in the first recipe that needs it. */
  name: z.string(),
  standardName: z.string(),
  /** The meals that need it, in plan order. */
  meals: z.array(z.object({ mealId: Id, title: z.string() })),
  /** Already open on the shopping list: shown muted and not pre-selected (like Restock, 0054 SS3). */
  onList: z.boolean(),
});
export type WeekNeedsItem = z.infer<typeof WeekNeedsItem>;

/**
 * KOS12 "Add the week's missing ingredients to the list": the preview (and what Add uses).
 * Ingredients of the planned meals in the range that aren't in the kitchen and aren't assumed
 * basics: each recipe's **Need** group (0013, 0027), merged.
 */
export const WeekNeeds = z.object({
  from: PlanDate,
  to: PlanDate,
  includeUndated: z.boolean(),
  meals: z.array(WeekNeedsMeal),
  items: z.array(WeekNeedsItem),
});
export type WeekNeeds = z.infer<typeof WeekNeeds>;
