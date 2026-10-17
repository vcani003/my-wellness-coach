/**
 * FAKE INTERPRETER: message patterns (milestone 2 stand-in, NOT the real AI).
 * A handful of regular expressions for simple kitchen updates; anything else is "not understood",
 * and questions, recipes and meal ideas are "needs the real AI" (0059 PF10).
 */

import type { ItemCategory, Location } from "@/contracts/common";
import { isQuestion } from "../question-guard";
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
  /** A question, a recipe, meal ideas or a recipe change: the stand-in declines (0059 PF10). */
  | { kind: "needsRealAI" }
  /** "Make me a sample recipe [for <dish>]" (PF10): a clearly labelled template recipe. */
  | { kind: "sample"; dish?: string }
  | {
      kind: "meal";
      action: "meal_plan" | "meal_start_cooking" | "meal_done" | "meal_date" | "meal_clear_date";
      label: string;
      /** KOS1: the day as said ("Tuesday"); resolved by code (meal-ops.ts). */
      when?: string;
    }
  | { kind: "weekPlan" }
  | { kind: "weekNeeds" }
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
/** "2 lbs of rice" · "5-6 large eggs" · "2 x eggs" · "2x eggs": the amount (or range) is the quantity, never part of the name. */
const QUANTITY = new RegExp(
  String.raw`^(\d+(?:[.,]\d+)?(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?)\s*(?:[x×]\s*)?(?:(` + UNIT + String.raw`)\b\.?)?\s*(?:of\s+)?(\D.*)$`,
  "i",
);
/** "a dozen eggs" · "half a dozen eggs" · "two avocados": a worded amount. */
const WORD_AMOUNT: Record<string, number> = {
  "half a dozen": 6, "a dozen": 12, dozen: 12, "a couple of": 2, "a couple": 2,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const WORDED = new RegExp(String.raw`^(half a dozen|a dozen|dozen|a couple of|a couple|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:of\s+)?(.+)$`, "i");

/**
 * Not a food: "I got the ingredients needed to make this" never makes an item called
 * "ingredients needed to make this" (0059 PF10). Words that stand for things already named, or
 * for everything at once.
 */
const NOT_FOOD = /^(?:the\s+)?(?:ingredients?|everything|anything|something|nothing|stuff|things?|it|them|that|this|these|those|what|all|groceries|items?|the rest|rest)(?=\s|$)/i;

/** "eggs, chicken thighs, spinach and yogurt" → four raw pieces, as typed. */
export function splitList(text: string): string[] {
  return text
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/i)
    .map((s) => s.trim().replace(/[.!]+$/, "").trim())
    .filter(Boolean);
}

export function toSegment(raw: string): Segment {
  let name = raw.trim();
  let quantity: Segment["quantity"];
  // Worded amounts first: "a dozen eggs" would lose its "a" to the filler below.
  const w = WORDED.exec(name);
  if (w) {
    quantity = { asSaid: w[1].toLowerCase(), amount: WORD_AMOUNT[w[1].toLowerCase()] };
    name = w[2];
  }
  name = name.replace(LEADING_FILLER, "").trim();
  const q = quantity ? null : QUANTITY.exec(name);
  if (q) {
    const range = /\d\s*(?:-|–|to)\s*\d/.test(q[1]);
    const asSaid = q[1].replace(/\s*(-|–)\s*/, "$1");
    quantity = {
      asSaid: `${asSaid}${q[2] ? ` ${q[2]}` : ""}`,
      // A range ("5-6") has no single amount: it stays as said.
      ...(range ? {} : { amount: Number(q[1].replace(",", ".")) }),
      ...(q[2] ? { unit: q[2].toLowerCase() } : {}),
    };
    name = q[3].replace(LEADING_FILLER, "").trim();
  }
  return { raw, name, ...(quantity ? { quantity } : {}) };
}

/** A segment that names a food (not "the ingredients needed to make this", PF10). */
export function namesFood(s: Segment): boolean {
  return s.name.length > 0 && !NOT_FOOD.test(s.name);
}

function segments(list: string): Segment[] {
  return splitList(list).map(toSegment).filter(namesFood);
}

/**
 * Category corrections (CAT1), minimal: "fish sauce goes under sauces", "the tofu goes in dairy &
 * eggs", "put the hoisin under condiments". Only when the words after it name a category, so "put
 * the milk in the fridge" isn't one.
 */
