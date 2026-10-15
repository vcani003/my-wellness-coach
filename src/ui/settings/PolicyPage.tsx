"use client";
/**
 * The privacy policy and terms (0015): plain-language placeholder text from en.json
 * (`policy.privacy`, `policy.terms`), clearly marked as needing a real review before any public
 * launch. Linked from Settings; a plain page with a way back.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BackIcon } from "@/ui/primitives/icons";

interface Section {
  heading: string;
  body: string;
}

export function PolicyPage({ which }: { which: "privacy" | "terms" }) {
  const t = useTranslations("policy");
  const raw: unknown = t.raw(`${which}.sections`);
  const sections = Array.isArray(raw) ? (raw as Section[]).filter((s) => s && typeof s.heading === "string" && typeof s.body === "string") : [];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-prose flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <Link href="/settings" className="btn btn-small self-start">
        <BackIcon aria-hidden="true" className="size-icon" />
        {t("back")}
      </Link>
      <h1 className="text-display font-medium">{t(`${which}.title`)}</h1>
      <p role="note" className="rounded-md bg-warning-bg px-4 py-3 text-small text-warning-text">
        {t("placeholder")}
      </p>
      <p className="text-body">{t(`${which}.intro`)}</p>
      {sections.map((s) => (
        <section key={s.heading} className="card flex flex-col gap-1 px-5 py-4">
          <h2 className="text-title font-medium">{s.heading}</h2>
          <p className="text-body">{s.body}</p>
        </section>
      ))}
    </main>
  );
}
