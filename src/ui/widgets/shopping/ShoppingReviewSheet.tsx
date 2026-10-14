"use client";
/**
 * The shopping list's To review card, reopened (ux.md §3, §10): the same "Add to your kitchen?"
 * sheet, with the card's items (those still on the list) all pre-selected. Add runs Done
 * shopping's path for the chosen ones and closes the card, in one change set with one Undo.
 * Skip closes the card and leaves the list as it is. Do later just closes: it stays in To review.
 */
import { useLocale, useTranslations } from "next-intl";
import type { RefObject } from "react";
import type { ReviewRow } from "@/contracts/kitchen-state";
import { itemName } from "@/ui/fallbacks";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { DoneShoppingSheet } from "./DoneShoppingSheet";
import { shownTicked } from "./model";
import { useAddFromList, type AddedFromList } from "./useAddFromList";
import { useTickQueue } from "./useTickQueue";

export function ShoppingReviewSheet({
  review,
  open,
  onClose,
  onAdded,
  onSkipped,
  finalFocus,
}: {
  /** The card last opened; kept while the sheet closes, even if the card has just gone. */
  review: ReviewRow | null;
  open: boolean;
  onClose: () => void;
  onAdded: (added: AddedFromList) => void;
  onSkipped: () => void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const actions = useKitchenActions();
  const { snapshot } = useKitchenData();
  const { pending } = useTickQueue();
  const addFromList = useAddFromList();
  const list = snapshot.state?.shoppingList ?? [];
  const items = (review?.items ?? []).flatMap((e) => {
    const row = list.find((i) => i.id === e.shoppingItemId);
    return row ? [{ id: row.id, name: itemName(row.name.value, t, locale), ticked: shownTicked(row, pending.get(row.id)) }] : [];
  });

  const add = async (ids: string[]) => {
    if (!review) return false;
    const added = await addFromList(ids, review.id);
    if (added) onAdded(added);
    return Boolean(added);
  };
  const skip = async () => {
    if (!review) return false;
    try {
      const res = await actions.resolveReview(review.id, "skipped");
      if (!res.ok || !res.result.applied.length) return false;
      actions.showOwn(res.result);
      onSkipped();
      return true;
    } catch {
      return false;
    }
  };

  return (
    <DoneShoppingSheet open={open} items={items} preselect="all" onClose={onClose} onAdd={add} onSkip={skip} finalFocus={finalFocus} />
  );
}
