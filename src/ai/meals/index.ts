/**
 * Meal ideas and recipes: the entry points Backend wires into the turn stream (ai.md §5, §9).
 *
 *   const meals = getMealAI(selectInterpreterKind());   // same server setting as the interpreter
 *   for await (const e of meals.streamMealIdeas(input)) …  // `idea` events, then `done`
 *   for await (const e of meals.streamRecipe(input)) …     // `part` events, then `done`
 *   await meals.readPastedRecipe(input)                    // a pasted recipe → recipe.save only
 *
 * The kind is passed in (rather than read here) so this module never imports `src/ai/index.ts`.
 */
import { createFakeMealAI } from "../fake/meals";
import { createRealMealAI } from "../real/meals";
import type { MealAI } from "./types";

export type * from "./types";
export { rankUseItUp } from "./use-it-up";
export { isBasic } from "./basics";

export const MEALS_NOT_CONFIGURED_REPLY = "Kitchen's AI isn't set up on this server yet, so I can't suggest meals. The buttons still work.";

export const notConfiguredMealAI: MealAI = {
  async *streamMealIdeas() {
    yield { type: "done", result: { ok: false, reason: "not-configured", reply: MEALS_NOT_CONFIGURED_REPLY } };
  },
  async generateMealIdeas() {
    return { ok: false, reason: "not-configured", reply: MEALS_NOT_CONFIGURED_REPLY };
  },
  async *streamRecipe() {
    yield { type: "done", result: { ok: false, reason: "not-configured", reply: MEALS_NOT_CONFIGURED_REPLY } };
  },
  async generateRecipe() {
    return { ok: false, reason: "not-configured", reply: MEALS_NOT_CONFIGURED_REPLY };
  },
  async readPastedRecipe() {
    return { ok: false, reason: "not-configured", reply: MEALS_NOT_CONFIGURED_REPLY };
  },
  async refineIdea() {
    return { ok: false, reason: "not-configured", reply: MEALS_NOT_CONFIGURED_REPLY };
  },
};

let real: MealAI | undefined;

export function getMealAI(kind: "real" | "fake" | "not-configured"): MealAI {
  if (kind === "real") return (real ??= createRealMealAI());
  if (kind === "fake") return createFakeMealAI();
  return notConfiguredMealAI;
}
