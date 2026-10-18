/** Pure helpers for the Kitchen widget and See all (ux.md §3, decision 0011, CAT1). */
import { ITEM_CATEGORIES, type ItemCategory } from "@/contracts/common";
import type { ItemRow } from "@/contracts/kitchen-state";
import { guessCategory } from "@/shared/item-category";
import { searchItems } from "@/shared/item-search";
// The one exception to "UI reaches a domain only through commands / queries": these signals are
// pure (contracts only), while `queries.ts` would pull the database code into the phone's bundle.
// eslint-disable-next-line no-restricted-imports
import { computeUseItUpSignals } from "@/domains/kitchen/use-it-up";
import { foldText, singularWord, standardName } from "@/shared/text";

export const GROUP_ORDER = ["fridge", "freezer", "pantry", "counter", "unknown"] as const;
export type GroupKey = (typeof GROUP_ORDER)[number];

export interface ItemGroup {
  key: GroupKey;
  items: ItemRow[];
}

/**
 * Fridge / Freezer / Pantry / Not sure where, empty groups left out. Inside a group, the most
 * recently changed first; ties keep the kitchen's own order. "Out" items never reach here: the
 * backend leaves them out of `items` (0011).
 */
export function groupItems(items: readonly ItemRow[]): ItemGroup[] {
  const groups = new Map<GroupKey, ItemRow[]>(GROUP_ORDER.map((k) => [k, []]));
  for (const item of items) {
    if (item.stock?.value === "out") continue; // defensive: out items drop off the list
    groups.get(item.location?.value ?? "unknown")!.push(item);
  }
  return GROUP_ORDER.map((key) => ({
    key,
    items: groups.get(key)!.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  })).filter((g) => g.items.length > 0);
}

/** Whole calendar days between two instants, in the device's time zone ("added 3 days ago"). */
export function calendarDaysSince(iso: string, now: Date): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((startOf(now) - startOf(then)) / 86_400_000));
}

/** An item's open batches, oldest first (0025). An item from an older cached state counts as one. */
export function batchesOf(item: ItemRow): NonNullable<ItemRow["batches"]> {
  return item.batches ?? [];
}

/**
 * The "Defrosted" label (0025): some open batch was defrosted and hasn't gone back in the
 * freezer since. Without batches (an older cached state), the row's own fields decide.
 */
export function isDefrosted(item: ItemRow): boolean {
  const batches = batchesOf(item);
  if (batches.length === 0) return Boolean(item.defrostedOn) && !item.frozen?.value;
  return batches.some((b) => Boolean(b.defrostedOn) && !b.frozen?.value);
}

/**
 * "By type" (CAT1 Rec): the 12 categories in their fixed order (`ITEM_CATEGORIES`), empty groups
 * left out, most recently changed first inside each. An item from an older cached state without a
 * category gets the kitchen's keyword guess, the same one the backend uses (0018).
 */
export interface CategoryGroup {
  key: ItemCategory;
  items: ItemRow[];
}

export function categoryOf(item: ItemRow): ItemCategory {
  return item.category?.value ?? guessCategory(item.name.value).category;
}

const byUpdatedDesc = (a: ItemRow, b: ItemRow) => b.updatedAt.localeCompare(a.updatedAt);
const inKitchen = (item: ItemRow) => item.stock?.value !== "out";

