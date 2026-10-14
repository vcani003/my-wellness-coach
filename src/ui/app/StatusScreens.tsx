"use client";
/** Whole-screen states: first load, and "no session" (sign-in isn't built yet). */
import { useTranslations } from "next-intl";

export function AppLoading() {
  const t = useTranslations("app");
  return (
    <main aria-busy="true" className="flex min-h-dvh items-center justify-center p-6">
      <p className="text-body text-text-muted">{t("loading")}</p>
    </main>
  );
}

export function NoSession() {
  const t = useTranslations("app.noSession");
  return (
    <main className="mx-auto flex min-h-dvh max-w-prose flex-col justify-center gap-2 p-6">
      <h1 className="text-heading font-strong">{t("title")}</h1>
      <p className="text-body text-text-muted">{t("body")}</p>
    </main>
  );
}
