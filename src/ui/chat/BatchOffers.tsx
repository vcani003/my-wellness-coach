"use client";
/**
 * The receipt's one-tap batch choice (0025, backend-data.md §6): after buying something you
 * already had, "You also had eggs from Oct 2: **Still have them** · **Those are gone**". Never a
 * required question: ignoring it keeps both batches.
 * - Shown only while the older batches are still open and unanswered in the CURRENT kitchen
 *   (`isBatchOfferOpen`), so answering in chat ("the old eggs are gone") or on another receipt hides it.
 * - "Those are gone" → `closeBatch`, then the result in place with Undo (focus moves to Undo).
 *   "Still have them" → `keepOlderBatch`, a soft change with no Undo (focus moves to the result).
 * - Results and failures are announced through the one polite live region; nothing crashes (0018).
 */
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplyResult, AppliedOp, BatchOffer } from "@/contracts/apply-result";
import type { Msg } from "@/contracts/common";
import type { KitchenState } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { UndoIcon } from "@/ui/primitives/icons";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useFormatMsg } from "./format-msg";

/** Every batch choice in a receipt. */
export function offersOf(applied: readonly AppliedOp[]): BatchOffer[] {
  return applied.flatMap((a) => a.batchOffers ?? []);
}

/**
 * The offer's older batches that are still open and unanswered in `state`, oldest first. Empty
 * once the new batch itself is gone (the purchase was undone), since there's nothing to compare.
 */
export function openOlder(offer: BatchOffer, state: KitchenState | null): BatchOffer["older"] {
  const item = state?.items.find((i) => i.id === offer.itemId);
  if (!item?.batches) return [];
  const open = new Map(item.batches.map((b) => [b.id, b]));
  if (!open.has(offer.newBatchId)) return [];
  return offer.older.filter((o) => {
    const b = open.get(o.batchId);
    return b !== undefined && b.keptAt === undefined;
  });
}

/** "eggs from Oct 2" (or "Oct 2 and Oct 9"), shared by the question, the button names and the announcement. */
export function useBatchOfferWords() {
  const t = useTranslations("receipt.batch");
  const format = useFormatter();
  return useCallback(
    (offer: BatchOffer, older: BatchOffer["older"]) => {
      const dates = format.list(
        older.map((o) => format.dateTime(new Date(o.addedAt), { month: "short", day: "numeric" })),
        { type: "conjunction" },
      );
      return {
        question: t("question", { name: offer.name, dates }),
        which: t("which", { name: offer.name, dates }),
      };
    },
    [t, format],
  );
}

export function BatchOffers({ offers }: { offers: BatchOffer[] }) {
  return (
    <>
      {offers.map((offer) => (
        <BatchOfferChoice key={`${offer.itemId}:${offer.newBatchId}`} offer={offer} />
      ))}
    </>
  );
}

type Phase =
  | { kind: "idle"; failed?: Msg }
  | { kind: "pending"; choice: "keep" | "gone" }
  | { kind: "answered"; choice: "keep" | "gone"; result: ApplyResult; undo: "idle" | "pending" | "refused" };

