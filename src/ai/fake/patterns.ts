/**
 * FAKE INTERPRETER: message patterns (milestone 2 stand-in, NOT the real AI).
 * A handful of regular expressions for the primary journey; anything else is "not understood".
 * The AI specialist deletes this folder when the real interpreter lands.
 */

import type { ItemCategory, Location } from "@/contracts/common";
import { foldText } from "@/shared/text";

export type FakeIntent =
  | { kind: "bought"; items: Segment[] }
  | { kind: "froze"; targets: Segment[] }
  | { kind: "usedUp"; targets: Segment[] }
  | { kind: "low"; targets: Segment[] }
  | { kind: "level"; level: "plenty" | "some"; targets: Segment[] }
  | { kind: "oldGone"; targets: Segment[] }
  | { kind: "defrosted"; targets: Segment[] }
  | { kind: "undo" }
  | { kind: "toList"; items: Segment[]; store?: string }
  | { kind: "offList"; targets: Segment[] }
  | { kind: "clearList" }
  | { kind: "throwOut"; targets: Segment[] }
  | { kind: "mealIdeas" }
  | { kind: "meal"; action: "meal_choose" | "meal_plan" | "meal_start_cooking" | "meal_done"; label: string }
  | { kind: "dish"; title: string; evidence: string; notes: string; have: Segment[] }
  | { kind: "category"; target: Segment; category: ItemCategory }
  | { kind: "place"; target: Segment; location: Location }
  | { kind: "stapleAdd"; items: Segment[]; store?: string }
  | { kind: "stapleRemove"; targets: Segment[] }
  | { kind: "staplesQuestion" }
  | { kind: "yes" }
  | { kind: "unknown" };

/** A piece of the message: `raw` is exactly as typed (used as evidence), `name` is cleaned. */
export interface Segment {
  raw: string;
  name: string;
  quantity?: { asSaid: string; amount?: number; unit?: string };
}

const END = String.raw`\s*[.!]*\s*$`;

const UNDO = new RegExp(String.raw`^\s*(?:please\s+)?undo(?:\s+(?:that|it|the last(?: change)?|my last change))?(?:\s+please)?` + END, "i");
const BOUGHT = new RegExp(String.raw`^\s*(?:(?:i|we)\s+)?(?:just\s+)?(?:bought|got|picked up|grabbed)\s+(.+?)` + END, "i");
const FROZE = new RegExp(String.raw`\b(?:just\s+)?froze\s+(.+?)` + END, "i");
const USED_UP = [
  new RegExp(String.raw`\b(?:used|finished)\s+(?:up\s+)?(?:the\s+)?(?:rest|last)\s+of\s+(.+?)` + END, "i"),
  new RegExp(String.raw`\b(?:used up|finished off|finished)\s+(.+?)` + END, "i"),
  new RegExp(String.raw`\b(?:we're|we are|i'm|i am)\s+out\s+of\s+(.+?)` + END, "i"),
];
const LOW = [
  new RegExp(String.raw`\b(?:running|getting)\s+low\s+on\s+(.+?)` + END, "i"),
  new RegExp(String.raw`\blow\s+on\s+(.+?)` + END, "i"),
  new RegExp(String.raw`^\s*(.+?)(?:\s+(?:is|are)|'s)\s+(?:running|getting)\s+low` + END, "i"),
];

/** Stock levels (0045 KOS4): "we have plenty of rice" · "there's some milk left". */
const PLENTY = new RegExp(
  String.raw`^\s*(?:(?:we|i)\s+(?:still\s+)?(?:have|'ve got|have got)|we've\s+got|there's|there\s+is|(?:we|i)\s+got)\s+(?:still\s+)?(?:plenty|lots|loads)\s+of\s+(.+?)(?:\s+left)?` + END,
  "i",
);
const SOME = new RegExp(
  String.raw`^\s*(?:there's|there\s+is|(?:we|i)\s+(?:still\s+)?have)\s+(?:still\s+)?some\s+(.+?)\s+left` + END,
  "i",
);

/** Batches (0025): "the old eggs are gone" · "I defrosted the chicken" / "thawed the shrimp". */
const OLD_GONE = new RegExp(String.raw`^\s*(?:the\s+)?old(?:er)?\s+(.+?)\s+(?:are|is)\s+gone` + END, "i");
const DEFROSTED = new RegExp(String.raw`\b(?:just\s+)?(?:defrosted|thawed)\s+(.+?)` + END, "i");

