"use client";
/**
 * The "What changed" receipt (0007, 0011, ux.md §4): one line per saved change, rejected parts
 * shown in place, and one Undo for the card, named for what it undoes. Undo appears only on your
 * own receipts (0017). After Undo the lines are struck through with "Undone".
 * Never two Undo buttons: an answer given on the receipt ("Those are gone") becomes the newest
 * step, and the one Undo steps that back first, then the purchase (newest first, like Cmd-Z).
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, UndoIcon } from "@/ui/primitives/icons";
import { BatchOffers, offersOf, type OnUndoStep, type UndoStep } from "./BatchOffers";
import type { Receipt as ReceiptModel } from "./chat-reducer";
import { useFormatMsg } from "./format-msg";
import { receiptLines, SHOPPING_GROUP } from "./receipt-lines";

export function Receipt({
  receipt,
  onUndo,
  onView,
  children,
}: {
  receipt: ReceiptModel;
  onUndo?: (changeSetId: string) => void;
  /** Phone only: show the change in the workspace. */
  onView?: () => void;
  /** A one-tap offer under the lines (e.g. "Add rice to my list", SL3); hidden once undone. */
  children?: ReactNode;
}) {
  const t = useTranslations("receipt");
  const tAll = useTranslations();
  const formatAny = useFormatMsg();
  const formatMsg: typeof formatAny = (m, mode) =>
    m.code === SHOPPING_GROUP ? t("shoppingGroup", { store: String(m.params.store), names: String(m.params.names) }) : formatAny(m, mode);
  const lines = receiptLines(receipt.applied, tAll("shopping.anywhere"));
  const undone = receipt.undo === "done";
  const savedSomething = receipt.applied.some((a) => a.refs.length > 0);
  const plainChanges = lines.map((l) => formatMsg(l.summary, "plain")).join(", ");
  const offers = offersOf(receipt.applied);
  const canUndo = Boolean(onUndo) && receipt.undoable && savedSomething && !undone && receipt.undo !== "refused";

  // Answers on this receipt that can be undone, oldest first; the newest is what Undo steps back.
  const [steps, setSteps] = useState<Omit<UndoStep, "run">[]>([]);
  const runs = useRef(new Map<string, () => void>());
  const onUndoStep = useCallback<OnUndoStep>((key, step) => {
    if (step) runs.current.set(key, step.run);
    else runs.current.delete(key);
    setSteps((prev) => {
      const at = prev.findIndex((s) => s.key === key);
      if (!step) return at === -1 ? prev : prev.filter((s) => s.key !== key);
      const next = { key, plain: step.plain, pending: step.pending, ...(step.saved ? { saved: true } : {}) };
      if (at === -1) return [...prev, next];
      const old = prev[at];
      if (old.plain === next.plain && old.pending === next.pending && old.saved === next.saved) return prev;
      return prev.map((s, i) => (i === at ? next : s));
    });
  }, []);
  const step = undone ? undefined : steps.at(-1);

  // A new answer to step back: focus moves to the Undo that now undoes it.
  const undoRef = useRef<HTMLButtonElement>(null);
  const focusedStep = useRef<string | undefined>(undefined);
  useEffect(() => {
    // An answer redrawn from saved chat isn't new, so it never moves focus.
    if (step && step.key !== focusedStep.current && !step.saved) undoRef.current?.focus();
    focusedStep.current = step?.key;
  }, [step]);

  const showUndo = Boolean(step) || canUndo;
  const undoPending = step ? step.pending : receipt.undo === "pending";
  const undoName = t("undoLabel", { changes: step ? step.plain : plainChanges });
  const runUndo = () => {
    if (undoPending) return;
    if (step) runs.current.get(step.key)?.();
    else onUndo?.(receipt.changeSetId);
  };

  return (
    <section
      aria-label={t("title")}
      data-receipt={receipt.changeSetId}
      className="receipt mt-2 px-4 py-3"
    >
      <h3 className="eyebrow font-body">{t("title")}</h3>
      <ul className="mt-1 flex flex-col gap-1">
        {lines.map((line) => {
          const display = formatMsg(line.summary);
          const plain = formatMsg(line.summary, "plain");
          return (
            <li key={line.key} className={`flex items-start gap-2 text-small ${undone ? "text-text-muted line-through" : ""}`}>
              <CheckIcon aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-success-text" />
              {display === plain ? (
                <span>{display}</span>
              ) : (
                <>
                  <span aria-hidden="true">{display}</span>
                  <span className="sr-only">{plain}</span>
                </>
              )}
            </li>
          );
        })}
        {receipt.rejected.map((r) => (
          <li key={r.opId} className="pl-6 text-small text-text-muted">
            {t("notChanged", { reason: formatMsg(r.reason) })}
          </li>
        ))}
      </ul>

      {/* "You also had eggs from Oct 2: Still have them · Those are gone" (0025); gone once the purchase is undone. */}
      {offers.length > 0 && !undone && <BatchOffers offers={offers} answers={receipt.batchAnswers} onUndoStep={onUndoStep} />}
      {!undone && children}

      {(showUndo || undone || receipt.undo === "refused" || onView) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {undone && <span className="text-small font-medium text-text-muted">{t("undone")}</span>}
          {receipt.undo === "refused" && (
            <p className="rounded-md bg-warning-bg px-3 py-2 text-small text-warning-text">{t("cantUndo")}</p>
          )}
          {showUndo && (
            <button
              ref={undoRef}
              type="button"
              onClick={runUndo}
              aria-disabled={undoPending || undefined}
              aria-label={undoName}
              className="btn btn-primary btn-small"
            >
              <UndoIcon aria-hidden="true" className="size-icon-sm" />
              {undoPending ? t("undoing") : t("undo")}
            </button>
          )}
          {onView && savedSomething && !undone && (
            <button
              type="button"
              onClick={onView}
              aria-label={t("viewLabel")}
              className="btn-quiet ml-auto text-small"
            >
              {t("view")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