function BatchOfferChoice({ offer }: { offer: BatchOffer }) {
  const t = useTranslations("receipt");
  const formatMsg = useFormatMsg();
  const words = useBatchOfferWords();
  const announce = useAnnounce();
  const actions = useKitchenActions();
  const { snapshot } = useKitchenData();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const focusNext = useRef<"undo" | "result" | "gone" | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const goneRef = useRef<HTMLButtonElement>(null);

  // The buttons it replaces are gone, so focus moves to what took their place (never to <body>).
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "undo") undoRef.current?.focus();
    if (target === "result") resultRef.current?.focus();
    if (target === "gone") goneRef.current?.focus();
  }, [phase]);

  const older = openOlder(offer, snapshot.state);

  if (phase.kind === "answered") {
    const lines = phase.result.applied.map((a) => formatMsg(a.summary));
    const plain = phase.result.applied.map((a) => formatMsg(a.summary, "plain")).join(", ");
    const canUndo = phase.choice === "gone" && phase.result.undoable && phase.undo !== "refused";
    return (
      <div data-batch-offer={offer.itemId} data-batch-answer={phase.choice} className="mt-2 flex flex-wrap items-center gap-2 border-t border-border-default pt-2">
        <p ref={resultRef} tabIndex={-1} className="text-small outline-none">
          {lines.join(" · ")}
        </p>
        {canUndo && (
          <button
            ref={undoRef}
            type="button"
            aria-label={t("undoLabel", { changes: plain })}
            aria-disabled={phase.undo === "pending" || undefined}
            onClick={() => void undo(phase)}
            className="flex min-h-tap items-center gap-1 rounded-button px-3 text-small font-strong text-accent-text aria-disabled:opacity-60"
          >
            <UndoIcon aria-hidden="true" className="size-icon-sm" />
            {phase.undo === "pending" ? t("undoing") : t("undo")}
          </button>
        )}
        {phase.undo === "refused" && (
          <p className="rounded-sm bg-warning-bg px-3 py-2 text-small text-warning-text">{t("cantUndo")}</p>
        )}
      </div>
    );
  }

  // Answered elsewhere (in chat, on another receipt, or by the other person), or still loading.
  if (older.length === 0) return null;

  const { question, which } = words(offer, older);
  const pending = phase.kind === "pending";
  const questionId = `batch-offer-${offer.itemId}-${offer.newBatchId}`;

  async function choose(choice: "keep" | "gone") {
    if (pending) return;
    setPhase({ kind: "pending", choice });
    const ids = older.map((o) => o.batchId);
    const outcome = await (choice === "gone" ? actions.closeBatch : actions.keepOlderBatch)(offer.itemId, ids).catch(
      () => ({ ok: false as const, reason: { code: "SAVE_FAILED", params: {}, text: "" }, retryable: true }),
    );
    if (!outcome.ok) {
      focusNext.current = "gone";
      setPhase({ kind: "idle", failed: outcome.reason });
      announce(t("batch.failed"));
      return;
    }
    focusNext.current = choice === "gone" && outcome.result.undoable ? "undo" : "result";
    setPhase({ kind: "answered", choice, result: outcome.result, undo: "idle" });
    actions.showOwn(outcome.result, { highlight: choice === "gone" });
    announce(outcome.result.applied.map((a) => formatMsg(a.summary, "plain")).join(", "));
  }

  async function undo(answered: Extract<Phase, { kind: "answered" }>) {
    if (answered.undo === "pending") return;
    setPhase({ ...answered, undo: "pending" });
    const outcome = await actions.undo(answered.result.changeSetId).catch(() => null);
    if (!outcome?.ok) {
      setPhase({ ...answered, undo: "refused" });
      focusNext.current = "result";
      announce(t("cantUndo"));
      return;
    }
    actions.showOwn(outcome.result, { highlight: true });
    // The older batches are open again, so the choice comes back; focus returns to it.
    focusNext.current = "gone";
    setPhase({ kind: "idle" });
    announce(t("announceUndone", { changes: answered.result.applied.map((a) => formatMsg(a.summary, "plain")).join(", ") }));
  }

  const button = "min-h-tap rounded-button border border-border-strong bg-surface-raised px-4 text-small font-medium aria-disabled:opacity-60";
  return (
    <div
      role="group"
      aria-labelledby={questionId}
      data-batch-offer={offer.itemId}
      className="mt-2 flex flex-col gap-2 border-t border-border-default pt-2"
    >
      <p id={questionId} className="text-small">
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={t("batch.keepLabel", { which })}
          aria-disabled={pending || undefined}
          onClick={() => void choose("keep")}
          className={button}
        >
          {pending && phase.choice === "keep" ? t("batch.saving") : t("batch.keep")}
        </button>
        <button
          ref={goneRef}
          type="button"
          aria-label={t("batch.goneLabel", { which })}
          aria-disabled={pending || undefined}
          onClick={() => void choose("gone")}
          className={button}
        >
          {pending && phase.choice === "gone" ? t("batch.saving") : t("batch.gone")}
        </button>
      </div>
      {phase.kind === "idle" && phase.failed && (
        <p className="rounded-sm bg-error-bg px-3 py-2 text-small text-error-text">{t("batch.failed")}</p>
      )}
    </div>
  );
}
