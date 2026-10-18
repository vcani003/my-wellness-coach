/**
 * TEST-ONLY scripted meal AI helpers (never shipped). The stand-in AI no longer reads dish notes or
 * answers recipe questions (0059 PF10); the pipeline tests still need a deterministic stand-in for
 * the real model, so these live here.
 */
import type { RecipeInput } from "@/ai/meals/types";

type Current = NonNullable<RecipeInput["refine"]>["current"];

const LIST_LEAD = /^(?:and\s+)?(?:with|(?:i|we)\s+(?:also\s+)?(?:have|'ve got|have got|got)|use)\s+(?:also\s+)?/i;
const LEAVE_OUT = /^(?:without|no|don'?t (?:want|use|add))\b/i;
const COOK_VERB = /^(?:season|flavou?r|top|finish|serve|sprinkle|garnish|sweeten|cook|fry|make)\b/i;
const NAMED_WITH = /\b(?:with|using)\s+(?:only\s+|just\s+|some\s+|a (?:little|bit of)\s+)?(?:the\s+)?([a-z][a-z' -]*?)\s*$/i;

export interface ReadNotes {
  /** Named as ingredients: "with coconut milk, lemongrass", "I have potatoes". */
  listed: string[];
  /** Named in how they want it: "season it with only hondashi" → hondashi. */
  seasoning: string[];
  /** How they want it, as said: shapes the summary and steps, never an ingredient line. */
  guidance: string[];
  /** "Only" a seasoning: no salt on top of it. */
  onlySeasoning: boolean;
  sweet: boolean;
}

/** Split the user's notes about a dish into ingredients and guidance. */
export function readNotes(notes: string): ReadNotes {
  const out: ReadNotes = { listed: [], seasoning: [], guidance: [], onlySeasoning: false, sweet: false };
  for (const raw of notes.split(/[.!?;\n]+/)) {
    const s = raw.trim();
    if (!s || LEAVE_OUT.test(s)) continue;
    if (LIST_LEAD.test(s)) {
      out.listed.push(
        ...s
          .replace(LIST_LEAD, "")
          .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
          .map((x) => x.trim().replace(/^(?:a|an|some|the)\s+/i, ""))
          .filter(Boolean),
      );
      continue;
    }
    out.guidance.push(s);
    if (/\bsweet/i.test(s)) out.sweet = true;
    const named = COOK_VERB.test(s) ? NAMED_WITH.exec(s)?.[1]?.trim() : undefined;
    if (named) {
      out.seasoning.push(named);
      if (/\b(?:only|just)\b/i.test(s)) out.onlySeasoning = true;
    }
  }
  return out;
}

const ASKS_AMOUNT = /\b(how (?:much|many)|measurements?|amounts?|quantit(?:y|ies)|what are the ingredients)\b/i;
const ASKS_TIME = /\b(how long|what (?:temperature|heat)|how hot)\b/i;
/** "How much rice is left?" is about the kitchen, not the recipe. */
const ABOUT_KITCHEN = /\b(left|do (?:we|i) (?:still )?have|have we got|in the (?:fridge|freezer|pantry|kitchen)|on (?:the|my) list)\b/i;

/** A question about the recipe itself: answered from it, never a change. */
export function isFakeRecipeQuestion(text: string): boolean {
  const t = text.trim();
  if (/^(?:no|without)\b.*\?$/i.test(t)) return true;
  return (ASKS_AMOUNT.test(t) || ASKS_TIME.test(t)) && !ABOUT_KITCHEN.test(t);
}

const stem = (w: string) => w.toLowerCase().replace(/(?:es|s)$/, "");

/** The answer, from the recipe as it stands. */
export function answerRecipeQuestion(text: string, current: Current): string {
  const n = current.servings?.trim();
  const serves = n ? (/^\d+$/.test(n) ? `For ${n} servings` : `For ${n}`) : "For this recipe";
  if (ASKS_TIME.test(text)) {
    const timed = current.steps.filter((s) => /\b\d+(?:[–-]\d+)?\s*(?:minutes?|mins?|hours?|seconds?)\b|\bheat\b/i.test(s));
    return timed.length ? `From the recipe: ${timed.join(" ")}` : "The recipe doesn't give a time for that. Cook it until it looks done.";
  }
  const words = new Set((text.toLowerCase().match(/[a-zà-ỹ]+/g) ?? []).filter((w) => w.length >= 3).map(stem));
  const asked = current.ingredients.filter((i) => i.name.toLowerCase().split(/[^a-zà-ỹ]+/).some((w) => w.length >= 3 && words.has(stem(w))));
  const line = (i: Current["ingredients"][number]) => (i.amount ? `${i.amount} ${i.name}` : `${i.name} (no amount given)`);
  const shown = asked.length ? asked : current.ingredients;
  return `${serves}: ${shown.map(line).join(", ")}.`;
}
