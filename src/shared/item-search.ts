/**
 * Kitchen search (CAT1 Rec): find items by the name as said **or** the standard name, case- and
 * accent-insensitive, so "nuoc mam" finds "nước mắm" and "fish" finds it too (through the
 * keyword map's English gloss). Pure and client-safe: the UI searches `KitchenState.items`
 * directly (a kitchen is tens of items, so there's no server query; backend-data.md §6).
 *
 * Every word of the query must start a word of the item's names, in any order: "sauce fish"
 * finds "fish sauce", "egg" finds "eggs". An empty query matches everything.
 */
import { englishGlosses } from "./item-category";
import { foldText, singularWord } from "./text";

export interface Searchable {
  name: { value: string };
  standardName: string;
}

/** The folded words an item can be found by: its name as said, standard name, English glosses. */
export function searchWords(item: Searchable): string[] {
  const texts = [item.name.value, item.standardName, ...englishGlosses(item.name.value)];
  return [...new Set(texts.flatMap((t) => foldText(t).split(" ").filter(Boolean)))];
}

/** The folded words a set of names can be found by: each name plus its English glosses. */
export function nameSearchWords(names: readonly string[]): string[] {
  const texts = names.flatMap((n) => [n, ...englishGlosses(n)]);
  return [...new Set(texts.flatMap((t) => foldText(t).split(" ").filter(Boolean)))];
}

/**
 * The search rule, on already-folded words: every word of the query starts one of `words`, in
 * any order. An empty query matches everything. Also used by "Cooked before" (0040 RB9).
 */
export function matchesSearchWords(query: string, words: readonly string[]): boolean {
  const q = foldText(query).split(" ").filter(Boolean);
  if (q.length === 0) return true;
  // A plural query ("eggs") also matches the singular name ("egg").
  return q.every((t) => words.some((w) => w.startsWith(t) || w.startsWith(singularWord(t))));
}

export function matchesItemSearch(query: string, item: Searchable): boolean {
  return matchesSearchWords(query, searchWords(item));
}

/** The items matching `query`, in their original order. */
export function searchItems<T extends Searchable>(items: readonly T[], query: string): T[] {
  return items.filter((i) => matchesItemSearch(query, i));
}
