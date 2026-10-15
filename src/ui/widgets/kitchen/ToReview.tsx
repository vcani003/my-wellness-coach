"use client";
/**
 * To review (ux.md §3, decision 0013): at the top of the Kitchen widget, with a count, one row
 * per postponed sheet. Tapping a shopping-list card ("3 items to add · Shopping list") reopens
 * "Add to your kitchen?"; tapping a meal's "Update your kitchen · Spinach omelette" reopens that
 * sheet (when the meal screens are there).
 * The result of Add (with Undo) or Skip shows here until your next message, like the list's notes.
 */
import { usePlaceMemory } from "@/ui/places/PlaceMemory";
import { useTranslations } from "next-intl";
import { useState, type RefObject } from "react";
import type { ReviewRow } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { UndoIcon } from "@/ui/primitives/icons";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useMealsOptional } from "@/ui/widgets/meals/MealsContext";
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
  const meals = useMealsOptional();
  const [opened, setOpened] = useState<ReviewRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Kept while you visit other places (Today and the Kitchen share it), so Undo stays (PlaceMemory).
  const [notice, setNotice] = usePlaceMemory<Notice | null>("kitchen.review.notice", null);
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

  /** A meal's after-cooking card reopens "Update your kitchen" with its ingredients. */
  const openAfterCooking = (r: ReviewRow) => {
    if (!meals || !r.meal || "missing" in r.meal) return;
    meals.openUpdateKitchen({
      mealId: r.meal.id,
      title: r.meal.title,
      reviewId: r.id,
      items: r.items.flatMap((i) => (i.itemId ? [{ itemId: i.itemId, name: i.name }] : [])),
    });
  };

  return (
    <>
      <MealNoticeLine />
      {currentNotice && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-success-bg px-4 py-2 text-small text-success-text">
          <span>{currentNotice.text}</span>
          {currentNotice.undo && (
            <button
              type="button"
              aria-label={currentNotice.undo.label}
              onClick={() => void undo(currentNotice.undo!.changeSetId)}
              className="btn-quiet"
            >
              <UndoIcon aria-hidden="true" className="size-icon-sm" />
              {t("shopping.undo")}
            </button>
          )}
        </p>
      )}
      {reviews.length > 0 && (
        <section aria-labelledby="kitchen-to-review" data-group="to-review" className="card flex flex-col gap-2 px-4 py-4">
          <h3 id="kitchen-to-review" className="eyebrow px-1">
            <span aria-hidden="true">{t("kitchen.review.titleCount", { count: reviews.length })}</span>
            <span className="sr-only">{t("kitchen.review.title")}</span>
          </h3>
          <ul className="flex flex-col gap-2">
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
                    className="flex min-h-tap w-full items-center rounded-md bg-surface-soft px-4 py-2 text-left text-body font-strong text-text-default"
                  >
                    {label(r)}
                  </button>
                ) : meals && r.kind === "after-cooking" && r.meal && !("missing" in r.meal) ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => openAfterCooking(r)}
                    className="flex min-h-tap w-full items-center rounded-md bg-surface-soft px-4 py-2 text-left text-body font-strong text-text-default"
                  >
                    {label(r)}
                  </button>
                ) : (
                  <p className="flex min-h-tap items-center px-4 text-body">{label(r)}</p>
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

/**
 * The latest "Update your kitchen" result ("Updated your kitchen after Pho: 1 running low.") with
 * its Undo, until your next message. Shown on Today, the Kitchen and the Plan, wherever you are.
 */
export function MealNoticeLine() {
  const t = useTranslations();
  const announce = useAnnounce();
  const actions = useKitchenActions();
  const { turn = 0 } = useKitchenData();
  const meals = useMealsOptional();
  const mealNotice = meals?.notice && meals.notice.turn === turn ? meals.notice : null;
  if (!mealNotice) return null;
  return (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-success-bg px-4 py-2 text-small text-success-text">
          <span>{mealNotice.text}</span>
          {mealNotice.undo && (
            <button
              type="button"
              aria-label={mealNotice.undo.label}
              onClick={async () => {
                const u = mealNotice.undo!;
                try {
                  const res = await actions.undo(u.changeSetId);
                  if (res.ok && res.result.applied.length && !res.result.rejected.length) {
                    actions.showOwn(res.result, { highlight: true });
                    meals?.setNotice({ text: t("shopping.undone"), turn });
                    announce(t("shopping.undone"));
                    return;
                  }
                } catch {
                  // fall through
                }
                meals?.setNotice({ text: t("shopping.cantUndo"), turn });
                announce(t("shopping.cantUndo"));
              }}
              className="btn-quiet"
            >
              <UndoIcon aria-hidden="true" className="size-icon-sm" />
              {t("shopping.undo")}
            </button>
          )}
        </p>
  );
}
