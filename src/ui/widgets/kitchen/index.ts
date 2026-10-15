/**
 * The Kitchen domain's place (0004, Kitchen OS dock): what's in the kitchen, By place / By type,
 * search, batches, Not sure where. The places registry imports this; nothing else in the shell
 * knows about food. It also adds a card to Today (shared cues, To review, Use it up).
 */
import { KitchenIcon } from "@/ui/primitives/icons";
import type { PlaceDef } from "@/ui/places/types";
import { KitchenToday } from "./KitchenToday";
import { KitchenWidget } from "./KitchenWidget";

export const KITCHEN_WIDGET_ID = "kitchen.items";

export const kitchenPlace: PlaceDef = {
  id: "kitchen",
  href: "/kitchen",
  labelKey: "places.kitchen",
  titleKey: "kitchen.title",
  Icon: KitchenIcon,
  owns: (path) => path === "/kitchen" || path.startsWith("/kitchen/"),
  wantsFocus: (ref) => ref.kind === "item",
  hosts: [KITCHEN_WIDGET_ID],
  Component: KitchenWidget,
  TodayCard: KitchenToday,
};
