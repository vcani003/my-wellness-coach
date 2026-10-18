"use client";
/**
 * **Add these to my list** under a staples answer (0054 SS6, ux.md §10): "what staples do I need?"
 * is answered by code from the saved staples, and the stream's `staples` event names the needed
 * ones. One tap is `restockStaples` (the Restock action): one change set, each under its usual
 * store, with a "What changed" receipt and one Undo in its place.
 * - Staples that went on the list since (you, the other person, Restock) are left out of the tap;
 *   once none are left, the button goes away.
 * - Live only (SS9): saved chat doesn't keep it, but typing "yes" still works.
 * - Off while offline (0044: item buttons need a connection until KOS7). Failures say so in
 *   place and change nothing (0018).
 */
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { StaplesAnswer } from "@/contracts/stream";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import { useKitchenData } from "@/ui/sync/KitchenDataContext";
import { useOnline } from "@/ui/sync/useOnline";
import { toReceipt, type Receipt as ReceiptModel } from "./chat-reducer";
import { useFormatMsg } from "./format-msg";
import { Receipt } from "./Receipt";
import { useReceiptUndo } from "./useReceiptUndo";

type Phase = { kind: "idle" | "pending" | "failed" } | { kind: "added"; receipt: ReceiptModel };

export function StaplesAnswerAdd({ items }: { items: StaplesAnswer["items"] }) {
  const t = useTranslations("staples.answer");
  const formatMsg = useFormatMsg();
  const format = useFormatter();
  const announce = useAnnounce();
  const actions = useKitchenActions();
  const { snapshot } = useKitchenData();
  const online = useOnline();
  const undoReceipt = useReceiptUndo();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const receiptRef = useRef<HTMLDivElement>(null);
  const focusReceipt = useRef(false);

  useEffect(() => {
    if (phase.kind !== "added" || !focusReceipt.current) return;
    focusReceipt.current = false;
    receiptRef.current?.focus();
  }, [phase]);

  if (phase.kind === "added") {
    const receipt = phase.receipt;
    const undo = () => void undoReceipt(receipt, (undo) => setPhase({ kind: "added", receipt: { ...receipt, undo } }));
    return (
      <div ref={receiptRef} tabIndex={-1} data-staples-answer="added" className="w-full outline-none">
        <Receipt receipt={receipt} onUndo={undo} />
      </div>
    );
  }

  // Only what still needs adding: a staple that went on the list since (or was removed) is left out.
  const staples = snapshot.state?.staples ?? [];
  const open = items.filter((i) => staples.some((s) => s.id === i.stapleId && s.need !== "on-list"));
  if (open.length === 0) return null;

  const offline = !online || snapshot.status === "stale" || snapshot.status === "error";
  const pending = phase.kind === "pending";
  const names = format.list(open.map((i) => i.name), { type: "conjunction" });
  const add = async () => {
    if (pending || offline) return;
    setPhase({ kind: "pending" });
    try {
      const res = await actions.restockStaples(open.map((i) => i.stapleId));
      if (res.ok && res.result.applied.length) {
        actions.showOwn(res.result, { highlight: true });
        focusReceipt.current = true;
        setPhase({ kind: "added", receipt: toReceipt(res.result) });
        announce(res.result.applied.map((a) => formatMsg(a.summary, "plain")).join(", "));
        return;
      }
    } catch {
      // fall through
    }
    setPhase({ kind: "failed" });
    announce(t("failed"));
  };

  return (
    <div data-staples-answer="offer" className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void add()}
        disabled={offline}
        aria-disabled={pending || undefined}
        aria-label={t("addLabel", { names })}
        className="btn btn-primary btn-small"
      >
        {pending ? t("adding") : t("add")}
      </button>
      {phase.kind === "failed" && <p className="text-small text-error-text">{t("failed")}</p>}
    </div>
  );
}
