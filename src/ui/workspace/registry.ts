/**
 * The widget registry: the one seam between the workspace and the assistants' widgets (0004).
 * A future widget (e.g. Fitness) is one new folder under src/ui/widgets/ plus one line here.
 */
import { kitchenWidgets } from "@/ui/widgets/kitchen";
import type { WidgetDef } from "./types";

export const registry: readonly WidgetDef[] = [...kitchenWidgets];
