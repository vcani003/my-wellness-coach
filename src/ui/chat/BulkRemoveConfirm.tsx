"use client";
/**
 * **Yes, remove them · No, keep them** under "That would remove 7 things: … Remove them all?"
 * (0045 KOS16). Each button sends its words as a chat message, exactly as if typed (`useAskLumi`),
 * so the server's one path decides: a yes applies the held change (one receipt, one Undo), a no
 * changes nothing. Shown only while that reply is the last message; off while offline or busy
 * (chat is online only, 0044). Nothing here saves on its own.
 */
import { useTranslations } from "next-intl";
import type { BulkConfirm } from "@/contracts/stream";
import { useAskLumi } from "./AskLumi";

export function BulkRemoveConfirm({ confirm }: { confirm: BulkConfirm }) {
  const t = useTranslations("chat.confirm");
  const { ask, canAsk } = useAskLumi();
  return (
    <div role="group" aria-label={t("label", { count: confirm.count })} data-bulk-confirm className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => ask(t("yes"))} disabled={!canAsk} className="btn btn-primary btn-small">
        {t("yes")}
      </button>
      <button type="button" onClick={() => ask(t("no"))} disabled={!canAsk} className="btn btn-small">
        {t("no")}
      </button>
    </div>
  );
}
