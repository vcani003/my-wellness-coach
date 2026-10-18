/**
 * The plan grouped by day (0045 KOS1), from KitchenState. Pure and never throws (0018), so the UI
 * can build its week view from the state it already has (offline too) and the AI can answer
 * "what are we eating this week?" from the same code.
 */
import type { KitchenState } from "@/contracts/kitchen-state";
import type { WeekPlan } from "@/contracts/week-plan";
import { addDays, daysBetween, isIsoDay, planWindow, type IsoDay } from "./plan-dates";

export const WEEK_DAYS = 7;

/**
 * `from` defaults to today; `days` (1–42) to 7. Meals come from `state.plan` (cooking first, then
 * planned, by position), so each group keeps plan order.
 */
export function buildWeekPlan(
  state: Pick<KitchenState, "meals" | "plan">,
  today: IsoDay,
  opts: { from?: IsoDay; days?: number } = {},
): WeekPlan {
  const from = opts.from && isIsoDay(opts.from) ? opts.from : today;
  const count = Math.min(42, Math.max(1, Math.floor(opts.days ?? WEEK_DAYS)));
  const to = addDays(from, count - 1);
  const days = Array.from({ length: count }, (_, i) => ({ date: addDays(from, i), mealIds: [] as string[] }));
  const byId = new Map(state.meals.map((m) => [m.id, m]));
  const earlier: string[] = [];
  const later: string[] = [];
  const undated: string[] = [];
  for (const id of state.plan) {
    const meal = byId.get(id);
    if (!meal) continue;
    const date = meal.plannedFor;
    if (!date || !isIsoDay(date)) {
      undated.push(id);
      continue;
    }
    const offset = daysBetween(from, date);
    if (offset < 0) earlier.push(id);
    else if (offset >= count) later.push(id);
    else days[offset].mealIds.push(id);
  }
  return { today, from, to, days, earlier, later, undated, window: planWindow(today) };
}
