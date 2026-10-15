/**
 * Recipe box (0040), pure parts: A2's lock and C's Make again through the real `planProposal` +
 * `apply` (replay == step by step), and the grouping / search / title rules behind Cooked before
 * and B1. Fictional people: Ana and Ben.
 */
import { describe, expect, it } from "vitest";
import { dishMatches, groupDishes, titleNames, type DoneMealRow } from "@/domains/kitchen/past-meals";
import { buildRecipeView } from "@/domains/kitchen/read-model";
import { MemoryKitchen } from "../support/memory-kitchen";

const codes = (p: { rejected: { reason: { code: string } }[] }) => p.rejected.map((r) => r.reason.code);

function kitchenWithCookedCurry() {
  const k = new MemoryKitchen();
  k.members = new Map([
    ["ana", "Ana"],
    ["ben", "Ben"],
  ]);
  const mealId = k.tap([{ type: "meal.choose", target: { title: "Chicken curry" } }], { actor: "ana" }).applied[0].refs[0].id;
  k.tap(
    [
      {
        type: "recipe.save",
        target: { mealId },
        source: "user",
        text: "Gran's curry",
        ingredients: [{ name: "chicken", itemId: "item-x", amount: "500 g" }, { name: "salt", basic: true }],
        steps: ["Brown", "Simmer"],
        basicsAssumed: ["salt"],
      },
      { type: "meal.transition", target: { mealId }, to: "cooking" },
      { type: "meal.transition", target: { mealId }, to: "done" },
    ],
    { actor: "ana" },
  );
  return { k, mealId };
}

describe("A2: Done and cancelled meals keep their recipe", () => {
  it("recipe.save on a done meal is RECIPE_LOCKED and saves nothing (regression: it used to add v2)", () => {
    const { k, mealId } = kitchenWithCookedCurry();
    const before = k.kitchen;
    const plan = k.tap([
      { type: "recipe.save", target: { mealId }, source: "ai", text: "changed", ingredients: [], steps: [], basicsAssumed: [] },
    ]);
    expect(codes(plan)).toEqual(["RECIPE_LOCKED"]);
    expect(plan.rejected[0].reason.text).toBe("Chicken curry is finished, so its recipe stays as it was. Make it again to change it.");
    expect(plan.events).toEqual([]);
    expect(k.kitchen).toBe(before);
  });

  it("records who cooked it", () => {
    const { k, mealId } = kitchenWithCookedCurry();
    expect(k.kitchen.meals[mealId].cookedBy).toBe("ana");
    expect(k.replayKitchen()).toEqual(k.kitchen);
  });
});

