"use client";
/**
 * Undo for a "What changed" receipt that a button made (Restock, "Add these to my list", a staple
 * edit), outside the chat's own receipts. One shared path: the receipt goes pending, then Undone
 * (and the kitchen shows the undone state) or "Can't undo this now", announced once (0018).
 */
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useAnnounce } from "@/ui/a11y/Announcer";
import { useKitchenActions } from "@/ui/sync/KitchenActionsContext";
import type { Receipt } from "./chat-reducer";
import { useFormatMsg } from "./format-msg";

export function useReceiptUndo() {
  const t = useTranslations("receipt");
  const formatMsg = useFormatMsg();
  const announce = useAnnounce();
  const actions = useKitchenActions();
  return useCallback(
    async (receipt: Receipt, update: (undo: Receipt["undo"]) => void): Promise<boolean> => {
      if (receipt.undo === "pending" || receipt.undo === "done") return false;
      update("pending");
      try {
        const res = await actions.undo(receipt.changeSetId);
        if (res.ok && res.result.applied.length) {
          actions.showOwn(res.result);
          update("done");
          announce(t("announceUndone", { changes: receipt.applied.map((a) => formatMsg(a.summary, "plain")).join(", ") }));
          return true;
        }
      } catch {
        // fall through: say so in place
      }
      update("refused");
      announce(t("cantUndo"));
      return false;
    },
    [actions, announce, formatMsg, t],
  );
}
