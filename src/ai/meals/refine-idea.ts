/**
 * Code guards for a refined idea card (ai.md §5 "Refining an idea"). The model (or the fake)
 * returns the whole card after the change; it becomes a card only through the same `toIdea` guard
 * as a new idea: real kitchen labels, a "missing" item the kitchen has moves to Uses, basics only
 * from the 0019 list, and allergen flags computed by code (0019).
 *
 * Allergens: an allergy the card already had stays allowed (the user was already shown it,
 * flagged), and so does one the user's own typed words ask for. A change that brings in any other
 * member's allergen is not saved: the card stays as it was and the reply says why.
 */
import { standardName } from "@/shared/text";
import { allergiesIn, askedAllergies } from "./allergen-guard";
import type { IdeaOut } from "./model-output";
import { labelMaps } from "./context";
import { toIdea } from "./to-ideas";
import type { IdeaRefineInput, IdeaRefineResult } from "./types";
import { allergenExcusedIds, rankUseItUp } from "./use-it-up";

export const IDEA_ALLERGEN_REPLY = "I left the idea as it was: that change would add an allergen from your household.";
export const IDEA_UNCHANGED_REPLY = "That idea already works that way, so I left it as it was.";
export const IDEA_GONE_REPLY = "I couldn't find that idea any more. Ask me for ideas again?";
export const IDEA_REFINE_FAILURE_REPLY = "Sorry, I couldn't change that idea just now. Please try again.";

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => standardName(x) === standardName(b[i]));

/** Turns a model-shaped card into the refined idea, or "unchanged". */
export function toRefinedIdea(out: IdeaOut, reply: string, input: IdeaRefineInput, now: Date): IdeaRefineResult {
  const items = new Map(input.state.items.map((i) => [i.id, i.name.value]));
  const ranked = rankUseItUp(input.state, now);
  const before = input.idea;
  const asked = new Set([
    ...askedAllergies(input.request.text, input.restrictions),
    ...allergiesIn([before.name, ...before.uses.flatMap((id) => (items.has(id) ? [items.get(id)!] : [])), ...before.missing], input.restrictions),
  ]);
  const verdict = toIdea(out, {
    ctx: input,
    labels: labelMaps(input).toId,
    useItUp: new Set(ranked.map((u) => u.itemId)),
    allergenExcused: allergenExcusedIds(ranked),
    asked,
  });
  const keepAsIs = (why: string): IdeaRefineResult => ({
    ok: true,
    unchanged: true,
    reply: why,
    idea: { ...before, basics: [], useItUp: [], allergenFlags: [] },
  });
  if (!verdict) return keepAsIs(reply.trim() || IDEA_UNCHANGED_REPLY);
  if (!verdict.keep) return keepAsIs(IDEA_ALLERGEN_REPLY);
  const idea = verdict.idea;
  const same =
    standardName(idea.name) === standardName(before.name) &&
    idea.why === before.why.trim() &&
    sameList(idea.uses, before.uses) &&
    sameList(idea.missing, before.missing);
  if (same) return keepAsIs(reply.trim() || IDEA_UNCHANGED_REPLY);
  return { ok: true, idea, reply: reply.trim() || "Done: I changed that idea." };
}