/** "add garlic and ginger to the list" · "put oatmilk on my shopping list for Publix" (0027). */
const TO_LIST = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the|my|our)\s+(?:shopping\s+)?list(?:\s+(?:for|at|from)\s+(.+?))?` + END,
  "i",
);

/**
 * Removals (0045 KOS16 tests): "take oat milk and eggs off the list" · "clear the list" · "throw out
 * the milk, eggs and bread" / "remove X from the kitchen". More than 5 at once makes Lumi ask first.
 */
const OFF_LIST = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:take|remove|delete)\s+(.+?)\s+(?:off|from)\s+(?:the|my|our)\s+(?:shopping\s+)?list` + END,
  "i",
);
const CLEAR_LIST = new RegExp(String.raw`^\s*(?:please\s+)?(?:clear|empty)\s+(?:out\s+)?(?:the|my|our)\s+(?:shopping\s+)?list` + END, "i");
const THROW_OUT = new RegExp(
  String.raw`^\s*(?:(?:i|we)\s+)?(?:please\s+)?(?:threw out|throw out|tossed|toss|got rid of|remove)\s+(.+?)(?:\s+from\s+(?:the|my|our)\s+kitchen)?` + END,
  "i",
);

const LEADING_FILLER = /^(?:all\s+(?:of\s+)?the|the|my|our|some|a|an|more)\s+/i;
const UNIT =
  String.raw`lbs?|pounds?|kg|g|grams?|oz|ounces?|l|litres?|liters?|ml|bags?|packs?|packets?|bottles?|cartons?|cans?|jars?|tins?|boxes?|bunch(?:es)?|dozen`;
const QUANTITY = new RegExp(String.raw`^(\d+(?:[.,]\d+)?)\s*(` + UNIT + String.raw`)?\s+(?:of\s+)?(.+)$`, "i");

/** "eggs, chicken thighs, spinach and yogurt" → four raw pieces, as typed. */
export function splitList(text: string): string[] {
  return text
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i)
    .map((s) => s.trim().replace(/[.!]+$/, "").trim())
    .filter(Boolean);
}

export function toSegment(raw: string): Segment {
  let name = raw.replace(LEADING_FILLER, "").trim();
  let quantity: Segment["quantity"];
  const q = QUANTITY.exec(name);
  if (q) {
    const amount = Number(q[1].replace(",", "."));
    quantity = { asSaid: `${q[1]}${q[2] ? ` ${q[2]}` : ""}`, amount, ...(q[2] ? { unit: q[2].toLowerCase() } : {}) };
    name = q[3].replace(LEADING_FILLER, "").trim();
  }
  return { raw, name, ...(quantity ? { quantity } : {}) };
}

function segments(list: string): Segment[] {
  return splitList(list)
    .map(toSegment)
    .filter((s) => s.name.length > 0);
}

/**
 * Category corrections (CAT1), minimal: "fish sauce goes under sauces", "the tofu goes in dairy &
 * eggs", "put the hoisin under condiments". Only when the words after it name a category, so "put
 * the milk in the fridge" isn't one.
 */
const CATEGORY_MOVE = [
  new RegExp(String.raw`^\s*(?:the\s+)?(.+?)\s+(?:goes|go|belongs?|should go)\s+(?:under|in|into|with)\s+(.+?)` + END, "i"),
  new RegExp(String.raw`^\s*(?:please\s+)?(?:put|file|move)\s+(.+?)\s+(?:under|in|into)\s+(.+?)` + END, "i"),
];

/** First word of a category's everyday names → its ID (folded: no accents, lower case). */
const CATEGORY_WORDS: Array<[RegExp, ItemCategory]> = [
  [/^(produce|vegetables?|veg|veggies|fruits?|herbs?)\b/, "produce"],
  [/^(meat|seafood|meats)\b/, "meat_seafood"],
  [/^(dairy|eggs?)\b/, "dairy_eggs"],
  [/^(rice|noodles?|grains?|pasta|bread)\b/, "rice_noodles_grains"],
  [/^(sauces?|condiments?)\b/, "sauces_condiments"],
  [/^(spices?|seasonings?)\b/, "spices_seasonings"],
  [/^(canned|jarred|cans?|jars?|tins?)\b/, "canned_jarred"],
  [/^baking\b/, "baking"],
  [/^(snacks?|sweets?|desserts?|candy)\b/, "snacks_sweets"],
  [/^drinks?\b/, "drinks"],
  [/^leftovers?\b/, "leftovers"],
  [/^other\b/, "other"],
];

