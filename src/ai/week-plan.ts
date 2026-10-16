/**
 * The dated week plan in chat (0045 KOS1, KOS12), shared by the real and the fake interpreter and
 * the turn. Code, never the model, writes these answers:
 * - "What are we eating this week?" is answered from the plan (`buildWeekPlan`, the same grouping
 *   the week view uses): today and the next 6 days, then the undated meals.
 * - "Add what we need for this week's meals" adds the week's missing ingredients (`WeekNeeds`) to
 *   the list in the same change set; "what do we need this week?" lists them and offers to add.
 */
import type { ApplyResult } from "@/contracts/apply-result";
import type { KitchenState } from "@/contracts/kitchen-state";
import type { WeekNeeds } from "@/contracts/week-plan";
import { englishDayLabel, type IsoDay } from "@/shared/plan-dates";
import { buildWeekPlan } from "@/shared/week-plan";

const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

/** Words that ask to put things on the list (rather than just ask what's needed). */
export const WEEK_NEEDS_ADD = /\b(add|put|stick|throw)\b/i;

export const NOTHING_PLANNED_REPLY = "Nothing's planned for this week yet.";
export const WEEK_NEEDS_OFFER = "Want me to add these to your list?";
export const WEEK_NEEDS_NOTHING_REPLY = "You have everything this week's meals need.";
export const WEEK_NEEDS_NO_MEALS_REPLY = "There are no planned meals this week, so there's nothing to add yet.";

/** "Today", "Tomorrow", else "Tue, Oct 20". */
function dayName(date: IsoDay, today: IsoDay, tomorrow: IsoDay): string {
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return englishDayLabel(date);
}

/** "What are we eating this week?": from the plan, by code. */
export function weekPlanAnswer(state: Pick<KitchenState, "meals" | "plan">, today: IsoDay): string {
  const week = buildWeekPlan(state, today);
  const title = new Map(state.meals.map((m) => [m.id, m.title]));
  const names = (ids: string[]) => list(ids.map((id) => title.get(id) ?? "").filter(Boolean));
  const tomorrow = week.days[1]?.date ?? "";
  const lines = week.days.filter((d) => d.mealIds.length > 0).map((d) => `${dayName(d.date, today, tomorrow)}: ${names(d.mealIds)}.`);
  if (week.undated.length) lines.push(`No day yet: ${names(week.undated)}.`);
  return lines.length ? `This week: ${lines.join(" ")}` : NOTHING_PLANNED_REPLY;
}

/** What the meals without a recipe mean for the list, if any. */
function noRecipeNote(needs: WeekNeeds): string {
  const without = needs.meals.filter((m) => !m.hasRecipe).map((m) => m.title);
  if (without.length === 0) return "";
  return ` ${list(without)} ${without.length > 1 ? "don't" : "doesn't"} have a recipe yet, so I can't tell what ${without.length > 1 ? "they need" : "it needs"}.`;
}

/** "What do we need this week?": the missing ingredients, and an offer to add them (never adds). */
export function weekNeedsAnswer(needs: WeekNeeds): string {
  if (needs.meals.length === 0) return WEEK_NEEDS_NO_MEALS_REPLY;
  const toBuy = needs.items.filter((i) => !i.onList).map((i) => i.name);
  const listed = needs.items.filter((i) => i.onList).map((i) => i.name);
  const already = listed.length ? ` Already on your list: ${list(listed)}.` : "";
  if (toBuy.length === 0) return `${WEEK_NEEDS_NOTHING_REPLY}${already}${noRecipeNote(needs)}`;
  return `For this week's meals you need: ${list(toBuy)}.${already}${noRecipeNote(needs)} ${WEEK_NEEDS_OFFER}`;
}

/** After adding the week's needs: what went on the list, from the receipt. */
export function weekNeedsAddedReply(needs: WeekNeeds, result: ApplyResult | null): string {
  if (needs.meals.length === 0) return WEEK_NEEDS_NO_MEALS_REPLY;
  const added = (result?.applied ?? [])
    .filter((a) => a.summary.code === "SHOPPING_ADDED" || a.summary.code === "SHOPPING_ADDED_STORE")
    .map((a) => String(a.summary.params.name ?? ""))
    .filter(Boolean);
  const listed = needs.items.filter((i) => i.onList).map((i) => i.name);
  const already = listed.length ? ` Already on your list: ${list(listed)}.` : "";
  if (added.length === 0) return `${WEEK_NEEDS_NOTHING_REPLY}${already}${noRecipeNote(needs)}`;
  return `Added ${added.length === 1 ? "1 thing" : `${added.length} things`} for this week's meals: ${list(added)}.${already}${noRecipeNote(needs)}`;
}
