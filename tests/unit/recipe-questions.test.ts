/**
 * 0059 (2026-10-17 preview feedback): recipes have amounts (PF1), and a question about a recipe
 * changes nothing (PF2). Covers the code guard that a question never removes kitchen items, and
 * the stand-in AI (PF10): only clearly titled sample recipes (amounts, real steps), and the decline
 * line for recipe questions and changes. People are fictional (Ana).
 */
import { describe, expect, it } from "vitest";
import type { Operation } from "@/contracts/operations";
import { KitchenState } from "@/contracts/kitchen-state";
import { createFakeInterpreter, STAND_IN_DECLINE_REPLY } from "@/ai/fake";
import { sampleRecipeTitle } from "@/ai/fake/decline";
import { createFakeMealAI } from "@/ai/fake/meals";
import { matchIntent } from "@/ai/fake/patterns";
import { dishKind, fakeAmount, fakeSteps } from "@/ai/fake/recipes";
import { askedNotTold, guardQuestionRemovals, isQuestion, QUESTION_KEPT_REPLY } from "@/ai/question-guard";
import type { InterpretRequest, InterpretResult } from "@/ai/interpreter";
import { missingAmounts } from "@/ai/meals/to-recipe";
import { isBasic } from "@/ai/meals/basics";
import type { RecipeInput, RecipeResult } from "@/ai/meals/types";
import { kitchen, mealContext, type ItemSpec } from "@/ai/eval/fixtures";

/** Ana's notes, in the style of the preview message (fictional). */
const ANA_TAMAGOYAKI = "I want to make japanese rolled omelette. Season it with only hondashi. I like it a little sweet";
const ANA_NOTES = "Season it with only hondashi. I like it a little sweet";
const EGG_KITCHEN: ItemSpec[] = [{ name: "eggs", location: "fridge", daysAgo: 1 }, { name: "spinach", location: "fridge", daysAgo: 1 }];

const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
const use = (name: string, evidence: string): Operation => ({ opId: "1", type: "item.use", evidence, target: { name }, fields: { stock: said("out" as const) } });
const remove = (name: string, evidence: string): Operation => ({ opId: "2", type: "item.remove", evidence, target: { name } });
const add = (name: string, evidence: string): Operation => ({ opId: "3", type: "item.add", evidence, fields: { name: said(name) } });
const proposal = (operations: Operation[]): InterpretResult["proposal"] => ({
  proposalId: "m1",
  kitchenId: "k1",
  basedOnVersion: 1,
  source: { via: "chat", messageId: "m1" },
  operations,
});

