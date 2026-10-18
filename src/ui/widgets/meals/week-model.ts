/**
 * The pure parts of the dated week plan (0045 KOS1, 0058) and the week's missing ingredients
 * (KOS12). The grouping itself is the backend's pure `buildWeekPlan` (src/shared/week-plan.ts),
 * so the phone shows exactly what the AI answers for "what are we eating this week?".
 */
import type { WeekNeeds, WeekNeedsItem, WeekPlan } from "@/contracts/week-plan";
import { addDays, daysBetween } from "@/shared/plan-dates";

/** "today" / "tomorrow" / "yesterday" for those days, else null (the date is shown instead). */
export function relativeDay(date: string, today: string): "today" | "tomorrow" | "yesterday" | null {
  const d = daysBetween(today, date);
  return d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : null;
}

/** Every day the picker offers: the plan window (yesterday to 21 days ahead), in order. */
export function dayOptions(window: WeekPlan["window"]): string[] {
  const count = daysBetween(window.from, window.to) + 1;
  return Array.from({ length: Math.max(0, Math.min(count, 60)) }, (_, i) => addDays(window.from, i));
}

/** Meals with a day somewhere in the plan (the week, earlier or later). */
export function datedCount(week: WeekPlan): number {
  return week.days.reduce((n, d) => n + d.mealIds.length, 0) + week.earlier.length + week.later.length;
}

/**
 * "No day yet" goes first when nothing has a day: every kitchen planned before KOS1, so its meals
 * aren't pushed under seven empty days. Once one meal has a day, the week leads.
 */
export function undatedFirst(week: WeekPlan): boolean {
  return week.undated.length > 0 && datedCount(week) === 0;
}

// ─── KOS12: the week's missing ingredients ─────────────────────────────────────────────

export interface NeedsGroups {
  /** Not on the list yet: pre-selected. */
  need: WeekNeedsItem[];
  /** Already on the list: muted, no box (the Restock pattern, 0054 SS3). */
  onList: WeekNeedsItem[];
}

export function needsGroups(needs: WeekNeeds): NeedsGroups {
  return { need: needs.items.filter((i) => !i.onList), onList: needs.items.filter((i) => i.onList) };
}

/** Pre-selection: everything not already on the list, by standard name. */
export function preselectedNeeds(needs: WeekNeeds): Set<string> {
  return new Set(needs.items.filter((i) => !i.onList).map((i) => i.standardName));
}

/** What Add sends: the chosen ones still not on the list, named as the recipe wrote them. */
export function chosenNeedNames(needs: WeekNeeds, selected: ReadonlySet<string>): string[] {
  return needs.items.filter((i) => selected.has(i.standardName) && !i.onList).map((i) => i.name);
}

/** Planned meals in the range with no recipe yet ("Tacos has no recipe yet"), in plan order. */
export function noRecipeTitles(needs: WeekNeeds): string[] {
  return needs.meals.filter((m) => !m.hasRecipe).map((m) => m.title);
}
