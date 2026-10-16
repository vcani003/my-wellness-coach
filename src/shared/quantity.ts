/**
 * An amount typed in the edit sheet (0045 KOS3, 0036 "Edit amount"), kept as said (0015): "half a
 * bag", "about 6", "2 lbs". Numbers are filled only when obvious, like chat: a plain number,
 * optionally followed by one unit word ("2 lbs" → 2, "lbs"; "6" → 6). Everything else stays
 * `asSaid` only, with no made-up amount. Pure and client-safe.
 */
import type { Quantity } from "@/contracts/common";

const OBVIOUS = /^(\d+(?:[.,]\d+)?)\s*(\p{L}+)?$/u;

/** Blank → null (the amount is unknown). */
export function quantityFromText(text: string): Quantity | null {
  const asSaid = text.trim().replace(/\s+/g, " ");
  if (!asSaid) return null;
  const m = OBVIOUS.exec(asSaid);
  if (!m) return { asSaid };
  const amount = Number(m[1].replace(",", "."));
  if (!Number.isFinite(amount)) return { asSaid };
  return { asSaid, amount, ...(m[2] ? { unit: m[2].toLowerCase() } : {}) };
}
