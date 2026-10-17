/**
 * 0059 (2026-10-17 preview feedback): recipes have amounts (PF1), and a question about a recipe
 * changes nothing (PF2). Covers the code guard that a question never removes kitchen items, the
 * stand-in AI's recipes (amounts, real steps, notes as guidance, not ingredient lines) and its
 * answers to recipe questions. People are fictional (Ana).
 */
import { describe, expect, it } from "vitest";
import type { Operation } from "@/contracts/operations";
import { KitchenState } from "@/contracts/kitchen-state";
import { FAKE_RECIPE_CHANGE, createFakeInterpreter } from "@/ai/fake";
import { createFakeMealAI, fakeEdits } from "@/ai/fake/meals";
import { matchIntent } from "@/ai/fake/patterns";
import { answerRecipeQuestion, dishKind, fakeAmount, fakeSteps, isFakeRecipeQuestion, readNotes } from "@/ai/fake/recipes";
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

// ─── The stand-in AI ────────────────────────────────────────────────────────────────────

async function fakeRecipe(title: string, notes: string | undefined, items = EGG_KITCHEN): Promise<Extract<RecipeResult, { ok: true }>> {
  const meals = createFakeMealAI();
  const r = await meals.generateRecipe({ ...mealContext(items), meal: { mealId: "meal-1", title, ...(notes ? { notes } : {}) } });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
}

function currentOf(r: Extract<RecipeResult, { ok: true }>): NonNullable<RecipeInput["refine"]>["current"] {
  const { title, summary, servings, ingredients, steps } = r.recipe;
  return { title, summary, servings, ingredients, steps };
}

describe("stand-in recipes (0059): amounts, real steps, notes as guidance", () => {
  it("Ana's tamagoyaki: every non-basic has an amount; her notes are not ingredient lines; 4+ concrete steps", async () => {
    const r = await fakeRecipe("Japanese rolled omelette", ANA_NOTES);
    const names = r.recipe.ingredients.map((i) => i.name);
    expect(names).toEqual(["eggs", "hondashi", "sugar", "cooking oil"]);
    for (const i of r.recipe.ingredients) if (!isBasic(i.name)) expect(i.amount, i.name).toBeTruthy();
    expect(r.recipe.ingredients.find((i) => i.name === "eggs")).toMatchObject({ amount: "4", group: "kitchen" });
    // "Season it with only hondashi": no salt on top of it.
    expect(names).not.toContain("salt");
    for (const n of names) expect(n).not.toMatch(/season it|i like|sweet/i);
    expect(r.recipe.steps.length).toBeGreaterThanOrEqual(4);
    expect(r.recipe.steps.join(" ")).not.toMatch(/Prepare the ingredients|Cook everything/);
    expect(r.recipe.steps[0]).toBe("Crack the 4 eggs into a bowl and beat until smooth, with 1 tsp hondashi and 1 tsp sugar.");
    expect(r.recipe.steps.join(" ")).toMatch(/roll/i);
    expect(r.recipe.summary).toBe("A quick japanese rolled omelette for 2. Your way: season it with only hondashi; I like it a little sweet.");
    expect(r.recipe.servings).toBe("2");
  });

  it.each([
    ["Spinach pasta", "pasta", 5],
    ["Chicken curry", "curry", 4],
    ["Beef stir-fry", "stir-fry", 4],
    ["Shakshuka", "general", 4],
  ])("%s → %s template, amounts everywhere, at least %d steps", async (title, kind, min) => {
    expect(dishKind(title)).toBe(kind);
    const r = await fakeRecipe(title, "with spinach, garlic and coconut milk", [{ name: "chicken thighs", location: "fridge" }, { name: "beef", location: "fridge" }]);
    expect(missingAmounts(r.recipe.ingredients)).toEqual([]);
    expect(r.recipe.steps.length).toBeGreaterThanOrEqual(min);
  });

  it("MI1 lists still become ingredients (with amounts); 'I have X' too", () => {
    const n = readNotes("with coconutt milk, lemon grass, kaffir. I have a curry base seasoning packet. i also have potatoes");
    expect(n.listed).toEqual(["coconutt milk", "lemon grass", "kaffir", "curry base seasoning packet", "potatoes"]);
    expect(n.guidance).toEqual([]);
    expect(["coconut milk", "curry base seasoning packet", "potatoes", "hondashi", "eggs"].map(fakeAmount)).toEqual(["1 can (400 ml)", "1 packet", "2 medium", "1 tsp", "4"]);
  });

  it("steps always use the recipe's own amounts and never fewer than 4", () => {
    const steps = fakeSteps("Toast", [{ name: "bread", amount: "2 slices", item: null, basic: false }], { salt: true });
    expect(steps.length).toBeGreaterThanOrEqual(4);
  });
});