export function categoryFromWords(text: string): ItemCategory | null {
  const words = foldText(text).replace(/^(the|my|our)\s+/, "");
  return CATEGORY_WORDS.find(([re]) => re.test(words))?.[1] ?? null;
}

/** "the fridge" / "pantry" → its place (0041), else null. */
export function placeFromWords(text: string): Location | null {
  const m = /^(?:the\s+|my\s+|our\s+)?(fridge|freezer|pantry)\b/.exec(foldText(text));
  return (m?.[1] as Location | undefined) ?? null;
}

/** "Onions go in the pantry" / "put the milk in the freezer" (0041): a said place, remembered. */
function categoryIntent(text: string): FakeIntent | null {
  for (const re of CATEGORY_MOVE) {
    const m = re.exec(text);
    if (!m) continue;
    const category = categoryFromWords(m[2]);
    if (category) return { kind: "category", target: toSegment(m[1]), category };
    const location = placeFromWords(m[2]);
    if (location) return { kind: "place", target: toSegment(m[1]), location };
  }
  return null;
}

/**
 * Staples (0054): "fish sauce is a staple" · "rice and eggs are staples from Publix" · "we always
 * keep jasmine rice" · "eggs aren't a staple any more" · "what staples do I need?" / "restock".
 * "We always keep the bread in the freezer" is a place habit (0041), never a staple.
 */
const STAPLE_IS = new RegExp(
  String.raw`^\s*(.+?)\s+(?:is|are)\s+(?:a\s+|one\s+of\s+(?:my|our|the)\s+)?staples?(?:\s+(?:from|at)\s+(.+?))?` + END,
  "i",
);
const STAPLE_ALWAYS = new RegExp(String.raw`^\s*(?:we|i)\s+always\s+(?:keep|have|buy|get)\s+(.+?)(?:\s+(?:from|at)\s+(.+?))?` + END, "i");
const STAPLE_NOT = [
  new RegExp(String.raw`^\s*(.+?)\s+(?:isn'?t|is not|aren'?t|are not)\s+(?:a\s+|one\s+of\s+(?:my|our|the)\s+)?staples?(?:\s+any\s*more)?` + END, "i"),
  new RegExp(String.raw`^\s*(?:please\s+)?(?:take|remove)\s+(.+?)\s+(?:off|from)\s+(?:my|our|the)\s+staples` + END, "i"),
];
const STAPLES_QUESTION = /\b(what|which) staples\b|^\s*restock\b|\bbuild (my|our|the) (shopping )?list\b/i;
const PLACE_WORD = /\b(fridge|freezer|pantry)\b/i;
const YES = /^\s*(yes|yeah|yep|sure|ok(ay)?|please do|go ahead)\b/i;

function stapleIntent(text: string): FakeIntent | null {
  if (STAPLES_QUESTION.test(text)) return { kind: "staplesQuestion" };
  for (const re of STAPLE_NOT) {
    const m = re.exec(text);
    if (m) return { kind: "stapleRemove", targets: segments(m[1]) };
  }
  const m = STAPLE_IS.exec(text) ?? (PLACE_WORD.test(text) ? null : STAPLE_ALWAYS.exec(text));
  if (!m) return null;
  return { kind: "stapleAdd", items: segments(m[1]), ...(m[2] ? { store: m[2].trim() } : {}) };
}

/** Meals (0005, 0013): "what can I make?", "the second one", "add that to my plan", "start cooking", "I made it". */
const IDEAS = /\b(what can (i|we) (make|cook)|meal ideas|dinner ideas|any (other )?ideas|something else)\b/i;

/**
 * A dish the user names (MI1): "I was thinking a chicken curry, with coconut milk…" · "I want to
 * make pad thai" · "let's make a chicken curry". The dish runs to the first comma, full stop or
 * "with"; the rest is its notes, and "I (also) have X" sentences are kitchen adds.
 */