const CATEGORY_MOVE = [
  new RegExp(String.raw`^\s*(?:the\s+)?(.+?)\s+(?:goes|go|belongs?|should go)\s+(?:under|in|into|with|on)\s+(.+?)` + END, "i"),
  new RegExp(String.raw`^\s*(?:please\s+)?(?:put|file|move)\s+(.+?)\s+(?:under|in|into|on)\s+(.+?)` + END, "i"),
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
  const m = /^(?:the\s+|my\s+|our\s+)?(fridge|freezer|pantry|counter)\b/.exec(foldText(text));
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
const PLACE_WORD = /\b(fridge|freezer|pantry|counter)\b/i;
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

/**
 * Meals (0005, 0013): the stand-in never suggests ideas or writes a dish's recipe (0059 PF10).
 * These only spot the ask, so it can say that needs the real AI.
 */
const IDEAS = /\b(what can (i|we) (make|cook)|meal ideas|dinner ideas|any (other )?ideas|something else|suggest)\b/i;
const WANTS_A_DISH = /^\s*(?:i\s+was\s+thinking(?:\s+(?:of|about))?|i\s+want\s+to\s+(?:make|cook)|let'?s\s+(?:make|cook|have)|(?:can|could)\s+you\s+(?:make|write|give)|(?:give|write|make)\s+me)\b|\brecipes?\b/i;

/**
 * "Make me a sample recipe" · "a sample recipe for chicken curry" · "sample pasta recipe" (PF10):
 * a template recipe clearly titled "Sample recipe (stand-in)", so the recipe and week screens can
 * be clicked through without the real AI.
 */
const SAMPLE_FOR = /\bsample\s+recipes?\b(?:\s*(?::|for|of|with)\s*(?:an?\s+|some\s+|the\s+)?(.+?))?\s*[.!?]*\s*$/i;
const SAMPLE_NAMED = /\bsample\s+(.+?)\s+recipes?\b/i;

function sampleIntent(text: string): FakeIntent | null {
  const named = SAMPLE_NAMED.exec(text);
  const dish = named?.[1] ?? SAMPLE_FOR.exec(text)?.[1] ?? (/\bsample\s+recipes?\b/i.test(text) ? "" : null);
  if (dish === null) return null;
  const clean = dish.replace(/^(?:an?|some|the)\s+/i, "").trim();
  return clean ? { kind: "sample", dish: clean } : { kind: "sample" };
}

/** "The second one": picking an idea card, which only the real AI suggests. */
const CHOOSE_A_CARD = /^\s*(?:let'?s (?:do|go with|make) )?the (?:first|1st|second|2nd|third|3rd)(?: one)?\b/i;
const PLAN = /\badd (?:that|it) to (?:my|the|our) (?:meal )?plan\b/i;
const START = /\b(start(?:ing)? cooking|cooking it now)\b/i;
const DONE = /\b(i|we) (made|cooked) it\b|\bdone cooking\b/i;

/**
 * The dated plan (0045 KOS1, KOS12): "plan the curry for Tuesday" · "plan it for tomorrow" ·
 * "move the pasta to Friday" · "take the day off the pasta" · "what are we eating this week?" ·
 * "add what we need for this week's meals" / "what do we need for this week?".
 */
const PLAN_FOR = /^\s*(?:please\s+)?(?:plan|schedule)\s+(?:the\s+|my\s+)?(.+?)\s+for\s+(.+?)\s*[.!?]*$/i;
const MOVE_TO = /^\s*(?:please\s+)?(?:move|push|switch)\s+(?:the\s+|my\s+)?(.+?)\s+to\s+(.+?)\s*[.!?]*$/i;
const CLEAR_DAY = /^\s*(?:please\s+)?(?:take|remove|clear)\s+the\s+(?:date|day)\s+(?:off|from)\s+(?:the\s+|my\s+)?(.+?)\s*[.!?]*$/i;
const WEEK_PLAN = /\bwhat\b.*\b(eating|on the plan|planned|for dinner)\b.*\bweek\b/i;
const WEEK_NEEDS = /\b(what (?:do )?we need|what's missing|ingredients|need to buy)\b.*\bweek\b/i;
const IT = /^(it|that|this one)$/i;

function planIntent(text: string): FakeIntent | null {
  if (WEEK_NEEDS.test(text)) return { kind: "weekNeeds" };
  if (WEEK_PLAN.test(text)) return { kind: "weekPlan" };
  const label = (s: string) => (IT.test(s.trim()) ? "last_chosen" : s.trim());
  const clear = CLEAR_DAY.exec(text);
  if (clear) return { kind: "meal", action: "meal_clear_date", label: label(clear[1]) };
  const plan = PLAN_FOR.exec(text);
  if (plan) return { kind: "meal", action: "meal_plan", label: label(plan[1]), when: plan[2].trim() };
  const move = MOVE_TO.exec(text);
  // "Move the rice to the pantry" is a place, not a day (0041).
  if (move && !placeFromWords(move[2])) return { kind: "meal", action: "meal_date", label: label(move[1]), when: move[2].trim() };
  return null;
}

export function matchIntent(text: string): FakeIntent {
  if (UNDO.test(text)) return { kind: "undo" };
  const sample = sampleIntent(text);
  if (sample) return sample;
  const planned = planIntent(text);
  if (planned) return planned;
  if (STAPLES_QUESTION.test(text)) return { kind: "staplesQuestion" };
  // Questions, ideas, a dish's recipe and "the second one" (an idea card): only the real AI (PF10).
  if (isQuestion(text) || IDEAS.test(text) || WANTS_A_DISH.test(text) || CHOOSE_A_CARD.test(text)) return { kind: "needsRealAI" };
  if (PLAN.test(text)) return { kind: "meal", action: "meal_plan", label: "last_chosen" };
  if (START.test(text)) return { kind: "meal", action: "meal_start_cooking", label: "last_chosen" };
  if (DONE.test(text)) return { kind: "meal", action: "meal_done", label: "last_chosen" };
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
  if (throwOut) {
    // "Remove the yogurt from the curry" changes a dish (PF10), not the kitchen; "…from the fridge" is the kitchen.
    const from = /^(.+?)\s+(?:from|out of)\s+(?:the|my|our|this|that)\s+(.+)$/i.exec(throwOut[1]);
    if (from && !placeFromWords(from[2])) return { kind: "needsRealAI" };
    return { kind: "throwOut", targets: segments(from ? from[1] : throwOut[1]) };
  }
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