describe("stand-in answers recipe questions with no change (PF2)", () => {
  async function ask(text: string) {
    const first = await fakeRecipe("Japanese rolled omelette", ANA_NOTES);
    const meals = createFakeMealAI();
    const r = await meals.generateRecipe({
      ...mealContext(EGG_KITCHEN),
      meal: { mealId: "meal-1", title: "Japanese rolled omelette" },
      refine: { messageId: "m-2", text, current: currentOf(first) },
    });
    return { first, r };
  }

  it("'how much eggs do I need?' → the amount, unchanged (no new version)", async () => {
    const { r } = await ask("how much eggs do I need?");
    expect(r).toMatchObject({ ok: true, unchanged: true, reply: "For 2 servings: 4 eggs." });
  });

  it("'what are the measurements?' → every amount", async () => {
    const { r } = await ask("what are the measurements?");
    expect(r).toMatchObject({ ok: true, unchanged: true, reply: "For 2 servings: 4 eggs, 1 tsp hondashi, 1 tsp sugar, 1 tbsp cooking oil." });
  });

  it("'no measurements for the eggs?' (Ana's follow-up) → answered; nothing removed", async () => {
    const { first, r } = await ask("no measurements for the eggs?");
    expect(r.ok && r.unchanged).toBe(true);
    expect(r.ok && r.recipe.ingredients.map((i) => i.name)).toEqual(first.recipe.ingredients.map((i) => i.name));
    expect(r.reply).toBe("For 2 servings: 4 eggs.");
  });

  it("'how long do I cook it?' → the timed steps", async () => {
    const { r } = await ask("how long do I cook it?");
    expect(r.ok && r.unchanged).toBe(true);
    expect(r.reply).toMatch(/^From the recipe: .*about 1 minute/);
  });

  it("an old recipe with no amounts says so instead of inventing one", () => {
    const reply = answerRecipeQuestion("how much eggs do I need?", {
      title: "Omelette",
      servings: null,
      ingredients: [{ name: "eggs", amount: null, itemId: null, group: "need", allergenFlags: [] }],
      steps: ["Beat the eggs."],
    });
    expect(reply).toBe("For this recipe: eggs (no amount given).");
  });

  it("which messages count as recipe questions", () => {
    for (const q of ["how much eggs do I need?", "what are the measurements?", "no measurements for the eggs?", "how long do I cook it", "how many eggs?", "I want to make it, how much eggs do I need?"]) {
      expect(isFakeRecipeQuestion(q), q).toBe(true);
    }
    for (const q of ["how much rice is left?", "how many eggs do we have?", "no garlic", "use 3 eggs instead of 2", "what can I make?"]) {
      expect(isFakeRecipeQuestion(q), q).toBe(false);
    }
  });

  it("regression: 'no X?' is never a removal edit (it removed the eggs in the preview)", () => {
    const first = { title: "Omelette", ingredients: [{ name: "eggs", amount: "4", itemId: null, group: "need" as const, allergenFlags: [] }], steps: ["Beat the eggs."] };
    expect(fakeEdits("no measurements for the eggs?", first)).toBeNull();
    expect(fakeEdits("no eggs", first)?.edits[0]).toMatchObject({ op: "remove_ingredient", at: 1 });
    // Still routed to the recipe (so it's answered there), never to a kitchen change.
    expect(FAKE_RECIPE_CHANGE.test("no measurements for the eggs?")).toBe(true);
  });
});

describe("stand-in interpreter (0059)", () => {
  const now = new Date();
  const actor = { id: "u-ana", name: "Ana" };
  const at = new Date(now.getTime() - 60_000).toISOString();
  const openMeal = { id: "meal-1", title: "Japanese rolled omelette", status: "chosen" as const, chosenAt: at, allergenFlags: [], recipe: { id: "r-1", version: 1, source: "ai" as const }, createdAt: at, createdBy: actor, updatedAt: at, updatedBy: actor };
  const req = (text: string, meals = [openMeal]): InterpretRequest => {
    const state = KitchenState.parse({ ...kitchen(EGG_KITCHEN), meals });
    return { kitchenId: state.kitchenId, userId: "u-ana", message: { id: "msg-1", text }, state, version: state.version, history: [] };
  };

  it.each(["how much eggs do I need?", "what are the measurements?", "no measurements for the eggs?", "I want to make it, how much eggs do I need?", "how long do I cook it?"])(
    "with a recipe open, '%s' → a recipe question: no kitchen or list change",
    async (text) => {
      const r = await createFakeInterpreter().interpret(req(text));
      expect(r.proposal).toBeNull();
      expect(r.followUps).toEqual([{ kind: "recipe", meal: { mealId: "meal-1" }, refine: text }]);
    },
  );

  it("'how much rice is left?' is not a recipe question", async () => {
    const r = await createFakeInterpreter().interpret(req("how much rice is left?"));
    expect(r.followUps ?? []).toEqual([]);
  });

  it("regression: 'I want to make it, how much…' never names a dish called 'It'", () => {
    expect(matchIntent("I want to make it, how much eggs do I need?").kind).not.toBe("dish");
    expect(matchIntent("I want to make that").kind).not.toBe("dish");
    expect(matchIntent(ANA_TAMAGOYAKI)).toMatchObject({ kind: "dish", title: "Japanese rolled omelette", notes: "Season it with only hondashi. I like it a little sweet" });
  });
});
