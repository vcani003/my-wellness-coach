/**
 * Edit mode for refinements (ai.md §5): code applies the model's edits to the current recipe.
 * Positions are checked, unchanged lines stay byte-for-byte, flags are recomputed, and anything
 * that doesn't check out returns `ok: false` (the caller then rewrites the whole recipe).
 * Also: the fake's edit phrasings, and the "Here's a recipe" duplicate in the chat reply.
 */
import { describe, expect, it } from "vitest";
import { RecipeSave } from "@/contracts/operations";
import { withoutRecipeAnnouncement } from "@/ai/follow-ups";
import { applyRecipeEdits, MAX_EDITS } from "@/ai/meals/apply-edits";
import { labelMaps } from "@/ai/meals/context";
import type { RecipeEditOut } from "@/ai/meals/model-output";
import type { RecipeBuild } from "@/ai/meals/to-recipe";
import type { RecipeIngredientOut, RecipeInput } from "@/ai/meals/types";
import { fakeEdits } from "@/ai/fake/meals";
import { FAKE_RECIPE_CHANGE } from "@/ai/fake";
import { LEVI_SEAFOOD, mealContext, PASTA_KITCHEN, SHRIMP_KITCHEN } from "@/ai/eval/fixtures";

// PASTA_KITCHEN labels: i1 penne · i2 spinach · i3 milk · i4 cheddar · i5 garlic · i6 tomatoes · i7 beef mince · i8 honey
const ctx = mealContext(PASTA_KITCHEN);
const build: RecipeBuild = { ctx, labels: labelMaps(ctx).toId, mealId: "meal-pasta", fallbackTitle: "Spinach pasta", source: "ai", opId: "m-2:recipe", evidence: "x" };

const ing = (amount: string | null, name: string, itemId: string | null = null, group: RecipeIngredientOut["group"] = itemId ? "kitchen" : "need"): RecipeIngredientOut => ({
  name,
  amount,
  itemId,
  group,
  allergenFlags: [],
});

const current: NonNullable<RecipeInput["refine"]>["current"] = {
  title: "Spinach pasta",
  servings: "2",
  summary: "A quick weeknight pasta for Ana and Ben.",
  ingredients: [ing("200 g", "penne", "item-1"), ing("2 cloves", "garlic", "item-5"), ing("2", "eggs"), ing("100 g", "spinach", "item-2"), ing("1 tbsp", "cooking oil", null, "basic")],
  steps: [
    "Cook the penne in salted water until al dente.",
    "Fry the garlic in the oil for 1 minute.",
    "10-12 minutes later, beat the eggs.",
    "Stir in the spinach until wilted.",
    "Toss everything together and serve.",
  ],
};

const blank = { name: "", amount: "", item: "", text: "" };
const e = (op: RecipeEditOut["op"], at: number, fields: Partial<RecipeEditOut> = {}): RecipeEditOut => ({ ...blank, op, at, ...fields });

function ok(edits: RecipeEditOut[]) {
  const r = applyRecipeEdits(current, edits, "Done.", build);
  if (!r.ok) throw new Error(r.why);
  return r.result;
}

