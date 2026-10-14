/**
 * ⚠️ FAKE MEAL AI (a stand-in, NOT the real AI): deterministic ideas and recipes so local dev and
 * the end-to-end tests run with no accounts (backend-data.md §8). It builds model-shaped answers
 * from the kitchen and sends them through the SAME code guards as the real one (uses/missing,
 * basics, allergen flags and the leave-out rule, the In-your-kitchen/Need split, recipe.save).
 */
import { askedAllergies } from "../meals/allergen-guard";
import { basicsNote } from "../meals/basics";
import { labelMaps } from "../meals/context";
import { matchKitchenItem } from "../meals/match";
import type { IdeaOut, RecipeOutput } from "../meals/model-output";
import { toIdea } from "../meals/to-ideas";
import { toRecipeResult } from "../meals/to-recipe";
import type {
  GeneratedIdea,
  IdeasEvent,
  MealAI,
  MealIdeasInput,
  PastedRecipeInput,
  RecipeEvent,
  RecipeInput,
  RecipeResult,
} from "../meals/types";
import { allergenExcusedIds, rankUseItUp } from "../meals/use-it-up";
import { collectIdeas, collectRecipe } from "../real/meals";

/**
 * A named dish's ingredients (MI1), the fake way: kitchen items a word of the title names
 * ("chicken" → chicken thighs), then everything listed in the notes ("with X, Y and Z", "I have
 * X"), as said. Code then sorts them into In your kitchen / Need, as for the real model.
 */
function dishIngredients(input: RecipeInput, toLabel: Map<string, string>): RecipeOutput["ingredients"] {
  const fromTitle = input.meal.title
    .split(/\s+/)
    .map((word) => matchKitchenItem(input.state, word))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const named = (input.meal.notes ?? "")
    .split(/[.!?;]+/)
    .map((s) => s.trim().replace(/^(?:and\s+)?(?:with|(?:i|we)\s+(?:also\s+)?(?:have|'ve got|got)|use)\s+(?:also\s+)?/i, ""))
    .flatMap((s) => s.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i))
    .map((s) => s.trim().replace(/^(?:a|an|some|the)\s+/i, ""))
    .filter(Boolean);
  const out: RecipeOutput["ingredients"] = [];
  const seen = new Set<string>();
  for (const item of fromTitle) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ name: item.name.value, amount: null, item: toLabel.get(item.id) ?? null, basic: false });
  }
  for (const name of named) {
    const item = matchKitchenItem(input.state, name);
    if (item && seen.has(item.id)) continue;
    if (item) seen.add(item.id);
    out.push({ name, amount: null, item: item ? (toLabel.get(item.id) ?? null) : null, basic: false });
  }
  return out;
}

const title = (s: string) => s.replace(/\s*\(.*?\)\s*/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());

