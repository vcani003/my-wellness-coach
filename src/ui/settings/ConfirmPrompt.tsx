"use client";
/**
 * Levi's "please confirm" prompt (0019 AI7): when another member saved an allergy or diet for
 * you and you haven't confirmed it, one calm banner on the home screen links to Settings.
 * Not blocking; **Not now** hides it for this browser session (a new one shows again).
 *
 * `ConfirmPromptProvider` holds the list for the whole main layout, so confirming or removing in
 * Settings clears the banner without a reload.
 */
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { actorName, sentenceCase } from "@/ui/fallbacks";
import { CloseIcon } from "@/ui/primitives/icons";
import { dismissedSnapshot, parseDismissed, REMEMBER_HEADING_ID, subscribeDismissed, writeDismissed, type PendingConfirm } from "./model";

interface ConfirmPromptValue {
  pending: PendingConfirm[];
  setPending(next: PendingConfirm[]): void;
  /** Open the chat with this text in the composer (Edit note fixes it in chat, 0007). */
  fillComposer(text: string): void;
}

const Ctx = createContext<ConfirmPromptValue>({ pending: [], setPending: () => {}, fillComposer: () => {} });
export const useConfirmPrompt = () => useContext(Ctx);

export function ConfirmPromptProvider({
  initial,
  fillComposer,
  children,
}: {
  initial: PendingConfirm[];
  fillComposer: (text: string) => void;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(initial);
  return <Ctx.Provider value={{ pending, setPending, fillComposer }}>{children}</Ctx.Provider>;
}

export function ConfirmBanner() {
  const t = useTranslations("settings.verify");
  const tAll = useTranslations();
  const locale = useLocale();
  const { pending } = useConfirmPrompt();
  // sessionStorage doesn't exist on the server: null there, so the banner appears after hydration.
  const raw = useSyncExternalStore(subscribeDismissed, dismissedSnapshot, () => null);
  const dismissed = raw === null ? null : parseDismissed(raw);

  const shown = dismissed ? pending.filter((p) => !dismissed.includes(p.id)) : [];
  if (!shown.length) return null;

  const first = shown[0];
  const names = [...new Set(shown.map((p) => actorName(p.addedBy, tAll)))];
  const who = sentenceCase(new Intl.ListFormat(locale, { type: "conjunction" }).format(names), locale);
  const text =
    shown.length === 1
      ? t("one", { name: who, subject: first.subject, kind: tAll("settings.remember.kindWord", { kind: first.kind }) })
      : t("many", { name: who, count: shown.length });

  const dismiss = () => {
    const next = [...new Set([...(dismissed ?? []), ...shown.map((p) => p.id)])];
    writeDismissed(next);
    // The button is about to go: keep focus in the workspace, never lost on <body>.
    requestAnimationFrame(() => document.getElementById("workspace")?.focus());
  };

  return (
    <section
      aria-label={t("label")}
      data-testid="confirm-banner"
      className="mb-3 flex items-start gap-3 rounded-md bg-surface-raised px-4 py-3 shadow-card"
    >
      <p className="flex-1 py-2 text-small">
        {text}{" "}
        <Link href={`/settings#${REMEMBER_HEADING_ID}`} className="font-strong text-accent-text underline underline-offset-2">
          {shown.length === 1 ? t("link") : t("linkMany")}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="-mr-2 flex min-h-tap shrink-0 items-center gap-1 rounded-button px-2 text-small font-medium text-text-muted"
      >
        <CloseIcon aria-hidden="true" className="size-icon-sm" />
        <span>{t("dismiss")}</span>
      </button>
    </section>
  );
}
