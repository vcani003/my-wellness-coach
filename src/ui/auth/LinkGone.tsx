"use client";
/**
 * "This link no longer works" (SU1 Rec): an invite or reset link that's unknown, used or expired.
 * The server deliberately doesn't say which, so neither do we. Calm, with one way forward.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { AuthCard, quietLinkClass } from "./fields";

export function LinkGone({ focusHeading = false }: { focusHeading?: boolean }) {
  const t = useTranslations("auth.gone");
  const ref = useRef<HTMLDivElement>(null);

  // When a form turns into this card, focus would otherwise be lost on the removed button.
  useEffect(() => {
    if (focusHeading) ref.current?.focus();
  }, [focusHeading]);

  return (
    <div ref={ref} tabIndex={-1} className="flex w-full max-w-sm justify-center outline-none">
      <AuthCard title={t("title")} intro={t("body")}>
        <Link href="/unlock" className={`${quietLinkClass} mt-4`}>
          {t("signIn")}
        </Link>
      </AuthCard>
    </div>
  );
}
