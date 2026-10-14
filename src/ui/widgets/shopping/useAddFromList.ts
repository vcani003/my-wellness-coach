"use client";
/**
 * Put chosen shopping-list items into the kitchen: from the Done-shopping sheet, or from the
 * shopping list's To review card (`reviewId`). Both go through Done shopping's rules on the
 * server, which only move ticked items, so unticked ones are ticked first (ux.md §10: the sheet
 * lets you choose ones you forgot to tick). Returns what to show afterwards, or null if nothing changed.
 */
import { useLocale, useTranslations } from "next-intl";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useTickQueue } from "./useTickQueue";

export interface AddedFromList {
  changeSetId: string;
  /** "Added 2 to your kitchen. 3 things are still on your list." */
  text: string;
  /** "Undo: added garlic and ginger to your kitchen" */
  undoLabel: string;
  /** Nothing is left on the list, so `text` already says "Your list is clear." */
  listClear: boolean;
}

export function useAddFromList() {
  const t = useTranslations();
  const locale = useLocale();
  const actions = useKitchenActions();
  const { snapshot } = useKitchenData();
  const { queue } = useTickQueue();
  const list = snapshot.state?.shoppingList ?? [];

  return async (ids: string[], reviewId?: string): Promise<AddedFromList | null> => {
    try {
      await queue.idle();
      for (const id of ids) {
        const item = list.find((i) => i.id === id);
        if (item && !item.ticked) {
          const res = await actions.tickShopping(id, true);
          if (!res.ok || !res.result.state.shoppingList.find((i) => i.id === id)?.ticked) return null;
          actions.showOwn(res.result);
        }
      }
      const res = reviewId ? await actions.resolveReview(reviewId, "done", ids) : await actions.finishShopping(ids);
      if (!res.ok || !res.result.applied.length) return null;
      actions.showOwn(res.result, { highlight: true });
      // Names as said ("garlic"), so the Undo label reads as a sentence.
      const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(
        ids.map((id) => list.find((i) => i.id === id)?.name.value.trim() || t("fallback.unknownItem")),
      );
      return {
        changeSetId: res.result.changeSetId,
        text: t("shopping.done", { count: ids.length, left: res.result.state.shoppingList.length }),
        undoLabel: t("shopping.doneUndoLabel", { names }),
        listClear: res.result.state.shoppingList.length === 0,
      };
    } catch {
      return null;
    }
  };
}
