/**
 * Real-model eval for refinement edit mode (ai.md §5, §8), scored by exact rules. Run alone with
 * `npm run eval -- recipe-edits`; skipped unless ANTHROPIC_API_KEY is set. Costs real money: about
 * 7 calls. Ana's skillet hash, then small changes (edits) and one broad change (a rewrite).
 *
 * It also measures what edit mode saves: the baby-carrots change is run once in edit mode and once
 * through the full-rewrite path (the first call is answered locally with edits that don't check
 * out, so only the rewrite reaches the API), and the latency and cost of each are printed.
 */
import { afterAll, describe, expect, it } from "vitest";
import { RecipeSave } from "@/contracts/operations";
import { createRealMealAI, sdkStreaming, type MealLog, type StreamingMessagesApi } from "../real/meals";
import type { RecipeIngredientOut, RecipeInput, RecipeResult } from "../meals/types";
import { mealContext, NOW, type ItemSpec } from "./fixtures";

const ANA_KITCHEN: ItemSpec[] = [
  { name: "chicken thighs", location: "fridge", daysAgo: 1 },
  { name: "potatoes", location: "pantry" },
  { name: "onions", location: "pantry" },
  { name: "garlic", location: "pantry" },
  { name: "eggs", location: "fridge", daysAgo: 2 },
  { name: "spinach", location: "fridge", daysAgo: 1 },
];
// Labels: i1 chicken thighs · i2 potatoes · i3 onions · i4 garlic · i5 eggs · i6 spinach

const ing = (amount: string, name: string, itemId: string | null = null, group: RecipeIngredientOut["group"] = itemId ? "kitchen" : "need"): RecipeIngredientOut => ({
  name,
  amount,
  itemId,
  group,
  allergenFlags: [],
});

const V1: NonNullable<RecipeInput["refine"]>["current"] = {
  title: "Chicken and potato hash",
  servings: "2",
  summary: "A one-pan hash with eggs on top.",
  ingredients: [
    ing("2", "chicken thighs", "item-1"),
    ing("3", "potatoes", "item-2"),
    ing("1", "onion", "item-3"),
    ing("2 cloves", "garlic", "item-4"),
    ing("a handful", "spinach", "item-6"),
    ing("2", "eggs", "item-5"),
    ing("2 tbsp", "cooking oil", null, "basic"),
    ing("to taste", "salt", null, "basic"),
  ],
  steps: [
    "Dice the potatoes and boil them for 5 minutes, then drain.",
    "Cut the chicken thighs into bite-size pieces.",
    "Fry the chicken in half the oil for 6–8 minutes until golden, then set it aside.",
    "Fry the potatoes and onion in the rest of the oil for 10 minutes until crisp.",
    "Add the garlic and spinach, then return the chicken to the pan and season with salt.",
    "Make two wells, crack in the eggs, cover and cook for 4 minutes until set.",
  ],
};

const ctx = mealContext(ANA_KITCHEN, { userId: "u-ana" });
const meal = { mealId: "meal-hash", title: "Chicken and potato hash" };
const input = (text: string, n: number): RecipeInput => ({ ...ctx, meal, refine: { messageId: `m-${n}`, text, current: V1 } });

const usage: Array<Extract<MealLog, { event: "ai.usage" }> & { label: string }> = [];
let label = "";
const log = (e: MealLog) => (e.event === "ai.usage" ? usage.push({ ...e, label }) : console.warn(JSON.stringify(e)));
const meals = createRealMealAI({ now: () => NOW, log });

/** The same AI, but its first call per request is answered locally with edits that don't check out. */
function rewriteOnly(): ReturnType<typeof createRealMealAI> {
  const real = sdkStreaming();
  let first = true;
  const api: StreamingMessagesApi = {
    stream(body, options) {
      if (!first) return real.stream(body, options);
      first = false;
      const text = JSON.stringify({ mode: "edit", edits: [{ op: "remove_step", at: 99, name: "", amount: "", item: "", text: "" }], recipe: null, reply: "" });
      return {
        async *textDeltas() {
          yield text;
        },
        finalMessage: async () =>
          ({ model: "local", stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 0, output_tokens: 0 } }) as never,
      };
    },
  };
  return createRealMealAI({ messages: api, now: () => NOW, log });
}

function ok(r: RecipeResult) {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error("failed");
  expect(RecipeSave.safeParse(r.operation).success).toBe(true);
  return r;
}
const show = (name: string, r: Extract<RecipeResult, { ok: true }>) =>
  console.info(
    `\n--- ${name} (${r.change ? `edit: ingredients ${JSON.stringify(r.change.ingredients)}, steps ${JSON.stringify(r.change.steps)}` : "rewrite"}) ---\nreply: ${r.reply}\n${r.recipe.ingredients.map((i) => `- ${i.amount ?? ""} ${i.name}`).join("\n")}\n${r.recipe.steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}`,
  );
