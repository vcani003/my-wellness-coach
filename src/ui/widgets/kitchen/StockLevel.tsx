"use client";
/**
 * Stock levels on the Kitchen place (0045 KOS4, 0055): Plenty · Some left · Running low · Out.
 * - **Label:** a small three-bar meter plus the word, in the row's details line. Never colour
 *   alone (the word says it), never the allergy berry. Unknown shows nothing.
 * - **Control:** "How much is left?" in the item's edit sheet (KOS3, `ItemEditSheet`), which took
 *   over from KOS4's ⋯ menu. It acts at once, on the whole item or the batch picked (KOS4-e).
 */
import { useTranslations } from "next-intl";
import type { StockLevel } from "@/contracts/common";

export const LEVELS: readonly StockLevel[] = ["plenty", "some", "low", "out"];
const BARS: Record<StockLevel, number> = { plenty: 3, some: 2, low: 1, out: 0 };
/** Calm colours from the existing tokens: mint for Plenty, muted for Some and Out, amber for Low. */
export const TONE: Record<StockLevel, string> = {
  plenty: "font-medium text-success-text",
  some: "font-medium text-text-muted",
  low: "font-strong text-warning-text",
  out: "font-strong text-text-muted",
};

/** The three-bar meter. Decorative: the word next to it carries the meaning. */
export function LevelMeter({ level }: { level: StockLevel }) {
  return (
    <span aria-hidden="true" className="level-meter">
      {[0, 1, 2].map((i) => (
        <span key={i} {...(i < BARS[level] ? { "data-on": "" } : {})} />
      ))}
    </span>
  );
}

/** "▮▮▯ Some left" in a row's details line. */
export function LevelLabel({ level }: { level: StockLevel }) {
  const t = useTranslations("kitchen.level");
  return (
    <span data-stock={level} className={`inline-flex items-center gap-1 ${TONE[level]}`}>
      <LevelMeter level={level} />
      {t(level)}
    </span>
  );
}

