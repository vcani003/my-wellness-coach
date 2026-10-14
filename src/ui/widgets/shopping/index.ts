/**
 * The Shopping list widget (0027, ux.md §10). The workspace registry imports this list; nothing
 * else in the workspace knows about shopping.
 */
import type { KitchenState } from "@/contracts/kitchen-state";
import type { WidgetDef } from "@/ui/workspace/types";
import { SHOPPING_WIDGET_ID, ShoppingSummary, ShoppingWidget } from "./ShoppingWidget";

/**
 * Appears on its first item and then stays for the session, so emptying it shows
 * "Your list is clear" instead of vanishing (ux.md §10). A new session with an empty list hides it.
 */
const seen = new Set<string>();
export function shoppingPresent(state: KitchenState | null): boolean {
  if (!state) return false;
  // The server is shared by every request: only the browser remembers "this session".
  if (typeof window === "undefined") return state.shoppingList.length > 0;
  if (state.shoppingList.length > 0) seen.add(state.kitchenId);
  return seen.has(state.kitchenId);
}

export const shoppingListWidget: WidgetDef = {
  id: SHOPPING_WIDGET_ID,
  domain: "kitchen",
  lifetime: "lasting",
  titleKey: "shopping.title",
  isPresent: shoppingPresent,
  wantsFocus: (ref) => ref.kind === "shopping",
  Summary: ShoppingSummary,
  Component: ShoppingWidget,
};

export const shoppingWidgets: WidgetDef[] = [shoppingListWidget];