describe("applying edits", () => {
  it("adds an ingredient after a position and folds it into a step; nothing else changes", () => {
    const r = ok([e("add_ingredient", 4, { name: "baby carrots", amount: "1 cup" }), e("change_step", 4, { text: "Stir in the spinach and baby carrots until wilted." })]);
    expect(r.recipe.ingredients.map((i) => i.name)).toEqual(["penne", "garlic", "eggs", "spinach", "baby carrots", "cooking oil"]);
    expect(r.recipe.steps).toEqual([current.steps[0], current.steps[1], current.steps[2], "Stir in the spinach and baby carrots until wilted.", current.steps[4]]);
    expect(r.change).toEqual({ ingredients: [4], steps: [3], removed: { ingredients: 0, steps: 0 } });
    // Byte-for-byte: a step that the step cleaner would trim ("10-12 …") is copied, not re-cleaned.
    expect(r.recipe.steps[2]).toBe("10-12 minutes later, beat the eggs.");
    expect(r.recipe.title).toBe("Spinach pasta");
    expect(r.recipe.servings).toBe("2");
    expect(r.operation.text.split("\n").slice(0, 3)).toEqual(["Spinach pasta", "A quick weeknight pasta for Ana and Ben.", "Serves 2"]);
    expect(RecipeSave.safeParse(r.operation).success).toBe(true);
  });

  it("positions always refer to the recipe as sent, whatever else is edited", () => {
    const r = ok([e("remove_ingredient", 1), e("change_ingredient", 3, { name: "eggs", amount: "3" }), e("add_ingredient", 0, { name: "butter", amount: "1 tbsp" })]);
    expect(r.recipe.ingredients.map((i) => [i.amount, i.name])).toEqual([
      ["1 tbsp", "butter"],
      ["2 cloves", "garlic"],
      ["3", "eggs"],
      ["100 g", "spinach"],
      ["1 tbsp", "cooking oil"],
    ]);
    expect(r.change.ingredients).toEqual([0, 2]);
    expect(r.change.removed.ingredients).toBe(1);
  });

  it("'use 3 eggs instead of 2' with only the amount restated keeps the name", () => {
    const r = ok([e("change_ingredient", 3, { amount: "3" })]);
    expect(r.recipe.ingredients[2]).toMatchObject({ name: "eggs", amount: "3" });
  });

  it("removes a step", () => {
    const r = ok([e("remove_step", 4)]);
    expect(r.recipe.steps).toEqual([current.steps[0], current.steps[1], current.steps[2], current.steps[4]]);
    expect(r.change.steps).toEqual([]);
  });

  it("recomputes In your kitchen / Need, basics and allergen flags over the whole result", () => {
    const shrimpCtx = mealContext(SHRIMP_KITCHEN, { restrictions: [LEVI_SEAFOOD] });
    const b = { ...build, ctx: shrimpCtx, labels: labelMaps(shrimpCtx).toId };
    // Penne's kitchen item has gone since the last version.
    const gone = { ...current, ingredients: [ing("200 g", "penne", "item-gone"), ...current.ingredients.slice(1)] };
    const r = applyRecipeEdits(gone, [e("add_ingredient", 1, { name: "shrimp", amount: "100 g", item: "i1" })], "Added shrimp.", b);
    if (!r.ok) throw new Error(r.why);
    const shrimp = r.result.recipe.ingredients[1];
    expect(shrimp).toMatchObject({ name: "shrimp", itemId: "item-1", group: "kitchen" });
    expect(shrimp.allergenFlags[0]).toMatchObject({ subject: "seafood" });
    expect(r.result.recipe.allergenFlags.some((f) => f.ingredient === "shrimp")).toBe(true);
    // The pasta kitchen's penne isn't in this kitchen: an unchanged line moves to Need, as it would on a rewrite.
    expect(r.result.recipe.ingredients[0]).toMatchObject({ name: "penne", itemId: null, group: "need" });
    expect(r.result.recipe.basicsAssumed).toEqual(["cooking oil"]);
  });

  it("no edits: unchanged (nothing to save)", () => {
    expect(ok([])).toMatchObject({ unchanged: true });
  });

  it.each<[string, RecipeEditOut[]]>([
    ["a position past the end", [e("change_step", 6, { text: "x" })]],
    ["position 0 for a change", [e("remove_ingredient", 0)]],
    ["a negative add position", [e("add_step", -1, { text: "x" })]],
    ["a position that isn't a whole number", [e("change_ingredient", 1.5, { name: "x" })]],
    ["the same line edited twice", [e("change_step", 2, { text: "a" }), e("remove_step", 2)]],
    ["an empty new step", [e("change_step", 2, { text: "  " })]],
    ["an empty new ingredient", [e("add_ingredient", 1)]],
    ["every step removed", [1, 2, 3, 4, 5].map((n) => e("remove_step", n))],
    ["too many edits", Array.from({ length: MAX_EDITS + 1 }, (_, n) => e("add_step", 0, { text: `Step ${n}` }))],
  ])("rejects %s (the caller rewrites instead)", (_why, edits) => {
    expect(applyRecipeEdits(current, edits, "x", build).ok).toBe(false);
  });
});

describe("the fake's edit phrasings (e2e and testers)", () => {
  it.each([
    ["I'm using baby carrots too", ["add_ingredient", "change_step"]],
    ["no garlic", ["remove_ingredient"]],
    ["I don't have garlic", ["remove_ingredient"]],
    ["use 3 eggs instead of 2", ["change_ingredient"]],
    ["skip step 4", ["remove_step"]],
  ])("%s → %j", (text, ops) => {
    const out = fakeEdits(text, current);
    expect(out?.edits.map((x) => x.op)).toEqual(ops);
    expect(FAKE_RECIPE_CHANGE.test(text)).toBe(true);
    expect(applyRecipeEdits(current, out!.edits, out!.reply, build).ok).toBe(true);
  });

  it("anything else is a rewrite", () => {
    expect(fakeEdits("make it vegetarian", current)).toBeNull();
    expect(fakeEdits("no anchovies", current)).toBeNull(); // not in the recipe
  });
});

describe("'Here's a recipe' is said once (regression: it appeared twice in the reply)", () => {
  const recipe = [{ kind: "recipe" as const, meal: { chooseOpId: "x:dish" } }];
  it("drops the turn's own announcement when a recipe follow-up will say it", () => {
    expect(withoutRecipeAnnouncement("Chicken curry it is. I added potatoes. Here's a recipe.", recipe)).toBe("Chicken curry it is. I added potatoes.");
    expect(withoutRecipeAnnouncement("Good choice. Here’s the recipe.", recipe)).toBe("Good choice.");
    expect(withoutRecipeAnnouncement("Here's a recipe for Pad thai!", recipe)).toBe("");
  });
  it("keeps it when no recipe is coming, and leaves other sentences alone", () => {
    expect(withoutRecipeAnnouncement("Good choice. Here's the recipe.", [])).toBe("Good choice. Here's the recipe.");
    expect(withoutRecipeAnnouncement("Sure, I'll rework it without the oven.", [{ kind: "recipe", meal: { mealId: "m" }, refine: "no oven" }])).toBe(
      "Sure, I'll rework it without the oven.",
    );
    expect(withoutRecipeAnnouncement("Here's a recipe idea I love, the soup.", recipe)).toBe("Here's a recipe idea I love, the soup.");
  });
});