const others = <T,>(list: T[], changed: number[]) => list.filter((_, i) => !changed.includes(i));
const amountOf = (r: Extract<RecipeResult, { ok: true }>, re: RegExp) => r.recipe.ingredients.find((i) => re.test(i.name))?.amount ?? null;

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("refinement edit mode (real model)", () => {
  afterAll(() => {
    for (const u of usage) console.info(`${u.label.padEnd(28)} ${u.task.padEnd(14)} in ${u.inputTokens} + cache ${u.cacheReadTokens}r/${u.cacheWriteTokens}w · out ${u.outputTokens} · ${u.ms} ms · $${u.estCostUsd.toFixed(4)}`);
    const cost = usage.reduce((s, u) => s + u.estCostUsd, 0);
    console.info(`recipe-edits eval: ${usage.length} calls, ~$${cost.toFixed(2)}`);
  });

  it("'I'm using baby carrots too' adds the ingredient and works it into a step; nothing else changes", async () => {
    label = "baby carrots (edit)";
    const r = ok(await meals.generateRecipe(input("I'm using baby carrots too", 1)));
    show(label, r);
    expect(r.change).toBeDefined();
    const carrots = r.recipe.ingredients.findIndex((i) => /carrot/i.test(i.name));
    expect(carrots).toBeGreaterThanOrEqual(0);
    expect(r.change!.ingredients).toContain(carrots);
    expect(r.recipe.steps.some((s) => /carrot/i.test(s))).toBe(true);
    expect(others(r.recipe.ingredients, r.change!.ingredients).map((i) => [i.amount, i.name])).toEqual(V1.ingredients.map((i) => [i.amount, i.name]));
    expect(r.change!.steps.length).toBeLessThanOrEqual(2);
    expect(others(r.recipe.steps, r.change!.steps).every((s) => V1.steps.includes(s))).toBe(true);
    expect(r.recipe.servings).toBe("2");
    expect(r.reply).toMatch(/carrot/i);
  });

  it("'no garlic' removes it from the ingredients and every step", async () => {
    label = "no garlic (edit)";
    const r = ok(await meals.generateRecipe(input("no garlic", 2)));
    show(label, r);
    expect(r.change).toBeDefined();
    expect(r.recipe.ingredients.some((i) => /garlic/i.test(i.name))).toBe(false);
    expect(r.recipe.steps.join(" ")).not.toMatch(/garlic/i);
    expect(r.recipe.ingredients).toHaveLength(V1.ingredients.length - 1);
    expect(others(r.recipe.steps, r.change!.steps).every((s) => V1.steps.includes(s))).toBe(true);
  });

  it("'use 3 eggs instead of 2' changes the eggs, not the whole recipe", async () => {
    label = "3 eggs (edit)";
    const r = ok(await meals.generateRecipe(input("use 3 eggs instead of 2", 3)));
    show(label, r);
    expect(r.change).toBeDefined();
    expect(amountOf(r, /egg/i)).toMatch(/^3\b/);
    for (const re of [/chicken/i, /potato/i, /onion/i, /garlic/i]) expect(amountOf(r, re)).toBe(V1.ingredients.find((i) => re.test(i.name))!.amount);
    expect(r.recipe.servings).toBe("2");
  });

  // Step 4 cooks the potatoes and onion, so the model may fold them into neighbouring steps (and
  // trim the oil); lines unrelated to that stay byte-for-byte.
  it("'skip step 4' removes that step and leaves unrelated lines alone", async () => {
    label = "skip step 4 (edit)";
    const r = ok(await meals.generateRecipe(input("skip step 4", 4)));
    show(label, r);
    expect(r.change).toBeDefined();
    expect(r.recipe.steps).not.toContain(V1.steps[3]);
    expect(r.recipe.steps.length).toBe(V1.steps.length - 1);
    expect(r.recipe.steps).toContain(V1.steps[1]);
    expect(r.recipe.steps).toContain(V1.steps[5]);
    const notOil = (xs: { amount: string | null; name: string }[]) => xs.filter((i) => !/oil/i.test(i.name)).map((i) => [i.amount, i.name]);
    expect(notOil(r.recipe.ingredients)).toEqual(notOil(V1.ingredients));
  });

  it("a broad change ('make it vegetarian') rewrites the whole recipe", async () => {
    label = "vegetarian (rewrite)";
    const r = ok(await meals.generateRecipe(input("make it vegetarian", 5)));
    show(label, r);
    expect(r.change).toBeUndefined();
    expect(r.recipe.ingredients.some((i) => /chicken|meat|bacon|ham/i.test(i.name))).toBe(false);
    expect(r.recipe.steps.join(" ")).not.toMatch(/chicken/i);
  });

  it("measure: the baby-carrots change through the full rewrite path, for comparison", async () => {
    label = "baby carrots (full rewrite)";
    const r = ok(await rewriteOnly().generateRecipe(input("I'm using baby carrots too", 6)));
    show(label, r);
    expect(r.change).toBeUndefined();
    expect(r.recipe.ingredients.some((i) => /carrot/i.test(i.name))).toBe(true);
  });
});
