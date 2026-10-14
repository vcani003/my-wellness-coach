"use client";
/**
 * The "What changed" receipt (0007, 0011, ux.md §4): one line per saved change, rejected parts
 * shown in place, and one Undo for the card, named for what it undoes. Undo appears only on your
 * own receipts (0017). After Undo the lines are struck through with "Undone".
 */
import { useTranslations } from "next-intl";
import { CheckIcon, UndoIcon } from "@/ui/primitives/icons";
import type { Receipt as ReceiptModel } from "./chat-reducer";
import { useFormatMsg } from "./format-msg";

export function Receipt({
  receipt,
  onUndo,
  onView,
}: {
  receipt: ReceiptModel;
  onUndo?: (changeSetId: string) => void;
  /** Phone only: show the change in the workspace. */
  onView?: () => void;
}) {
  const t = useTranslations("receipt");
  const formatMsg = useFormatMsg();
  const undone = receipt.undo === "done";
  const savedSomething = receipt.applied.some((a) => a.refs.length > 0);
  const plainChanges = receipt.applied.map((a) => formatMsg(a.summary, "plain")).join(", ");
  const canUndo = Boolean(onUndo) && receipt.undoable && savedSomething && !undone && receipt.undo !== "refused";

  return (
    <section
      aria-label={t("title")}
      data-receipt={receipt.changeSetId}
      className="mt-2 rounded-md border border-border-default bg-surface-raised p-3 shadow-card"
    >
      <h3 className="text-caption font-strong text-text-muted">{t("title")}</h3>
      <ul className="mt-1 flex flex-col gap-1">
        {receipt.applied.map((a) => {
          const display = formatMsg(a.summary);
          const plain = formatMsg(a.summary, "plain");
          return (
            <li key={a.opId} className={`flex items-start gap-2 text-small ${undone ? "text-text-muted line-through" : ""}`}>
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

      {(canUndo || undone || receipt.undo === "refused" || onView) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {undone && <span className="text-small font-medium text-text-muted">{t("undone")}</span>}
          {receipt.undo === "refused" && (
            <p className="rounded-sm bg-warning-bg px-3 py-2 text-small text-warning-text">{t("cantUndo")}</p>
          )}
          {canUndo && (
            <button
              type="button"
              onClick={() => onUndo?.(receipt.changeSetId)}
              disabled={receipt.undo === "pending"}
              aria-label={t("undoLabel", { changes: plainChanges })}
              className="flex min-h-tap items-center gap-1 rounded-button px-3 text-small font-strong text-accent-text disabled:opacity-60"
            >
              <UndoIcon aria-hidden="true" className="size-icon-sm" />
              {receipt.undo === "pending" ? t("undoing") : t("undo")}
            </button>
          )}
          {onView && savedSomething && !undone && (
            <button
              type="button"
              onClick={onView}
              aria-label={t("viewLabel")}
              className="ml-auto min-h-tap rounded-button px-3 text-small font-strong text-accent-text desk:hidden"
            >
              {t("view")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
