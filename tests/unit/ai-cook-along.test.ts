/**
 * Cook-along refinements (0013 "refine in chat"): each change builds on the latest saved version,
 * and that version keeps what it serves, so "only 2 cups of penne, not 4" can scale everything.
 */
import { describe, expect, it } from "vitest";
import type { RecipeView } from "@/contracts/kitchen-state";
import { refineCurrent } from "@/ai/follow-ups";
import { renderRecipeRequest } from "@/ai/meals/context";
import { savedRecipeMeta, toRecipeResult } from "@/ai/meals/to-recipe";
import { PASTA_KITCHEN, mealContext, NOW } from "@/ai/eval/fixtures";

const ctx = mealContext(PASTA_KITCHEN);

function saved() {
  const r = toRecipeResult(
    {
      title: "Pasta bake",
      summary: "A weeknight bake from what Ana has.",
      servings: "4",
      ingredients: [
        { name: "cups penne", amount: "4", item: "i1", basic: false },
        { name: "onions", amount: "2", item: "i2", basic: false },
        { name: "cream", amount: "300 ml", item: null, basic: false },
      ],
      steps: ["Boil the penne.", "Simmer with the onions and cream for 20 minutes."],
      reply: "Here is a bake for tonight.",
    },
    { ctx, labels: new Map([["i1", "item-1"], ["i2", "item-2"]]), mealId: "meal-bake", fallbackTitle: "Pasta bake", source: "ai", opId: "op-1" },
  );
  if (!r.ok) throw new Error(JSON.stringify(r));
  const op = r.operation;
  const view = {
    id: "recipe-1",
    meal: { id: "meal-bake", title: "Pasta bake" },
    version: 1,
    source: "ai",
    text: op.text,
    ingredients: op.ingredients.map((i) => ({ name: i.name, ...(i.amount ? { amount: i.amount } : {}), ...(i.itemId ? { item: { id: i.itemId, name: i.name } } : {}) })),
    steps: op.steps,
    basicsAssumed: op.basicsAssumed,
    allergenFlags: [],
  } as unknown as RecipeView;
  return view;
}

describe("refining builds on the latest saved version", () => {
  it("reads title and servings back from the saved text", () => {
    expect(savedRecipeMeta(saved().text, "ai")).toEqual({ title: "Pasta bake", servings: "4", summary: "A weeknight bake from what Ana has." });
    expect(savedRecipeMeta("Pasta bake\nA bake.\n\nIngredients", "ai")).toEqual({ title: "Pasta bake", servings: null, summary: "A bake." });
    expect(savedRecipeMeta("Pasta bake\n\nServes 2\n\nIngredients", "ai")).toEqual({ title: "Pasta bake", servings: "2", summary: null });
    expect(savedRecipeMeta("Serves 4\nanything pasted", "user")).toEqual({ title: null, servings: null, summary: null });
  });

  it("the refine context keeps servings, so scaling has a number to scale from (regression: it was always null)", () => {
    const current = refineCurrent(saved(), "Pasta bake");
    expect(current.servings).toBe("4");
    expect(current.ingredients.map((i) => [i.amount, i.name])).toEqual([
      ["4", "cups penne"],
      ["2", "onions"],
      ["300 ml", "cream"],
    ]);
    const prompt = renderRecipeRequest(
      { ...ctx, meal: { mealId: "meal-bake", title: "Pasta bake" }, refine: { messageId: "m-2", text: "I only have 2 cups of penne, not 4", current } },
      NOW,
    );
    // Numbered, with the kitchen label, so an edit can name the line (ai.md §5 edit mode).
    expect(prompt).toContain("<current_recipe>\nTitle: Pasta bake\nServings: 4\nIngredients:\n1. 4 cups penne [i1]\n2. 2 onions [i2]\n3. 300 ml cream\nSteps:\n1. Boil the penne.");
    expect(prompt).toContain("<change_request>\nI only have 2 cups of penne, not 4\n</change_request>");
  });
});
