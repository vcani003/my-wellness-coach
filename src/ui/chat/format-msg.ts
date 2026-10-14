"use client";
/**
 * Turns a backend `Msg {code, params, text}` into on-screen text in the user's language (0015).
 * Unknown codes fall back to the English `text`. `plain` mode gives screen-reader-friendly
 * wording ("moved to the freezer" instead of "→ freezer"). `msgIcu.*` comes first: the full
 * wording for codes whose backend text is built from flags (ITEM_BATCH_ADDED's "the oldest batch
 * is closed"), which `msg.*` can't carry because it mirrors the plain template (messages.test.ts).
 */
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import type { Msg } from "@/contracts/common";
import { sentenceCase } from "../fallbacks";

type Translate = ReturnType<typeof useTranslations>;

/**
 * Params the backend sends as IDs are shown in the user's language: `location` ("freezer") and,
 * for CAT1's ITEM_CATEGORY / CATEGORY_REMEMBERED, `categoryName` from the `category` ID (the
 * backend's `categoryName` is only the English fallback).
 */
export function localizeParams(params: Record<string, string | number>, t: Translate) {
  if (typeof params.location === "string" && t.has(`location.${params.location}`)) {
    params.location = t(`location.${params.location}`);
  }
  if (typeof params.category === "string" && t.has(`category.${params.category}`)) {
    params.categoryName = t(`category.${params.category}`);
  }
}

export function useFormatMsg() {
  const t = useTranslations();
  const locale = useLocale();
  return useCallback(
    (m: Msg, mode: "display" | "plain" = "display"): string => {
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(m.params)) params[k] = typeof v === "boolean" ? String(v) : v;
      localizeParams(params, t);
      const keys = mode === "plain" ? [`msgPlain.${m.code}`, `msgIcu.${m.code}`, `msg.${m.code}`] : [`msgIcu.${m.code}`, `msg.${m.code}`];
      for (const key of keys) if (t.has(key)) return sentenceCase(t(key, params), locale);
      return sentenceCase(m.text || m.code, locale);
    },
    [t, locale],
  );
}
