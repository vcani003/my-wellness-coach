/**
 * Name normalisation for matching (0015: name as said + an internal standard name).
 * Deliberately simple and easy to replace: lowercase, strip punctuation, collapse spaces and
 * singularise each word with a few safe English rules. The name as said is always kept.
 */

const KEEP_AS_IS = /(ss|us|is|ous)$/;

function singularWord(word: string): string {
  if (word.length <= 3 || KEEP_AS_IS.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`; // berries → berry
  if (/(ches|shes|xes|zes|sses|oes)$/.test(word)) return word.slice(0, -2); // tomatoes → tomato
  if (word.endsWith("s")) return word.slice(0, -1); // eggs → egg
  return word;
}

/** Collapse case, punctuation and spacing. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/[\s-]+/g, " ")
    .trim();
}

/** "Chicken Thighs" → "chicken thigh". */
export function standardName(input: string): string {
  return normalizeText(input).split(" ").filter(Boolean).map(singularWord).join(" ");
}

/** Words of a standard name, minus filler words people say ("the chicken", "some eggs"). */
const FILLER = new Set(["the", "a", "an", "some", "my", "of", "rest", "remaining", "leftover", "bag", "pack"]);
export function nameTokens(input: string): string[] {
  return standardName(input)
    .split(" ")
    .filter((w) => w && !FILLER.has(w));
}