describe("C: meal.makeAgain", () => {
  it("one op: a new chosen meal + v1 copy without item links, provenance kept, source untouched", () => {
    const { k, mealId } = kitchenWithCookedCurry();
    const source = k.kitchen.meals[mealId];
    const sourceRecipe = k.kitchen.recipes[source.recipeId!];
    const plan = k.tap([{ type: "meal.makeAgain", fromMealId: mealId }], { actor: "ben" });
    expect(plan.rejected).toEqual([]);
    expect(plan.applied[0].summary.text).toBe("Making Chicken curry again");
    expect(plan.events.map((e) => e.type)).toEqual(["meal.chosen", "recipe.saved"]);
    const newId = plan.applied[0].refs[0].id;
    const meal = k.kitchen.meals[newId];
    expect(meal).toMatchObject({ title: "Chicken curry", status: "chosen", madeAgainFromMealId: mealId, createdBy: "ben" });
    const copy = k.kitchen.recipes[meal.recipeId!];
    expect(copy).toMatchObject({
      mealId: newId,
      version: 1,
      source: "user",
      text: "Gran's curry",
      steps: ["Brown", "Simmer"],
      basicsAssumed: ["salt"],
      copiedFromRecipeId: sourceRecipe.id,
      ingredients: [{ name: "chicken", amount: "500 g" }, { name: "salt", basic: true }],
    });
    expect(k.kitchen.meals[mealId]).toBe(source);
    expect(k.kitchen.recipes[sourceRecipe.id]).toBe(sourceRecipe);
    expect(plan.touched.sort()).toEqual([`meal:${newId}`, `recipe:${copy.id}`].sort());
    expect(k.replayKitchen()).toEqual(k.kitchen);
  });

  it("RBX1: refused with the live copy's ID while it's chosen, planned or cooking", () => {
    const { k, mealId } = kitchenWithCookedCurry();
    const copyId = k.tap([{ type: "meal.makeAgain", fromMealId: mealId }]).applied[0].refs[0].id;
    k.tap([{ type: "meal.plan", target: { mealId: copyId } }]);
    const again = k.tap([{ type: "meal.makeAgain", fromMealId: mealId }]);
    expect(codes(again)).toEqual(["ALREADY_MAKING"]);
    expect(again.rejected[0].reason.params).toEqual({ title: "Chicken curry", mealId: copyId });
    // A fresh meal with the same name that wasn't made again doesn't count.
    k.tap([{ type: "meal.transition", target: { mealId: copyId }, to: "cancelled" }]);
    k.tap([{ type: "meal.choose", target: { title: "chicken curry" } }]);
    expect(codes(k.tap([{ type: "meal.makeAgain", fromMealId: mealId }]))).toEqual([]);
  });

  it("only from a Done meal", () => {
    const k = new MemoryKitchen();
    const live = k.tap([{ type: "meal.choose", target: { title: "Tacos" } }]).applied[0].refs[0].id;
    expect(codes(k.tap([{ type: "meal.makeAgain", fromMealId: live }]))).toEqual(["INVALID_OPERATION"]);
    expect(codes(k.tap([{ type: "meal.makeAgain", fromMealId: "nope" }]))).toEqual(["UNKNOWN_TARGET"]);
  });
});

describe("RBX3: the recipe view carries the after-cooking note and its writer", () => {
  it("note by Ben on Ana's cook", () => {
    const { k, mealId } = kitchenWithCookedCurry();
    k.tap([{ type: "meal.transition", target: { mealId }, to: "done", note: "less salt next time" }], { actor: "ben" });
    const view = buildRecipeView(k.kitchen, mealId, { names: k.members, restrictions: [] });
    expect(view?.note).toEqual({ text: "less salt next time", by: { id: "ben", name: "Ben" } });
    expect(k.replayKitchen()).toEqual(k.kitchen);
  });
});

const row = (mealId: string, title: string, day: number, ingredients: string[] = []): DoneMealRow => ({
  mealId,
  title,
  cookedAt: new Date(Date.UTC(2026, 9, day, 18)),
  cookedBy: "ana",
  updatedBy: "ana",
  note: null,
  noteBy: null,
  recipe: { id: `r-${mealId}`, version: 1, source: "ai", ingredients: ingredients.map((name) => ({ name })) },
});

describe("Cooked before: grouping and matching", () => {
  it("groups by folded title, newest dish first, cooks newest first (RB3)", () => {
    const groups = groupDishes([row("a", "Phở bò", 3), row("b", "Chicken curry", 1), row("c", "PHO BO!", 9), row("d", "chicken curry", 5)]);
    expect(groups.map((g) => g.cooks.map((c) => c.mealId))).toEqual([["c", "a"], ["d", "b"]]);
  });

  it("matches name or any cook's ingredients (RB9)", () => {
    const [g] = groupDishes([row("a", "Pad thai", 1, ["peanuts"]), row("b", "Pad thai", 2, ["tofu"])]);
    expect(dishMatches(g, "peanut")).toBe(true);
    expect(dishMatches(g, "TOFU")).toBe(true);
    expect(dishMatches(g, "pad")).toBe(true);
    expect(dishMatches(g, "beef")).toBe(false);
  });

  it("B1 title rule: every word said starts a title word; filler ignored; empty never matches", () => {
    expect(titleNames("that curry", "Chicken curry")).toBe(true);
    expect(titleNames("the pho", "Phở bò")).toBe(true);
    expect(titleNames("curry chicken", "Chicken curry")).toBe(true);
    expect(titleNames("beef curry", "Chicken curry")).toBe(false);
    expect(titleNames("the", "Chicken curry")).toBe(false);
    expect(titleNames("", "Chicken curry")).toBe(false);
  });
});
