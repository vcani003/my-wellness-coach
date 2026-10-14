/**
 * The widget registry: the one seam between the workspace and the assistants' widgets (0004).
 * A future widget (e.g. Fitness) is one new folder under src/ui/widgets/ plus one line here.
 * Order here is the default order; your own turns move the widget they changed to the top.
 */
import { kitchenWidgets } from "@/ui/widgets/kitchen";
import { mealIdeasWidget, mealPlanWidget } from "@/ui/widgets/meals";
import { shoppingWidgets } from "@/ui/widgets/shopping";
import type { WidgetDef } from "./types";

export const registry: readonly WidgetDef[] = [
  ...kitchenWidgets,
  ...shoppingWidgets,
  mealIdeasWidget,
  mealPlanWidget,
];
