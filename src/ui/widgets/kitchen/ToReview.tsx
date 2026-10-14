"use client";
/**
 * To review (ux.md §3, decision 0013): at the top of the Kitchen widget, with a count, one row
 * per postponed sheet. Tapping a shopping-list card ("3 items to add · Shopping list") reopens
 * "Add to your kitchen?". A meal's card is listed by name; its sheets come with the meal screens.
 * The result of Add (with Undo) or Skip shows here until your next message, like the list's notes.
 */
import { useTranslations } from "next-intl";
import { useState, type RefObject } from "react";
import type { ReviewRow } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { UndoIcon } from "@/ui/primitives/icons";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { ShoppingReviewSheet } from "@/ui/widgets/shopping/ShoppingReviewSheet";

interface Notice {
  text: string;
  undo?: { changeSetId: string; label: string };
  turn: number;
}

export function ToReview({ reviews, finalFocus }: { reviews: ReviewRow[]; finalFocus: RefObject<HTMLElement | null> }) {
  const t = useTranslations();
  const announce = useAnnounce();
  const actions = useKitchenActions();
  const { turn = 0 } = useKitchenData();
  const [opened, setOpened] = useState<ReviewRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const currentNotice = notice && notice.turn === turn ? notice : null;

  const label = (r: ReviewRow) => {
    const from =
      r.origin === "shopping-list"
        ? t("kitchen.review.shoppingList")
        : r.meal && !("missing" in r.meal)
          ? r.meal.title
          : t("fallback.unknownMeal");
    return r.kind === "add-to-kitchen"
      ? t("kitchen.review.addItems", { count: r.items.length, from })
      : t("kitchen.review.update", { from });
  };

  const say = (next: Notice) => {
    setNotice(next);
    announce(next.text);
  };

  const undo = async (changeSetId: string) => {
    try {
      const res = await actions.undo(changeSetId);
      if (res.ok && res.result.applied.length) {
        actions.showOwn(res.result);
        say({ text: t("shopping.undone"), turn });
        return;
      }
    } catch {
      // fall through
    }
    say({ text: t("shopping.cantUndo"), turn });
  };

  return (
    <>
      {currentNotice && (
        <p className="flex flex-wrap items-center gap-2 rounded-sm bg-success-bg px-3 py-2 text-small text-success-text">
          <span>{currentNotice.text}</span>
          {currentNotice.undo && (
            <button
              type="button"
              aria-label={currentNotice.undo.label}
              onClick={() => void undo(currentNotice.undo!.changeSetId)}
              className="flex min-h-tap items-center gap-1 rounded-button px-3 font-strong text-accent-text"
            >
              <UndoIcon aria-hidden="true" className="size-icon-sm" />
              {t("shopping.undo")}
            </button>
          )}
        </p>
      )}
      {reviews.length > 0 && (
        <section aria-labelledby="kitchen-to-review" data-group="to-review">
          <h3 id="kitchen-to-review" className="mb-1 text-caption font-strong tracking-wide text-text-muted">
            <span aria-hidden="true">{t("kitchen.review.titleCount", { count: reviews.length })}</span>
            <span className="sr-only">{t("kitchen.review.title")}</span>
          </h3>
          <ul className="flex flex-col">
            {reviews.map((r) => (
              <li key={r.id} data-entity-id={r.id}>
                {r.origin === "shopping-list" ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setOpened(r);
                      setSheetOpen(true);
                    }}
                    className="flex min-h-tap w-full items-center rounded-sm px-3 text-left text-body font-medium text-accent-text"
                  >
                    {label(r)}
                  </button>
                ) : (
                  <p className="flex min-h-tap items-center px-3 text-body">{label(r)}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ShoppingReviewSheet
        review={opened}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onAdded={(added) => say({ text: added.text, undo: { changeSetId: added.changeSetId, label: added.undoLabel }, turn })}
        onSkipped={() => say({ text: t("kitchen.review.skipped"), turn })}
        finalFocus={finalFocus}
      />
    </>
  );
}
