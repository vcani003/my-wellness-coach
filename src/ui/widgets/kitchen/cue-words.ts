"use client";
/**
 * Words for the shared-kitchen cues (ux.md §6): "Levi added milk and used up the eggs." One
 * sentence per person, in the order they first appear, with repeats folded together. Past
 * `max` phrases it ends "…, and 2 more changes." (the rest are behind See all).
 */
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { Msg } from "@/contracts/common";
import { localizeParams } from "@/ui/chat/format-msg";
import { actorName, sentenceCase } from "@/ui/fallbacks";
import type { CueEntry } from "@/ui/sync/shared-cues";

export const CUE_MAX_PHRASES = 3;

export interface CueSummary {
  text: string;
  /** Phrases not in `text` ("and 2 more changes"). */
  hidden: number;
}

export function useCueWords() {
  const t = useTranslations();
  const locale = useLocale();

  const did = useCallback(
    (m: Msg): string => {
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(m.params)) params[k] = typeof v === "boolean" ? String(v) : v;
      if (typeof params.name === "string" && !params.name.trim()) params.name = t("fallback.unknownItem");
      localizeParams(params, t);
      const key = `kitchen.since.did.${m.code}`;
      return t.has(key) ? t(key, params) : t("kitchen.since.did.other");
    },
    [t],
  );

  const who = useCallback((entry: CueEntry) => sentenceCase(actorName(entry.actor, t), locale), [t, locale]);

  /** "Levi used up the eggs" (one line of the See all list). */
  const entry = useCallback((e: CueEntry) => t("kitchen.since.entry", { who: who(e), did: did(e.summary) }), [t, who, did]);

  const summarize = useCallback(
    (entries: readonly CueEntry[], max = CUE_MAX_PHRASES): CueSummary => {
      // Group by person, in order of first appearance; the same phrase twice counts once.
      const groups = new Map<string, { who: string; phrases: string[] }>();
      for (const e of entries) {
        const name = who(e);
        const key = `${e.actor.id}:${name}`;
        const g = groups.get(key) ?? { who: name, phrases: [] };
        const phrase = did(e.summary);
        if (!g.phrases.includes(phrase)) g.phrases.push(phrase);
        groups.set(key, g);
      }
      const total = [...groups.values()].reduce((n, g) => n + g.phrases.length, 0);
      const hidden = Math.max(0, total - max);
      const sentences: string[] = [];
      let budget = max;
      for (const g of groups.values()) {
        if (budget <= 0) break;
        const shown = g.phrases.slice(0, budget);
        budget -= shown.length;
        const last = budget <= 0 && hidden > 0;
        const list = new Intl.ListFormat(locale, { type: last ? "unit" : "conjunction" }).format(shown);
        sentences.push(
          last
            ? t("kitchen.since.actorDidMore", { who: g.who, did: list, count: hidden })
            : t("kitchen.since.actorDid", { who: g.who, did: list }),
        );
      }
      return { text: sentences.join(" "), hidden };
    },
    [t, locale, who, did],
  );

  return useMemo(() => ({ summarize, entry }), [summarize, entry]);
}
