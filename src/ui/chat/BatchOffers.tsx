"use client";
/**
 * The receipt's one-tap batch choice (0025, backend-data.md §6): after buying something you
 * already had, "You also had eggs from Oct 2: **Still have them** · **Those are gone**". Never a
 * required question: ignoring it keeps both batches.
 * - Shown only while the older batches are still open and unanswered in the CURRENT kitchen
 *   (`isBatchOfferOpen`), so answering in chat ("the old eggs are gone") or on another receipt hides it.
 * - "Those are gone" → `closeBatch`, then the result in place. Its Undo is the receipt's one Undo
 *   (`onUndoStep`): one Undo per receipt, which steps back the newest change first, like Cmd-Z
 *   (tester run 2026-10-14 found two stacked Undo buttons). Focus moves to that Undo.
 *   "Still have them" → `keepOlderBatch`, a soft change with no Undo (focus moves to the result).
 * - Results and failures are announced through the one polite live region; nothing crashes (0018).
 * - A saved receipt brings its answers back (`answers`, from chat history): the result in place
 *   and, for "Those are gone", the same one Undo, so a reload looks as it did live (tester re-run
 *   2026-10-14, step 28). Being redrawn, it never moves focus.
 */
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplyResult, AppliedOp, BatchOffer } from "@/contracts/apply-result";
import type { BatchAnswer } from "@/contracts/chat-history";
import type { Msg } from "@/contracts/common";
import type { KitchenState } from "@/contracts/kitchen-state";
import { useAnnounce } from "@/ui/a11y/Announcer";
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

/**
 * An answer the receipt's Undo can step back ("Those are gone"). `run` is kept out of state by the
 * receipt, so re-registering the same step never re-renders it.
 */
export interface UndoStep {
  key: string;
  /** What it undoes, in plain words, for the Undo button's name. */
  plain: string;
  pending: boolean;
  /** Redrawn from saved chat rather than just answered: the receipt doesn't move focus to it. */
  saved?: boolean;
  run: () => void;
}
export type OnUndoStep = (key: string, step: UndoStep | null) => void;

export function BatchOffers({
  offers,
  answers = [],
  onUndoStep,
}: {
  offers: BatchOffer[];
  /** A saved receipt's answers (chat history), matched to offers by item and new batch. */
  answers?: readonly BatchAnswer[];
  onUndoStep: OnUndoStep;
}) {
  return (
    <>
      {offers.map((offer) => (
        <BatchOfferChoice
          key={`${offer.itemId}:${offer.newBatchId}`}
          offer={offer}
          saved={answers.find((a) => a.itemId === offer.itemId && a.newBatchId === offer.newBatchId)}
          onUndoStep={onUndoStep}
        />
      ))}
    </>
  );
}

/** What an answer needs: a live ApplyResult or a saved `BatchAnswer`. */
type AnswerResult = Pick<ApplyResult, "changeSetId" | "applied" | "undoable">;

type Phase =
  | { kind: "idle"; failed?: Msg }
  | { kind: "pending"; choice: "keep" | "gone" }
  | { kind: "answered"; choice: "keep" | "gone"; result: AnswerResult; undo: "idle" | "pending" | "refused"; saved?: boolean };

function BatchOfferChoice({ offer, saved, onUndoStep }: { offer: BatchOffer; saved?: BatchAnswer; onUndoStep: OnUndoStep }) {
  const t = useTranslations("receipt");
  const formatMsg = useFormatMsg();
  const words = useBatchOfferWords();
  const announce = useAnnounce();
  const actions = useKitchenActions();
  const { snapshot } = useKitchenData();
  const [phase, setPhase] = useState<Phase>(() =>
    saved ? { kind: "answered", choice: saved.choice, result: saved, undo: "idle", saved: true } : { kind: "idle" },
  );
  const focusNext = useRef<"result" | "gone" | null>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const goneRef = useRef<HTMLButtonElement>(null);

  // The buttons it replaces are gone, so focus moves to what took their place (never to <body>).
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "result") resultRef.current?.focus();
    if (target === "gone") goneRef.current?.focus();
  }, [phase]);

  const undo = async (answered: Extract<Phase, { kind: "answered" }>) => {
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
   };

  // "Those are gone" hands its Undo to the receipt's one Undo button while it can be undone.
  const stepKey = `${offer.itemId}:${offer.newBatchId}`;
  // Runs only when the step itself changes, never on every render: a saved answer re-sent on each
  // render kept the receipt re-rendering until React gave up ("Maximum update depth exceeded",
  // desktop, after a reload). `run` reads the latest answer through a ref so it is never stale.
  const answered = phase.kind === "answered" ? phase : null;
  const stepActive = Boolean(answered && answered.choice === "gone" && answered.result.undoable && answered.undo !== "refused");
  const stepPlain = answered && stepActive ? answered.result.applied.map((a) => formatMsg(a.summary, "plain")).join(", ") : "";
  const stepPending = answered?.undo === "pending";
  const stepSaved = Boolean(answered?.saved);
  const runStep = useRef<() => void>(() => {});
  useEffect(() => {
    runStep.current = () => {
      if (answered) void undo(answered);
    };
  });
  useEffect(() => {
    if (stepActive) {
      onUndoStep(stepKey, {
        key: stepKey,
        plain: stepPlain,
        pending: stepPending,
        ...(stepSaved ? { saved: true } : {}),
        run: () => runStep.current(),
      });
    } else {
      onUndoStep(stepKey, null);
    }
  }, [onUndoStep, stepKey, stepActive, stepPlain, stepPending, stepSaved]);
  useEffect(() => () => onUndoStep(stepKey, null), [onUndoStep, stepKey]);

  const older = openOlder(offer, snapshot.state);

  if (phase.kind === "answered") {
    const lines = phase.result.applied.map((a) => formatMsg(a.summary));
    return (
      <div data-batch-offer={offer.itemId} data-batch-answer={phase.choice} className="mt-2 flex flex-wrap items-center gap-2 border-t border-border-default pt-2">
        <p ref={resultRef} tabIndex={-1} className="text-small outline-none">
          {lines.join(" · ")}
        </p>
        {phase.undo === "refused" && (
          <p className="rounded-md bg-warning-bg px-3 py-2 text-small text-warning-text">{t("cantUndo")}</p>
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
    // An undoable "gone" moves focus to the receipt's Undo (Receipt does that); otherwise to the result.
    focusNext.current = choice === "gone" && outcome.result.undoable ? null : "result";
    setPhase({ kind: "answered", choice, result: outcome.result, undo: "idle" });
    actions.showOwn(outcome.result, { highlight: choice === "gone" });
    announce(outcome.result.applied.map((a) => formatMsg(a.summary, "plain")).join(", "));
  }

  const button = "btn btn-small";
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
        <p className="rounded-md bg-error-bg px-3 py-2 text-small text-error-text">{t("batch.failed")}</p>
      )}
    </div>
  );
}
