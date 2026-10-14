"use client";
/** Last resort only (0018): each widget has its own boundary, so this should rarely show. */
import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("app.errorPage");
  useEffect(() => {
    console.error("route error", error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-prose flex-col justify-center gap-3 p-6">
      <h1 className="text-heading font-strong">{t("title")}</h1>
      <p className="text-body text-text-muted">{t("body")}</p>
      <button
        type="button"
        onClick={reset}
        className="min-h-tap self-start rounded-button bg-accent-default px-5 font-strong text-text-inverse"
      >
        {t("retry")}
      </button>
    </main>
  );
}
