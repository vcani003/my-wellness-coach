/**
 * Smart staples (0054), the pure parts shared by the read model, validation and the AI:
 * - which kitchen item or list item a staple is (name matching);
 * - a staple's `need` (SS3), computed on every read and never stored, so it can't drift;
 * - the old free-text "Staples: …" preference line, split into names (SS2: offered back once).
 * No server-only imports.
 */
import { offersListAdd, type StockLevel } from "@/contracts/common";
import type { StapleNeed } from "@/contracts/kitchen-state";
import { nameTokens, standardName } from "./text";

/**
 * The exact keys a name matches on: its standard name and, for "nước mắm (fish sauce)", the part
 * outside and the part inside the brackets, so the staple "fish sauce" is that item and vice versa.
 */
export function nameKeys(name: string): string[] {
  const keys = new Set([standardName(name)]);
  const m = /^(.*?)\(([^)]*)\)\s*$/.exec(name.trim());
  if (m) {
    keys.add(standardName(m[1]));
    keys.add(standardName(m[2]));
  }
  keys.delete("");
  return [...keys];
}

interface Named {
  name: string;
  standardName: string;
}

/**
 * The candidates that are this staple: exact matches (any key in common) win; otherwise those
 * whose words include every word of the staple ("rice" → "jasmine rice"). Never the other way
 * round, so a staple "jasmine rice" isn't met by plain "rice".
 */
export function matchStaple<T extends Named>(staple: Named, candidates: T[]): T[] {
  const keys = new Set([staple.standardName, ...nameKeys(staple.name)]);
  const exact = candidates.filter((c) => [c.standardName, ...nameKeys(c.name)].some((k) => keys.has(k)));
  if (exact.length) return exact;
  const tokens = nameTokens(staple.name);
  if (tokens.length === 0) return [];
  return candidates.filter((c) => {
    const words = new Set(c.standardName.split(" "));
    return tokens.every((t) => words.has(t));
  });
}

export interface NeedContext {
  /** Items in the kitchen now (at least one open batch), with the row's level when known. */
  current: Array<Named & { id: string; stock?: StockLevel }>;
  /** Items the kitchen had and are Out now. */
  out: Named[];
  /** Items open on the shopping list. */
  list: Array<Named & { id: string }>;
}

export interface NeedResult {
  need: StapleNeed;
  itemId?: string;
  level?: StockLevel;
  shoppingItemId?: string;
}

/**
 * A staple's need (SS3): on the list wins; otherwise in the kitchen → Running low only when every
 * match is Low (`offersListAdd`), else "have" (Some, Plenty or no level); not in the kitchen → Out
 * when it was there before, else "missing" ("Not in yet").
 */
export function stapleNeed(staple: Named, ctx: NeedContext): NeedResult {
  const listed = matchStaple(staple, ctx.list)[0];
  if (listed) return { need: "on-list", shoppingItemId: listed.id };
  const here = matchStaple(staple, ctx.current);
  if (here.length === 0) return { need: matchStaple(staple, ctx.out).length ? "out" : "missing" };
  const stocked = here.find((i) => !offersListAdd(i.stock));
  if (!stocked) return { need: "low", itemId: here[0].id, level: "low" };
  return { need: "have", itemId: stocked.id, ...(stocked.stock ? { level: stocked.stock } : {}) };
}

/**
 * The old free-text preference "Staples: fish sauce, jasmine rice and rice noodles" (saved before
 * 0054) → its names, split at commas, semicolons and "and", repeats dropped. Other statements are
 * ignored. Code only: nothing moves until the person taps Add them (SS2).
 */
export function legacyStapleNames(statements: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of statements) {
    const m = /^\s*(?:(?:my|our)\s+)?(?:usual\s+)?staples?\s*[:\-–—]\s*(.+?)\s*\.?\s*$/i.exec(s);
    if (!m) continue;
    for (const raw of m[1].split(/\s*[,;]\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i)) {
      const name = raw.trim().replace(/[.!]+$/, "").trim();
      const std = standardName(name);
      if (!std || seen.has(std)) continue;
      seen.add(std);
      out.push(name);
    }
  }
  return out;
}
