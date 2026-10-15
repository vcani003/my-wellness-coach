/**
 * The meal places (0004, 0013; Kitchen OS dock "Plan" and "Meals"). The places registry imports
 * these; nothing else in the shell knows about meals. The Recipe is its own route
 * (`/recipe/[mealId]`) and belongs to Meals.
 */
import { MealsIcon, PlanIcon } from "@/ui/primitives/icons";
import type { PlaceDef } from "@/ui/places/types";
import { MEAL_IDEAS_WIDGET_ID } from "./MealIdeasWidget";
import { MealsPlace } from "./MealsPlace";
import { MEAL_PLAN_WIDGET_ID, PlanPlace } from "./MealPlanWidget";

export const planPlace: PlaceDef = {
  id: "plan",
  href: "/plan",
  labelKey: "places.plan",
  titleKey: "meals.plan.title",
  Icon: PlanIcon,
  owns: (path) => path === "/plan" || path.startsWith("/plan/"),
  // Planned or cooking meals show in the plan (0013).
  wantsFocus: (ref) => ref.kind === "meal",
  hosts: [MEAL_PLAN_WIDGET_ID],
  Component: PlanPlace,
};

export const mealsPlace: PlaceDef = {
  id: "meals",
  href: "/meals",
  labelKey: "places.meals",
  titleKey: "meals.title",
  Icon: MealsIcon,
  owns: (path) => path === "/meals" || path.startsWith("/meals/") || path.startsWith("/recipe/"),
  // Ideas have no saved refs: the app points at Meals when ideas start streaming.
  wantsFocus: () => false,
  hosts: [MEAL_IDEAS_WIDGET_ID],
  Component: MealsPlace,
};

export { MEAL_IDEAS_WIDGET_ID, MEAL_PLAN_WIDGET_ID };
