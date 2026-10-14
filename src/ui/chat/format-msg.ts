"use client";
/**
 * Turns a backend `Msg {code, params, text}` into on-screen text in the user's language (0015).
 * Unknown codes fall back to the English `text`. `plain` mode gives screen-reader-friendly
 * wording ("moved to the freezer" instead of "→ freezer").
 */
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import type { Msg } from "@/contracts/common";
import { sentenceCase } from "../fallbacks";

export function useFormatMsg() {
  const t = useTranslations();
  const locale = useLocale();
  return useCallback(
    (m: Msg, mode: "display" | "plain" = "display"): string => {
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(m.params)) params[k] = typeof v === "boolean" ? String(v) : v;
      if (typeof params.location === "string" && t.has(`location.${params.location}`)) {
        params.location = t(`location.${params.location}`);
      }
      const keys = mode === "plain" ? [`msgPlain.${m.code}`, `msg.${m.code}`] : [`msg.${m.code}`];
      for (const key of keys) if (t.has(key)) return sentenceCase(t(key, params), locale);
      return sentenceCase(m.text || m.code, locale);
    },
    [t, locale],
  );
}