const DISH = /^\s*((?:i\s+was\s+thinking(?:\s+(?:of|about))?|i\s+want\s+to\s+(?:make|cook)|let'?s\s+(?:make|cook|have))\s+(?:(?:a|an|some)\s+)?([^,.!?]+?))(?=\s*(?:[,.!?]|\bwith\b|$))([\s\S]*)$/i;
const HAVE = /^\s*(?:and\s+)?(?:i|we)\s+(?:also\s+)?(?:have|'ve got|have got|got)\s+(?:also\s+)?(.+?)\s*$/i;

function dishIntent(text: string): FakeIntent | null {
  const m = DISH.exec(text);
  if (!m) return null;
  const dish = m[2].trim();
  if (!dish) return null;
  const notes = m[3].replace(/^\s*[,.]\s*/, "").trim();
  const have = notes
    .split(/[.!?]+/)
    .map((sentence) => HAVE.exec(sentence)?.[1])
    .filter((s): s is string => Boolean(s))
    .flatMap((s) => segments(s));
  return { kind: "dish", title: dish.replace(/^\w/, (c) => c.toUpperCase()), evidence: m[1].trim(), notes, have };
}
const ORDINALS: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3 };
const CHOOSE = /^\s*(?:let'?s (?:do|go with|make) )?the (first|1st|second|2nd|third|3rd)(?: one)?\b/i;
const PLAN = /\badd (?:that|it) to (?:my|the|our) (?:meal )?plan\b/i;
const START = /\b(start(?:ing)? cooking|cooking it now)\b/i;
const DONE = /\b(i|we) (made|cooked) it\b|\bdone cooking\b/i;

export function matchIntent(text: string): FakeIntent {
  if (UNDO.test(text)) return { kind: "undo" };
  if (IDEAS.test(text)) return { kind: "mealIdeas" };
  const choose = CHOOSE.exec(text);
  if (choose) return { kind: "meal", action: "meal_choose", label: `d${ORDINALS[choose[1].toLowerCase()]}` };
  if (PLAN.test(text)) return { kind: "meal", action: "meal_plan", label: "last_chosen" };
  if (START.test(text)) return { kind: "meal", action: "meal_start_cooking", label: "last_chosen" };
  if (DONE.test(text)) return { kind: "meal", action: "meal_done", label: "last_chosen" };
  const dish = dishIntent(text);
  if (dish) return dish;
  const category = categoryIntent(text);
  if (category) return category;
  const staple = stapleIntent(text);
  if (staple) return staple;
  if (YES.test(text)) return { kind: "yes" };
  const plenty = PLENTY.exec(text);
  if (plenty) return { kind: "level", level: "plenty", targets: segments(plenty[1]) };
  const some = SOME.exec(text);
  if (some) return { kind: "level", level: "some", targets: segments(some[1]) };
  const toList = TO_LIST.exec(text);
  if (toList) return { kind: "toList", items: segments(toList[1]), ...(toList[2] ? { store: toList[2].trim() } : {}) };
  if (CLEAR_LIST.test(text)) return { kind: "clearList" };
  const offList = OFF_LIST.exec(text);
  if (offList) return { kind: "offList", targets: segments(offList[1]) };
  const throwOut = THROW_OUT.exec(text);
  if (throwOut) return { kind: "throwOut", targets: segments(throwOut[1]) };
  const bought = BOUGHT.exec(text);
  if (bought) return { kind: "bought", items: segments(bought[1]) };
  const oldGone = OLD_GONE.exec(text);
  if (oldGone) return { kind: "oldGone", targets: segments(oldGone[1]) };
  const defrosted = DEFROSTED.exec(text);
  if (defrosted) return { kind: "defrosted", targets: segments(defrosted[1]) };
  const froze = FROZE.exec(text);
  if (froze) return { kind: "froze", targets: segments(froze[1]) };
  for (const re of USED_UP) {
    const m = re.exec(text);
    if (m) return { kind: "usedUp", targets: segments(m[1]) };
  }
  for (const re of LOW) {
    const m = re.exec(text);
    if (m) return { kind: "low", targets: segments(m[1]) };
  }
  return { kind: "unknown" };
}