export function groupByCategory(items: readonly ItemRow[]): CategoryGroup[] {
  const groups = new Map<ItemCategory, ItemRow[]>(ITEM_CATEGORIES.map((k) => [k, []]));
  for (const item of items) if (inKitchen(item)) groups.get(categoryOf(item))!.push(item);
  return ITEM_CATEGORIES.map((key) => ({ key, items: groups.get(key)!.slice().sort(byUpdatedDesc) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Search results (CAT1): one flat list, most recently changed first, using the shared matcher. */
export function searchKitchen(items: readonly ItemRow[], query: string): ItemRow[] {
  return searchItems(items.filter(inKitchen), query).sort(byUpdatedDesc);
}

export interface TextPart {
  text: string;
  match: boolean;
}

/**
 * Splits a shown name into parts, marking where a query word starts one of its words, the same way
 * `matchesItemSearch` matches (case- and accent-insensitive, word starts): "nuoc" marks "Nước" in
 * "Nước mắm". A name found only through its English gloss or standard name has nothing marked.
 */
export function highlightParts(text: string, query: string): TextPart[] {
  const words = foldText(query).split(" ").filter(Boolean);
  if (!words.length || !text) return [{ text, match: false }];
  // Fold character by character, so a position in the folded name maps back to the shown name.
  // A combining accent folds to nothing and stays with its letter.
  const chars = Array.from(text);
  const folded = chars.map((c) => (/\p{M}/u.test(c) ? "" : foldText(c) || " "));
  const inWord = (k: number) => folded[k] === "" || /[\p{L}\p{N}]/u.test(folded[k]);
  const marked = new Array<boolean>(chars.length).fill(false);
  let i = 0;
  while (i < chars.length) {
    if (!inWord(i)) {
      i++;
      continue;
    }
    let end = i;
    while (end < chars.length && inWord(end)) end++;
    const word = folded.slice(i, end).join("");
    let longest = 0;
    for (const q of words) {
      for (const candidate of [q, singularWord(q)]) {
        if (word.startsWith(candidate)) longest = Math.max(longest, candidate.length);
      }
    }
    // Mark whole characters (with their accents) until the folded prefix is covered.
    let covered = 0;
    for (let j = i; j < end && (covered < longest || (longest > 0 && folded[j] === "")); j++) {
      marked[j] = true;
      covered += folded[j].length;
    }
    i = end;
  }
  const parts: TextPart[] = [];
  chars.forEach((c, k) => {
    const last = parts.at(-1);
    if (last && last.match === marked[k]) last.text += c;
    else parts.push({ text: c, match: marked[k] });
  });
  return parts;
}

/**
 * Today's "Use it up" (0025, AI8): the few things worth cooking soon, from facts only (when it was
 * defrosted, how long it's been in the fridge, leftovers). No shelf-life guess and never "safe to
 * eat" (spec §10). The rules mirror the meal AI's defaults in `src/ai/meals/use-it-up.ts`
 * (defrosted; leftovers 1+ day; anything else in the fridge 4+ days); that file can't be imported
 * here (it reads the database), so the two numbers below must change together with it;
 * tests/ui/places-model.test.ts fails if they drift.
 */
export const USE_IT_UP_FRIDGE_DAYS = 4;
export const USE_IT_UP_LEFTOVER_DAYS = 1;

export type UseItUpReason =
  | { kind: "defrosted"; days: number }
  /** Saved before "defrosted on" existed: thawed in the fridge, so the age is days since added. */
  | { kind: "defrostedAdded"; days: number }
  | { kind: "leftovers"; days: number }
  | { kind: "fridge"; days: number };

export interface UseItUpRow {
  item: ItemRow;
  reason: UseItUpReason;
}

export function useItUpRows(items: readonly ItemRow[], now: Date, limit = 3): UseItUpRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows: (UseItUpRow & { weight: number; oldest: string })[] = [];
  for (const signal of computeUseItUpSignals({ items: items.filter(inKitchen) }, now)) {
    const item = byId.get(signal.itemId);
    if (!item) continue;
    const whollyFrozen = signal.batchCount <= 1 && item.frozen?.value === true;
    const inFridge = item.location?.value === "fridge";
    let reason: UseItUpReason | null = null;
    let weight = 0;
    if (signal.defrostedDays !== undefined && !whollyFrozen) {
      reason = { kind: "defrosted", days: signal.defrostedDays };
      weight = 4 + Math.min(signal.defrostedDays, 4);
    } else if (signal.defrostedDays === undefined && item.frozen?.value === false && inFridge) {
      reason = { kind: "defrostedAdded", days: signal.oldestDays };
      weight = 3;
    } else if (/\bleftover\b/.test(standardName(item.name.value)) && signal.oldestDays >= USE_IT_UP_LEFTOVER_DAYS) {
      reason = { kind: "leftovers", days: signal.oldestDays };
      weight = 2 + Math.min(signal.oldestDays, 5);
    } else if (inFridge && signal.oldestDays >= USE_IT_UP_FRIDGE_DAYS) {
      reason = { kind: "fridge", days: signal.oldestDays };
      weight = 1 + Math.min(Math.floor((signal.oldestDays - USE_IT_UP_FRIDGE_DAYS) / 2), 4);
    }
    if (reason) rows.push({ item, reason, weight, oldest: signal.oldestAddedAt });
  }
  return rows
    .sort((a, b) => b.weight - a.weight || a.oldest.localeCompare(b.oldest))
    .slice(0, limit)
    .map(({ item, reason }) => ({ item, reason }));
}
