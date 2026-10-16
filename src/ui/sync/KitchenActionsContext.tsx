"use client";
/**
 * Buttons that change the kitchen without chat (backend-data.md §6 server actions). The app
 * provides the real server actions; component tests provide fakes. Each call already carries the
 * kitchen, a fresh tap ID and the version on screen.
 */
import { createContext, useContext } from "react";
import type { ApplyResult } from "@/contracts/apply-result";
import type { ActionResult } from "@/app/actions";
import type { ShoppingSource, StockLevel } from "@/contracts/common";

export interface KitchenActions {
  kitchenId: string;
  tickShopping(shoppingItemId: string, ticked: boolean): Promise<ActionResult>;
  removeShopping(shoppingItemId: string): Promise<ActionResult>;
  finishShopping(shoppingItemIds: string[]): Promise<ActionResult>;
  /** "Do later" on the Done-shopping sheet: the chosen items wait in the Kitchen's To review. */
  queueShoppingForLater(shoppingItemIds: string[]): Promise<ActionResult>;
  /** Add (`done`, with the chosen list items) or Skip on a To review card. */
  resolveReview(reviewId: string, outcome: "done" | "skipped", shoppingItemIds?: string[]): Promise<ActionResult>;
  undo(changeSetId: string): Promise<ActionResult>;
  /** The receipt's batch choice (0025): "Those are gone" closes the older batches; undoable. */
  closeBatch(itemId: string, batchIds: string[]): Promise<ActionResult>;
  /** "Still have them": the older batches stay and the choice goes away (a soft change, no Undo). */
  keepOlderBatch(itemId: string, batchIds: string[]): Promise<ActionResult>;
  /** Plenty · Some · Low · Out (KOS4). Without `batchId` it sets the whole item. One change set with Undo. */
  setStockLevel(itemId: string, level: StockLevel, batchId?: string): Promise<ActionResult>;
  /** One-tap adds to the shopping list, e.g. the Low/Out offer "Add rice to my list" (SL3). */
  addToList(source: ShoppingSource, items: { name: string }[]): Promise<ActionResult>;
  /** Show a saved button change now; `highlight` marks its rows New / Updated. */
  showOwn(result: ApplyResult, opts?: { highlight?: boolean }): void;
  /** Remember that you used this widget, so a phone reopens with it on top (ux.md §10). */
  touched(widgetId: string): void;
}

const Ctx = createContext<KitchenActions | null>(null);
export const KitchenActionsProvider = Ctx.Provider;

export function useKitchenActions(): KitchenActions {
  const value = useContext(Ctx);
  if (!value) throw new Error("useKitchenActions must be used inside KitchenActionsProvider");
  return value;
}
