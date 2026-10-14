/**
 * The meal widgets (0004, 0013): Meal ideas and Meal plan. The workspace registry imports these;
 * nothing else in the workspace knows about meals. The Recipe is its own route
 * (`/recipe/[mealId]`), not a widget.
 */
import type { KitchenState } from "@/contracts/kitchen-state";
import type { WidgetDef, WidgetSession } from "@/ui/workspace/types";
import { MEAL_IDEAS_WIDGET_ID, MealIdeasSummary, MealIdeasWidget } from "./MealIdeasWidget";
import { MEAL_PLAN_WIDGET_ID, MealPlanSummary, MealPlanWidget } from "./MealPlanWidget";
import type { IdeaSet } from "./session";

/** Present while this session has ideas (or is finding them). They're not saved (0013). */
export function ideasPresent(_state: KitchenState | null, session?: WidgetSession): boolean {
  return Boolean(session?.[MEAL_IDEAS_WIDGET_ID] as IdeaSet | null | undefined);
}

/**
 * Appears on the first planned or cooking meal and stays for the session, so emptying it shows
 * "Nothing planned yet" (ux.md §3). A new session with an empty plan hides it.
 */
const seen = new Set<string>();
export function planPresent(state: KitchenState | null): boolean {
  if (!state) return false;
  if (typeof window === "undefined") return state.plan.length > 0;
  if (state.plan.length > 0) seen.add(state.kitchenId);
  return seen.has(state.kitchenId);
}

export const mealIdeasWidget: WidgetDef = {
  id: MEAL_IDEAS_WIDGET_ID,
  domain: "kitchen",
  lifetime: "session",
  titleKey: "meals.ideas.title",
  isPresent: ideasPresent,
  // Ideas have no saved refs: the app focuses this widget when ideas start streaming.
  wantsFocus: () => false,
  Summary: MealIdeasSummary,
  Component: MealIdeasWidget,
};

export const mealPlanWidget: WidgetDef = {
  id: MEAL_PLAN_WIDGET_ID,
  domain: "kitchen",
  lifetime: "lasting",
  titleKey: "meals.plan.title",
  isPresent: planPresent,
  wantsFocus: (ref) => ref.kind === "meal",
  Summary: MealPlanSummary,
  Component: MealPlanWidget,
};

export { MEAL_IDEAS_WIDGET_ID, MEAL_PLAN_WIDGET_ID };
