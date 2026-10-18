/**
 * "Stand-in AI · not Claude" (0059 PF6): shown only when the server's stand-in interpreter is the
 * one answering (`selectInterpreterKind() === "fake"`), so nobody mistakes its canned replies for
 * the real assistant. Calm info colours (info-bg / info-text, AA), not an alert: it's a fact
 * about the build, not a problem. Screen readers hear the explanation too.
 */
import { useTranslations } from "next-intl";
import type { InterpreterKind } from "@/ai";

/** Only the stand-in says so; the real AI (and the "not set up" stub, which says so in chat) don't. */
export function isStandIn(kind: InterpreterKind): boolean {
  return kind === "fake";
}

export function StandInBadge({ className = "" }: { className?: string }) {
  const t = useTranslations("chat");
  return (
    <p
      data-stand-in=""
      className={`rounded-button bg-info-bg px-3 py-1 text-caption font-strong whitespace-nowrap text-info-text ${className}`}
    >
      {t("standIn")}
      <span className="sr-only">. {t("standInDetail")}</span>
    </p>
  );
}
