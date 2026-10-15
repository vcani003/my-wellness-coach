"use client";
/** Whole-screen states: first load, and "no session". Lumi is decoration; the words say it. */
import { useTranslations } from "next-intl";
import { LUMI_ART } from "@/ui/lumi/Lumi";

export function AppLoading() {
  const t = useTranslations("app");
  return (
    <main aria-busy="true" className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
      <img src={LUMI_ART.thinking} alt="" width={96} height={96} className="size-sticker-lg" />
      <p className="text-body text-text-muted">{t("loading")}</p>
    </main>
  );
}

export function NoSession() {
  const t = useTranslations("app.noSession");
  return (
    <main className="unlock-page">
      <div className="card-stitched flex w-full max-w-sm flex-col items-center gap-2 px-6 py-7 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG */}
        <img src={LUMI_ART.sleeping} alt="" width={96} height={96} className="size-sticker-lg" />
        <h1 className="font-heading text-display font-medium">{t("title")}</h1>
        <p className="text-body text-text-muted">{t("body")}</p>
      </div>
    </main>
  );
}