describe("code guard: a question never removes anything (PF2)", () => {
  it.each([
    ["how much eggs do I need?", "how much eggs do I need"],
    ["no measurements for the eggs?", "no measurements for the eggs"],
    ["what are the measurements?", "what are the measurements"],
    ["Should I throw out the milk?", "throw out the milk"],
    ["hmm, how many eggs do I need", "how many eggs do I need"],
    ["I want to make it, how much eggs do I need?", "how much eggs do I need"],
    ["are we out of eggs?", "out of eggs"],
  ])("asked: %s", (text, evidence) => {
    expect(askedNotTold(text, evidence)).toBe(true);
  });

  it.each([
    ["I used the rest of the spinach, what can I make?", "I used the rest of the spinach"],
    ["throw out the milk, eggs and bread", "eggs"],
    ["We're out of eggs.", "We're out of eggs"],
    ["Can you throw out the milk?", "Can you throw out the milk"],
    ["please take eggs off the list?", "take eggs off the list"],
    ["I threw out the milk, is that ok?", "I threw out the milk"],
    ["I finished the eggs. How much rice is left?", "I finished the eggs"],
  ])("told: %s", (text, evidence) => {
    expect(askedNotTold(text, evidence)).toBe(false);
  });

  it("evidence it can't find is judged on the whole message", () => {
    expect(askedNotTold("no measurements for the eggs?", "something else")).toBe(true);
    expect(askedNotTold("I used the eggs", undefined)).toBe(false);
    expect(isQuestion("how long do I cook it")).toBe(true);
    expect(isQuestion("make it spicier")).toBe(false);
  });

  it("drops only the asked removal; adds and told removals stay; the reply is no longer the draft", () => {
    const text = "I bought milk. Should I throw out the eggs?";
    const r: InterpretResult = { kind: "change", reply: "Done: added milk and removed eggs.", proposal: proposal([add("milk", "I bought milk"), remove("eggs", "throw out the eggs")]) };
    const g = guardQuestionRemovals(r, text);
    expect(g.dropped.map((o) => o.type)).toEqual(["item.remove"]);
    expect(g.result.proposal?.operations.map((o) => o.type)).toEqual(["item.add"]);
    expect(g.result.reply).toBe("");
  });

  it("with nothing left: no proposal, a plain 'didn't change anything' reply", () => {
    const r: InterpretResult = { kind: "change", reply: "Got it: marked eggs used up.", proposal: proposal([use("eggs", "no measurements for the eggs")]) };
    const g = guardQuestionRemovals(r, "no measurements for the eggs?");
    expect(g.result).toMatchObject({ kind: "answer", proposal: null, reply: QUESTION_KEPT_REPLY });
  });

  it("with a recipe follow-up left: the follow-up answers (empty draft)", () => {
    const r: InterpretResult = {
      kind: "change",
      reply: "Marked eggs used.",
      proposal: proposal([use("eggs", "how much eggs do I need")]),
      followUps: [{ kind: "recipe", meal: { mealId: "meal-1" }, refine: "how much eggs do I need?" }],
    };
    const g = guardQuestionRemovals(r, "how much eggs do I need?");
    expect(g.result.proposal).toBeNull();
    expect(g.result.reply).toBe("");
    expect(g.result.followUps).toHaveLength(1);
  });

  it("a told removal passes untouched (same object)", () => {
    const r: InterpretResult = { kind: "change", reply: "Done.", proposal: proposal([remove("milk", "throw out the milk")]) };
    expect(guardQuestionRemovals(r, "throw out the milk").result).toBe(r);
  });
});

describe("PF1: the missing-amount check", () => {
  it("names non-basic ingredients with no amount; to-taste basics are fine", () => {
    expect(missingAmounts([{ name: "eggs", amount: null }, { name: "salt", amount: null }, { name: "pepper", amount: "" }, { name: "hondashi", amount: "1 tsp" }, { name: "cooking oil", amount: null }])).toEqual(["eggs"]);
  });
});

// ─── The stand-in AI (0059 PF10: only sample recipes; questions need the real AI) ─────────

async function sampleRecipe(dish: string, items = EGG_KITCHEN): Promise<Extract<RecipeResult, { ok: true }>> {
  const r = await createFakeMealAI().generateRecipe({ ...mealContext(items), meal: { mealId: "meal-1", title: sampleRecipeTitle(dish) } });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
}

function currentOf(r: Extract<RecipeResult, { ok: true }>): NonNullable<RecipeInput["refine"]>["current"] {
  const { title, summary, servings, ingredients, steps } = r.recipe;
  return { title, summary, servings, ingredients, steps };
}