export function createFakeMealAI(now: () => Date = () => new Date()): MealAI {
  async function* streamMealIdeas(input: MealIdeasInput): AsyncGenerator<IdeasEvent> {
    const at = now();
    const count = input.count ?? 3;
    const { toId, toLabel } = labelMaps(input);
    const ranked = rankUseItUp(input.state, at);
    const rankedIds = new Set(ranked.map((r) => r.itemId));
    const order = [...ranked.map((r) => r.itemId), ...input.state.items.map((i) => i.id).filter((id) => !rankedIds.has(id))];
    const raw: IdeaOut[] = [];
    const asked = input.request?.text.trim();
    if (asked && /\b(taco|soup|salad|curry|stir.?fry|omelette|pasta|noodle|rice|pho)/i.test(asked)) {
      raw.push({ name: title(asked.replace(/[?!.]+$/, "")), why: "You asked for it", uses: [], missing: [asked.replace(/[?!.]+$/, "")], basics: ["salt"] });
    }
    for (const id of order) {
      const item = input.state.items.find((i) => i.id === id)!;
      const reason = ranked.find((r) => r.itemId === id)?.reasons[0];
      raw.push({
        name: `${title(item.name.value)} rice bowl`,
        why: reason ? `Uses the ${item.name.value} (${reason})` : `Uses your ${item.name.value}`,
        uses: [toLabel.get(id)!],
        missing: [],
        basics: ["salt", "cooking oil"],
      });
    }
    const guard = {
      ctx: input,
      labels: toId,
      useItUp: rankedIds,
      allergenExcused: allergenExcusedIds(ranked),
      asked: askedAllergies(input.request?.text, input.restrictions),
    };
    const kept: GeneratedIdea[] = [];
    let dropped = 0;
    for (const r of raw) {
      if (kept.length >= count) break;
      const v = toIdea(r, guard);
      if (!v) continue;
      if (!v.keep) {
        dropped++;
        continue;
      }
      kept.push(v.idea);
      yield { type: "idea", idea: v.idea };
    }
    const droppedForAllergens = Math.min(dropped, Math.max(0, count - kept.length));
    const note = basicsNote([...new Set(kept.flatMap((k) => k.basics))]);
    const reply = kept.length ? "Here are some ideas from your kitchen." : "Nothing in your kitchen fits that right now.";
    yield { type: "done", result: { ok: true, ideas: kept, reply, notes: note ? [note] : [], droppedForAllergens } };
  }

  async function* streamRecipe(input: RecipeInput): AsyncGenerator<RecipeEvent> {
    const { toId, toLabel } = labelMaps(input);
    const idea = input.meal.idea;
    const current = input.refine?.current;
    const out: RecipeOutput = current
      ? {
          title: current.title,
          summary: `Adjusted: ${input.refine!.text}`,
          servings: current.servings ?? "2",
          ingredients: current.ingredients.map((i) => ({ name: i.name, amount: i.amount, item: i.itemId ? (toLabel.get(i.itemId) ?? null) : null, basic: i.group === "basic" })),
          steps: [...current.steps, `Adjusted for: ${input.refine!.text}`],
          reply: "Here's the updated recipe.",
        }
      : {
          title: input.meal.title,
          summary: "A quick suggestion from your kitchen.",
          servings: "2",
          ingredients: [
            ...(!idea ? dishIngredients(input, toLabel) : []),
            ...(idea?.uses ?? []).map((id) => ({ name: input.state.items.find((i) => i.id === id)?.name.value ?? "", amount: null, item: toLabel.get(id) ?? null, basic: false })),
            ...(idea?.missing ?? []).map((name) => ({ name, amount: null, item: null, basic: false })),
            { name: "salt", amount: "a pinch", item: null, basic: true },
            { name: "cooking oil", amount: "1 tbsp", item: null, basic: true },
          ],
          steps: ["Prepare the ingredients.", "Cook everything in a hot pan with the oil.", "Season with salt and serve."],
          reply: `Here's a recipe for ${input.meal.title}.`,
        };
    const result = toRecipeResult(out, {
      ctx: input,
      labels: toId,
      mealId: input.meal.mealId,
      fallbackTitle: input.meal.title,
      source: "ai",
      opId: input.refine ? `${input.refine.messageId}:recipe` : `recipe:${input.meal.mealId}`,
      ...(input.refine ? { evidence: input.refine.text } : {}),
    });
    if (!result.ok) {
      yield { type: "done", result: { ok: false, reason: "failed", reply: "Sorry, I couldn't write the recipe just now. Please try again." } };
      return;
    }
    const r = result.recipe;
    yield { type: "part", part: "meta", data: { title: r.title, summary: r.summary, servings: r.servings, source: "ai", allergenFlags: r.allergenFlags } };
    for (const [index, ing] of r.ingredients.entries()) yield { type: "part", part: "ingredient", data: { ...ing, index } };
    for (const [index, text] of r.steps.entries()) yield { type: "part", part: "step", data: { index, text } };
    yield { type: "part", part: "basics", data: { basics: r.basicsAssumed, note: basicsNote(r.basicsAssumed) } };
    yield { type: "done", result };
  }

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
    generateMealIdeas: (input) => collectIdeas(streamMealIdeas(input)),
    streamRecipe,
    generateRecipe: (input) => collectRecipe(streamRecipe(input)),
    readPastedRecipe,
  };
}
