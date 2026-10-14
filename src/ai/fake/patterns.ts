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
  | { kind: "undo" }
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

export function matchIntent(text: string): FakeIntent {
  if (UNDO.test(text)) return { kind: "undo" };
  const bought = BOUGHT.exec(text);
  if (bought) return { kind: "bought", items: segments(bought[1]) };
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
