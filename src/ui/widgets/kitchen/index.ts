/**
 * The Kitchen domain's widgets (0004). The workspace registry imports this list; nothing else in
 * the workspace knows about food.
 */
import type { WidgetDef } from "@/ui/workspace/types";
import { KitchenSummary, KitchenWidget } from "./KitchenWidget";

export const KITCHEN_WIDGET_ID = "kitchen.items";

export const kitchenItemsWidget: WidgetDef = {
  id: KITCHEN_WIDGET_ID,
  domain: "kitchen",
  lifetime: "lasting",
  titleKey: "kitchen.title",
  // Always shown, so a new user sees the empty state ("Tell me what you've got").
  isPresent: () => true,
  wantsFocus: (ref) => ref.kind === "item",
  Summary: KitchenSummary,
  Component: KitchenWidget,
};

export const kitchenWidgets: WidgetDef[] = [kitchenItemsWidget];
