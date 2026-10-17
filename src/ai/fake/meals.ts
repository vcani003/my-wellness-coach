/**
 * ⚠️ FAKE MEAL AI (the stand-in, NOT the real AI). It never suggests ideas, writes a recipe for a
 * dish someone asks for, changes a recipe or an idea, or answers a question about one: each of
 * those replies STAND_IN_DECLINE_REPLY and changes nothing (0059 PF10, "only the real model can").
 *
 * The one exception is "make me a sample recipe [for <dish>]": a template recipe titled
 * "Sample recipe (stand-in)…", so the recipe and week screens can be clicked through. It goes
 * through the SAME code guards as the real one (In your kitchen / Need, basics, allergen flags,
 * recipe.save).
 */
import { basicsNote } from "../meals/basics";
import { labelMaps } from "../meals/context";
import { matchKitchenItem } from "../meals/match";
import type { RecipeOutput } from "../meals/model-output";
import { toRecipeResult } from "../meals/to-recipe";
import type { IdeasEvent, MealAI, PastedRecipeInput, RecipeEvent, RecipeInput, RecipeResult } from "../meals/types";
import { collectIdeas, collectRecipe } from "../real/meals";
import { sampleDish, STAND_IN_DECLINE_REPLY } from "./decline";
import { fakeAmount, fakeSteps, sampleIngredients } from "./recipes";

const declined = { ok: false as const, reason: "not-configured" as const, reply: STAND_IN_DECLINE_REPLY };

/**
 * A sample recipe's ingredients: kitchen items a word of the dish names ("salmon tacos" → your
 * salmon), then the template's everyday ones for that kind of dish. Each has an amount for 2;
 * whatever is in the kitchen is linked, so code sorts it into In your kitchen, the rest into Need.
 */
function sampleRecipeIngredients(input: RecipeInput, dish: string, toLabel: Map<string, string>): RecipeOutput["ingredients"] {
  const out: RecipeOutput["ingredients"] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const item = matchKitchenItem(input.state, name);
    if (item ? seen.has(item.id) : out.some((o) => o.name.toLowerCase() === name.toLowerCase())) return;
    if (item) seen.add(item.id);
    const shown = item?.name.value ?? name;
    out.push({ name: shown, amount: fakeAmount(shown), item: item ? (toLabel.get(item.id) ?? null) : null, basic: false });
  };
  for (const word of dish.split(/\s+/).filter((w) => w.length >= 3)) {
    if (matchKitchenItem(input.state, word)) add(word);
  }
  for (const name of sampleIngredients(dish)) add(name);
  return out;
}

export function createFakeMealAI(): MealAI {
  async function* streamMealIdeas(): AsyncGenerator<IdeasEvent> {
    yield { type: "done", result: declined };
  }

  async function* streamRecipe(input: RecipeInput): AsyncGenerator<RecipeEvent> {
    const dish = sampleDish(input.meal.title);
    // A recipe change or a question about it, or any recipe that isn't a sample: the real AI's job.
    if (input.refine || dish === null) {
      yield { type: "done", result: declined };
      return;
    }
    const { toId, toLabel } = labelMaps(input);
    const ingredients = [
      ...sampleRecipeIngredients(input, dish, toLabel),
      { name: "salt", amount: "a pinch", item: null, basic: true },
      { name: "cooking oil", amount: "1 tbsp", item: null, basic: true },
    ];
    const out: RecipeOutput = {
      title: input.meal.title,
      summary: "A template from the stand-in AI, for trying the recipe screens. Not a real recipe: ask the real AI (Claude) for one.",
      servings: "2",
      ingredients,
      steps: fakeSteps(dish || input.meal.title, ingredients, { salt: true }),
      reply: "Here's the sample recipe.",
    };
    const result = toRecipeResult(out, {
      ctx: input,
      labels: toId,
      mealId: input.meal.mealId,
      fallbackTitle: input.meal.title,
      source: "ai",
      opId: `recipe:${input.meal.mealId}`,
    });
    if (!result.ok) {
      yield { type: "done", result: { ok: false, reason: "failed", reply: "Sorry, I couldn't write the sample recipe just now. Please try again." } };
      return;
    }
    const r = result.recipe;
    yield { type: "part", part: "meta", data: { title: r.title, summary: r.summary, servings: r.servings, source: "ai", allergenFlags: r.allergenFlags } };
    for (const [index, ing] of r.ingredients.entries()) yield { type: "part", part: "ingredient", data: { ...ing, index } };
    for (const [index, text] of r.steps.entries()) yield { type: "part", part: "step", data: { index, text } };
    yield { type: "part", part: "basics", data: { basics: r.basicsAssumed, note: basicsNote(r.basicsAssumed) } };
    yield { type: "done", result };
  }

  /** Your own pasted recipe, saved as typed (bullets → ingredients, numbered lines → steps). Not the AI writing one. */
  async function readPastedRecipe(input: PastedRecipeInput): Promise<RecipeResult> {
    const lines = input.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const ingredients = lines.filter((l) => /^[-•*]\s*/.test(l)).map((l) => ({ name: l.replace(/^[-•*]\s*/, ""), amount: null, item: null, basic: false }));
    const steps = lines.filter((l) => /^\d+\s*[.)]/.test(l));
    const result = toRecipeResult(
      { title: input.meal.title, summary: "Your recipe.", servings: null, ingredients, steps, reply: `Saved your recipe for ${input.meal.title}.` },
      {
        ctx: input,
        labels: labelMaps(input).toId,
        mealId: input.meal.mealId,
        fallbackTitle: input.meal.title,
        source: "user",
        opId: `${input.messageId}:recipe`,
        evidence: lines[0] ?? input.meal.title,
        pastedText: input.text,
      },
    );
    return result.ok ? result : { ok: false, reason: "failed", reply: "Sorry, I couldn't read that recipe just now, so nothing was saved." };
  }

  return {
    streamMealIdeas,
    generateMealIdeas: () => collectIdeas(streamMealIdeas()),
    streamRecipe,
    generateRecipe: (input) => collectRecipe(streamRecipe(input)),
    readPastedRecipe,
    async refineIdea() {
      return declined;
    },
  };
}
