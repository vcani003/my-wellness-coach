"use client";
/**
 * Client-side providers: translations (next-intl) with the device's own time zone, so
 * "as of 6:42 pm" is local time. Server components don't translate in this milestone.
 */
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { Messages } from "@/lib/i18n";

function deviceTimeZone(): string {
  if (typeof window === "undefined") return "UTC";
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function Providers({ locale, messages, children }: { locale: string; messages: Messages; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={deviceTimeZone()}>
      {children}
    </NextIntlClientProvider>
  );
}