describe("stand-in sample recipes (PF10): clearly titled templates with amounts and real steps", () => {
  it("'Sample recipe (stand-in): Japanese rolled omelette': the eggs from the kitchen with an amount, rolled steps", async () => {
    const r = await sampleRecipe("japanese rolled omelette");
    expect(r.recipe.title).toBe("Sample recipe (stand-in): Japanese rolled omelette");
    expect(r.recipe.summary).toMatch(/stand-in/);
    expect(r.recipe.ingredients.find((i) => i.name === "eggs")).toMatchObject({ amount: "4", group: "kitchen" });
    for (const i of r.recipe.ingredients) if (!isBasic(i.name)) expect(i.amount, i.name).toBeTruthy();
    expect(r.recipe.steps.join(" ")).toMatch(/roll/i);
    expect(r.recipe.servings).toBe("2");
  });

  it.each([
    ["Spinach pasta", "pasta", 5],
    ["Chicken curry", "curry", 4],
    ["Beef stir-fry", "stir-fry", 4],
    ["Shakshuka", "general", 4],
    ["", "general", 4],
  ])("'%s' → %s template, amounts everywhere, a Need list, at least %d steps", async (dish, kind, min) => {
    expect(dishKind(dish)).toBe(kind);
    const r = await sampleRecipe(dish, [{ name: "chicken thighs", location: "fridge" }, { name: "beef", location: "fridge" }]);
    expect(r.recipe.title).toBe(dish ? `Sample recipe (stand-in): ${dish}` : "Sample recipe (stand-in)");
    expect(missingAmounts(r.recipe.ingredients)).toEqual([]);
    expect(r.recipe.ingredients.some((i) => i.group === "need")).toBe(true);
    expect(r.recipe.steps.length).toBeGreaterThanOrEqual(min);
  });

  it("amounts come from the name table", () => {
    expect(["coconut milk", "curry base seasoning packet", "potatoes", "hondashi", "eggs"].map(fakeAmount)).toEqual(["1 can (400 ml)", "1 packet", "2 medium", "1 tsp", "4"]);
  });

  it("steps always use the recipe's own amounts and never fewer than 4", () => {
    const steps = fakeSteps("Toast", [{ name: "bread", amount: "2 slices", item: null, basic: false }], { salt: true });
    expect(steps.length).toBeGreaterThanOrEqual(4);
  });

  it("a recipe that isn't a sample is never written by the stand-in", async () => {
    const r = await createFakeMealAI().generateRecipe({ ...mealContext(EGG_KITCHEN), meal: { mealId: "meal-1", title: "Japanese rolled omelette", notes: ANA_NOTES } });
    expect(r).toEqual({ ok: false, reason: "not-configured", reply: STAND_IN_DECLINE_REPLY });
  });
});

describe("stand-in and recipe questions (PF10 replaces the stand-in's PF2 answers): the decline line, no change", () => {
  const now = new Date();
  const actor = { id: "u-ana", name: "Ana" };
  const at = new Date(now.getTime() - 60_000).toISOString();
  const openMeal = { id: "meal-1", title: "Sample recipe (stand-in)", status: "chosen" as const, chosenAt: at, allergenFlags: [], recipe: { id: "r-1", version: 1, source: "ai" as const }, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor };
  const req = (text: string, meals = [openMeal]): InterpretRequest => {
    const state = KitchenState.parse({ ...kitchen(EGG_KITCHEN), meals });
    return { kitchenId: state.kitchenId, userId: "u-ana", message: { id: "msg-1", text }, state, version: state.version, history: [] };
  };

  it.each(["how much eggs do I need?", "what are the measurements?", "no measurements for the eggs?", "I want to make it, how much eggs do I need?", "how long do I cook it?", "how much rice is left?", "no eggs", "skip step 2"])(
    "with a recipe open, '%s' → declined: no proposal, no follow-up",
    async (text) => {
      expect(await createFakeInterpreter().interpret(req(text))).toEqual({ kind: "answer", proposal: null, reply: STAND_IN_DECLINE_REPLY });
    },
  );

  it("its meal AI declines a question or change about a sample recipe too (no new version)", async () => {
    const first = await sampleRecipe("japanese rolled omelette");
    for (const text of ["how much eggs do I need?", "no garlic"]) {
      const r = await createFakeMealAI().generateRecipe({ ...mealContext(EGG_KITCHEN), meal: { mealId: "meal-1", title: first.recipe.title }, refine: { messageId: "m-2", text, current: currentOf(first) } });
      expect(r, text).toEqual({ ok: false, reason: "not-configured", reply: STAND_IN_DECLINE_REPLY });
    }
  });

  it("regression: 'I want to make it, how much…' and Ana's tamagoyaki message never name a dish", () => {
    expect(matchIntent("I want to make it, how much eggs do I need?").kind).toBe("needsRealAI");
    expect(matchIntent(ANA_TAMAGOYAKI).kind).toBe("needsRealAI");
  });
});
