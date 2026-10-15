/**
 * The Shopping list's place (0027, ux.md §10; Kitchen OS dock "List"). The places registry imports
 * this; nothing else in the shell knows about shopping.
 */
import { ListIcon } from "@/ui/primitives/icons";
import type { PlaceDef } from "@/ui/places/types";
import { ListPlace, SHOPPING_WIDGET_ID } from "./ShoppingWidget";

export const listPlace: PlaceDef = {
  id: "list",
  href: "/list",
  labelKey: "places.list",
  titleKey: "shopping.title",
  Icon: ListIcon,
  owns: (path) => path === "/list" || path.startsWith("/list/"),
  wantsFocus: (ref) => ref.kind === "shopping",
  hosts: [SHOPPING_WIDGET_ID],
  Component: ListPlace,
};
