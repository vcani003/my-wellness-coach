/**
 * Where an item usually goes (0041): the kitchen's own guess at a place, in code. Used when an
 * item is added with no place said and the AI gave none (or isn't involved: "Done shopping", the
 * fake interpreter), and to sort items saved before 0041 once (`sort-places.ts`).
 * Pure and client-safe.
 *
 * How a name is placed:
 * 1. "frozen" (or "đông lạnh") anywhere → Freezer; "dried" → Pantry.
 * 2. A name word with its own place wins over its type: "onion" → Pantry although it's produce,
 *    "mayo" → Fridge although it's a sauce, "ice cream" → Freezer. Longest phrase wins, so
 *    "green onion" (Fridge) beats "onion" (Pantry); a tie goes to the phrase that ends last.
 * 3. Otherwise the item's type (the 12 types from 0032) decides: produce, meat & seafood, dairy &
 *    eggs and leftovers → Fridge; grains, sauces, spices, canned, baking and snacks → Pantry.
 * 4. Drinks, Other and fruit that ripens on the counter (bananas, avocados, tomatoes) get **no
 *    place**: they stay "Not sure where" (0041: only what genuinely can't be placed). Counter is
 *    a place since KOS3 (0030), but only when said or picked: guessing Counter for counter fruit
 *    waits on Vero's answer (see `COUNTER_LATER`).
 *
 * Easy to extend: add a word to a list.
 */
import type { Confidence, Fact, ItemCategory, Location } from "@/contracts/common";
import { foldText, singularWord } from "./text";

/** The usual place for each type. `null` = it depends (stays "Not sure where"). */
export const PLACE_BY_CATEGORY: Record<ItemCategory, Location | null> = {
  produce: "fridge",
  meat_seafood: "fridge",
  dairy_eggs: "fridge",
  rice_noodles_grains: "pantry",
  sauces_condiments: "pantry",
  spices_seasonings: "pantry",
  canned_jarred: "pantry",
  baking: "pantry",
  snacks_sweets: "pantry",
  drinks: null,
  leftovers: "fridge",
  other: null,
};

/** Words that decide the place whatever else the name says. */
const PRIORITY: Partial<Record<Location, string[]>> = {
  freezer: ["frozen", "đông lạnh"],
  pantry: ["dried", "dry"],
};

/** Words whose usual place differs from their type's. */
const BY_NAME: Record<Location | "none", string[]> = {
  freezer: ["ice cream", "kem", "popsicle", "ice", "ice cube", "frozen yogurt", "gelato", "sorbet"],
  pantry: [
    // produce kept at room temperature
    "onion", "red onion", "yellow onion", "white onion", "potato", "sweet potato", "garlic", "shallot",
    "taro", "yam", "pumpkin", "winter squash", "coconut",
    "hành|onion", "hành tây", "hành tím", "tỏi", "khoai tây", "khoai lang", "khoai môn", "bí đỏ",
    // drinks that keep in the cupboard
    "coffee", "tea", "green tea", "cà phê", "trà",
  ],
  fridge: [
    // produce that stays cold although "onion" / "garlic" are pantry words
    "green onion", "spring onion", "garlic chive", "hành lá",
    // sauces and jars kept cold
    "mayo", "mayonnaise", "kewpie", "kimchi", "miso", "gochujang", "doenjang", "curry paste", "salsa",
    "pesto", "fresh noodle", "fresh pasta",
    // drinks kept cold
    "juice", "orange juice", "kombucha", "milk tea", "nước cam",
  ],
  // Never guessed: Counter is only said or picked (KOS3). See COUNTER_LATER.
  counter: [],
  // Counter fruit: no place yet, so they stay "Not sure where".
  none: ["banana", "avocado", "tomato", "cherry tomato", "mango", "papaya", "pineapple", "peach", "persimmon",
    "chuối", "bơ trái", "cà chua", "xoài", "đu đủ", "dứa"],
};

/** The counter-fruit words: the ones to map to Counter if Vero says it should be guessed too. */
export const COUNTER_LATER = BY_NAME.none;

interface Phrase {
  tokens: string[];
  place: Location | "none";
  priority: boolean;
}

const tokensOf = (text: string): string[] => foldText(text).split(" ").filter(Boolean).map(singularWord);

const PHRASES: Phrase[] = [
  ...Object.entries(PRIORITY).flatMap(([place, words]) =>
    words.map((w) => ({ tokens: tokensOf(w.split("|")[0]), place: place as Location, priority: true })),
  ),
  ...Object.entries(BY_NAME).flatMap(([place, words]) =>
    words.map((w) => ({ tokens: tokensOf(w.split("|")[0]), place: place as Location | "none", priority: false })),
  ),
].filter((p) => p.tokens.length > 0);

/** The place a word in the name decides, if any: `"none"` = it depends; undefined = no word matched. */
function placeByName(name: string): Location | "none" | undefined {
  const tokens = tokensOf(name);
  const found: { p: Phrase; end: number }[] = [];
  for (const p of PHRASES) {
    const n = p.tokens.length;
    for (let i = 0; i + n <= tokens.length; i++) {
      if (p.tokens.every((t, j) => tokens[i + j] === t)) found.push({ p, end: i + n });
    }
  }
  if (found.length === 0) return undefined;
  const pool = found.some((h) => h.p.priority) ? found.filter((h) => h.p.priority) : found;
  const best = pool.reduce((a, b) =>
    b.p.tokens.length > a.p.tokens.length || (b.p.tokens.length === a.p.tokens.length && b.end > a.end) ? b : a,
  );
  return best.p.place;
}

/**
 * The kitchen's guess at where an item goes, from its name and type. `frozen` (said or implied)
 * means the freezer. Undefined = it depends: the item stays "Not sure where".
 */
export function guessPlace(name: string, category: ItemCategory | undefined, frozen?: boolean): Location | undefined {
  if (frozen === true) return "freezer";
  const byName = placeByName(name);
  if (byName === "none") return undefined;
  if (byName) return byName;
  return category ? (PLACE_BY_CATEGORY[category] ?? undefined) : undefined;
}

/**
 * `guessPlace` as a fact: `inferred`, medium (it's where it usually goes, not what was said).
 * A type the kitchen itself couldn't tell (`other`, low) gives no place.
 */
export function guessPlaceFact(
  name: string,
  category: Fact<ItemCategory> | undefined,
  frozen?: boolean,
): Fact<Location> | undefined {
  const usable = category && category.confidence !== "low" ? category.value : undefined;
  const place = guessPlace(name, usable, frozen);
  const confidence: Confidence = frozen === true ? "high" : "medium";
  return place ? { value: place, basis: "inferred", confidence } : undefined;
}
