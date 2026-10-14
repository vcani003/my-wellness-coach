/**
 * FAKE INTERPRETER: message patterns (milestone 2 stand-in, NOT the real AI).
 * A handful of regular expressions for the primary journey; anything else is "not understood".
 * The AI specialist deletes this folder when the real interpreter lands.
 */

export type FakeIntent =
  | { kind: "bought"; items: Segment[] }
  | { kind: "froze"; targets: Segment[] }
  | { kind: "usedUp"; targets: Segment[] }
  | { kind: "low"; targets: Segment[] }
  | { kind: "oldGone"; targets: Segment[] }
  | { kind: "defrosted"; targets: Segment[] }
  | { kind: "undo" }
  | { kind: "toList"; items: Segment[]; store?: string }
  | { kind: "mealIdeas" }
  | { kind: "meal"; action: "meal_choose" | "meal_plan" | "meal_start_cooking" | "meal_done"; label: string }
  | { kind: "dish"; title: string; evidence: string; notes: string; have: Segment[] }
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

/** Batches (0025): "the old eggs are gone" · "I defrosted the chicken" / "thawed the shrimp". */
const OLD_GONE = new RegExp(String.raw`^\s*(?:the\s+)?old(?:er)?\s+(.+?)\s+(?:are|is)\s+gone` + END, "i");
const DEFROSTED = new RegExp(String.raw`\b(?:just\s+)?(?:defrosted|thawed)\s+(.+?)` + END, "i");

/** "add garlic and ginger to the list" · "put oatmilk on my shopping list for Publix" (0027). */
const TO_LIST = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the|my|our)\s+(?:shopping\s+)?list(?:\s+(?:for|at|from)\s+(.+?))?` + END,
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
  const toList = TO_LIST.exec(text);
  if (toList) return { kind: "toList", items: segments(toList[1]), ...(toList[2] ? { store: toList[2].trim() } : {}) };
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
