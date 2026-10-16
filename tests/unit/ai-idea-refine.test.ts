/**
 * Refining an idea card (ai.md §5 "Refining an idea", Vero 2026-10-15): "remove the yogurt from the
 * curry" on the Meal ideas view edits the card in place. No recipe, no navigation. "Make the curry
 * without yogurt" chooses it and writes the recipe with the change. A card whose meal has a recipe
 * changes the recipe (edit mode). Routing (code), the model call (mocked), the code guards, and
 * the fake's phrasings.
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { KitchenState } from "@/contracts/kitchen-state";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { toWire, type ModelOp, type ModelOutput } from "@/ai/real/model-output";
import { mealOperations } from "@/ai/real/meal-ops";
import { renderIdeas } from "@/ai/real/prompt";
import { createRealMealAI, type MealLog, type StreamingMessagesApi } from "@/ai/real/meals";
import { createFakeMealAI, fakeIdeaChange } from "@/ai/fake/meals";
import { createFakeInterpreter } from "@/ai/fake";
import { withoutIdeaRefineDraft } from "@/ai/follow-ups";
import { IDEA_ALLERGEN_REPLY, toRefinedIdea } from "@/ai/meals/refine-idea";
import { IDEA_REFINE_INSTRUCTIONS, RECIPE_INSTRUCTIONS } from "@/ai/meals/prompts";
import { renderRecipeRequest } from "@/ai/meals/context";
import type { IdeaRefineInput } from "@/ai/meals/types";
import type { InterpretRequest } from "@/ai/interpreter";
import {
  IDEA_REFINE_MESSAGE,
  IDEAS_KITCHEN,
  ideasViewRequest,
  kitchen,
  MEMBERS,
  NOW,
  restriction,
  SHOWN_IDEAS,
} from "@/ai/eval/fixtures";

type Message = Anthropic.Beta.Messages.BetaMessage;

function message(text: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
  } as unknown as Message;
}

const mealOp = (action: ModelOp["action"], meal: string, evidence: string): ModelOp => ({
  action, evidence, meal, item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null,
});

const output = (partial: Partial<ModelOutput>): ModelOutput => ({
  kind: "answer", reply: "Sure.", operations: [], clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null, ...partial,
});

/** A meal chosen from the curry card, with or without a recipe. */
function curryMeal(recipe: boolean, actor = { id: "u-vero", name: "Vero" }) {
  const at = new Date(NOW.getTime() - 600_000).toISOString();
  return {
    id: "meal-curry",
    title: SHOWN_IDEAS[0].name,
    status: "chosen" as const,
    ideaId: "idea-curry",
    chosenAt: at,
    ...(recipe ? { recipe: { id: "r-curry", version: 1, source: "ai" as const } } : {}),
    allergenFlags: [],
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
  };
}

function withMeal(req: InterpretRequest, recipe: boolean, actor?: { id: string; name: string }): InterpretRequest {
  const state = KitchenState.parse({ ...req.state, meals: [curryMeal(recipe, actor)] });
  return { ...req, state };
}

describe("routing a change to an idea card (code decides)", () => {
  it("recipe_change on a card with no recipe edits the card: no choose, no recipe", () => {
    const req = ideasViewRequest(IDEA_REFINE_MESSAGE);
    const m = mealOperations(output({ generate: { what: "recipe_change", meal: "d1" } }), req, NOW);
    expect(m.operations).toEqual([]);
    expect(m.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: IDEA_REFINE_MESSAGE }]);
  });

  it("regression (Vero 2026-10-15): the model also picked the card; code still only edits it", () => {
    // What she saw: the card was chosen and a whole recipe was written; the card kept the yogurt.
    const req = ideasViewRequest(IDEA_REFINE_MESSAGE);
    const out = output({ kind: "change", operations: [mealOp("meal_choose", "d1", IDEA_REFINE_MESSAGE)], generate: { what: "recipe_change", meal: "d1" } });
    const m = mealOperations(out, req, NOW);
    expect(m.operations).toEqual([]);
    expect(m.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: IDEA_REFINE_MESSAGE }]);
  });

  it("a pick with change words and no cook/recipe words is an edit, even without recipe_change", () => {
    const req = ideasViewRequest(IDEA_REFINE_MESSAGE);
    const m = mealOperations(output({ kind: "change", operations: [mealOp("meal_choose", "d1", "refine the curry")] }), req, NOW);
    expect(m.operations).toEqual([]);
    expect(m.followUps.map((f) => f.kind)).toEqual(["idea-refine"]);
  });

  it("a named dish matching the card loosely ('the curry') counts as that card", () => {
    const req = ideasViewRequest(IDEA_REFINE_MESSAGE);
    const out = output({ kind: "change", dish: { title: "Curry", notes: "without yogurt", evidence: "my curry" } });
    const m = mealOperations(out, req, NOW);
    expect(m.operations).toEqual([]);
    expect(m.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: IDEA_REFINE_MESSAGE }]);
  });

  it("'make the curry without yogurt' chooses it and writes the recipe with her words as notes", () => {
    const text = "make the curry without yogurt";
    const req = ideasViewRequest(text);
    const out = output({ kind: "change", operations: [mealOp("meal_choose", "d1", text)], generate: { what: "recipe_change", meal: "d1" } });
    const m = mealOperations(out, req, NOW);
    expect(m.operations).toMatchObject([{ type: "meal.choose", target: { ideaId: "idea-curry" } }]);
    expect(m.followUps).toEqual([{ kind: "recipe", meal: { chooseOpId: m.operations[0].opId }, notes: text }]);
  });

  it("'make the curry without yogurt' with only recipe_change: code chooses it too", () => {
    const text = "make the curry without yogurt";
    const m = mealOperations(output({ generate: { what: "recipe_change", meal: "d1" } }), ideasViewRequest(text), NOW);
    expect(m.operations).toMatchObject([{ type: "meal.choose", target: { ideaId: "idea-curry" } }]);
    expect(m.followUps).toMatchObject([{ kind: "recipe", notes: text }]);
  });

  it("a card whose meal has a recipe changes the recipe (edit mode), never the card directly", () => {
    const req = withMeal(ideasViewRequest("remove the yogurt from the curry"), true);
    const m = mealOperations(output({ generate: { what: "recipe_change", meal: "d1" } }), req, NOW);
    expect(m.followUps).toEqual([{ kind: "recipe", meal: { mealId: "meal-curry" }, refine: "remove the yogurt from the curry" }]);
  });

  it("a card chosen but with no recipe yet is still edited as a card", () => {
    const req = withMeal(ideasViewRequest("swap the chicken for tofu in the first one"), false);
    const m = mealOperations(output({ generate: { what: "recipe_change", meal: "d1" } }), req, NOW);
    expect(m.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: "swap the chicken for tofu in the first one" }]);
  });

  it.each(["I don't want the first one, the second one", "actually the second one instead", "switch to the second one"])(
    "a pick that only sounds like a change stays a pick: %s",
    (text) => {
      const m = mealOperations(output({ kind: "change", operations: [mealOp("meal_choose", "d2", text)] }), ideasViewRequest(text), NOW);
      expect(m.operations).toMatchObject([{ type: "meal.choose", target: { ideaId: "idea-beef" } }]);
      expect(m.followUps.map((f) => f.kind)).toEqual(["recipe"]);
    },
  );

  it("unchanged: a plain pick still chooses and writes the recipe", () => {
    const m = mealOperations(output({ kind: "change", operations: [mealOp("meal_choose", "d2", "the second one")] }), ideasViewRequest("the second one"), NOW);
    expect(m.operations).toMatchObject([{ type: "meal.choose", target: { ideaId: "idea-beef" } }]);
    expect(m.followUps).toMatchObject([{ kind: "recipe" }]);
  });

  it("the real interpreter turns the routed answer into an idea-refine follow-up with no proposal", async () => {
    const create = vi.fn(async () => message(JSON.stringify(toWire(output({ generate: { what: "recipe_change", meal: "d1" }, reply: "Sure, I'll take the yogurt out." })))));
    const interpreter = createRealInterpreter({ messages: { create } as unknown as MessagesApi, now: () => NOW, log: () => {}, env: {} });
    const r = await interpreter.interpret(ideasViewRequest(IDEA_REFINE_MESSAGE));
    expect(r.proposal).toBeNull();
    expect(r.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: IDEA_REFINE_MESSAGE }]);
  });

  it("the turn's own draft is dropped when only the card changes (the step speaks)", () => {
    const f = [{ kind: "idea-refine" as const, ideaId: "x", request: "r" }];
    expect(withoutIdeaRefineDraft("Good choice. Here's the recipe.", f, null)).toBe("");
    expect(withoutIdeaRefineDraft("Sure.", [], null)).toBe("Sure.");
  });
});

describe("0051: which change a card gets (IR2, IR3, IR4)", () => {
  /** Another member of the kitchen (a fictional persona). */
  const BEN = { id: "u-ben", name: "Ben" };

  it("IR2: the model only picked a card whose meal has your recipe, with change words → the recipe is edited, nothing re-chosen", () => {
    const text = "remove the yogurt from the curry";
    const req = withMeal(ideasViewRequest(text), true);
    const m = mealOperations(output({ kind: "change", operations: [mealOp("meal_choose", "d1", text)] }), req, NOW);
    expect(m.operations).toEqual([]);
    expect(m.followUps).toEqual([{ kind: "recipe", meal: { mealId: "meal-curry" }, refine: text }]);
  });

  it("IR2: 'make the curry without yogurt' once it has your recipe edits that recipe (no second meal, no rewrite from scratch)", () => {
    const text = "make the curry without yogurt";
    const req = withMeal(ideasViewRequest(text), true);
    const out = output({ kind: "change", operations: [mealOp("meal_choose", "d1", text)], generate: { what: "recipe_change", meal: "d1" } });
    const m = mealOperations(out, req, NOW);
    expect(m.operations).toEqual([]);
    expect(m.followUps).toEqual([{ kind: "recipe", meal: { mealId: "meal-curry" }, refine: text }]);
  });

  it("IR2: a plain pick of a card that has your recipe stays a pick (no edit)", () => {
    const req = withMeal(ideasViewRequest("the first one"), true);
    const m = mealOperations(output({ kind: "change", operations: [mealOp("meal_choose", "d1", "the first one")] }), req, NOW);
    expect(m.operations).toMatchObject([{ type: "meal.choose", target: { ideaId: "idea-curry" } }]);
    expect(m.followUps).toEqual([]);
  });

  it("IR4: a card another member chose (their meal has a recipe) → only this card changes, never their recipe", () => {
    const text = "remove the yogurt from the curry";
    const req = withMeal(ideasViewRequest(text), true, BEN);
    const viaRoute = mealOperations(output({ generate: { what: "recipe_change", meal: "d1" } }), req, NOW);
    expect(viaRoute.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: text }]);
    const viaPick = mealOperations(output({ kind: "change", operations: [mealOp("meal_choose", "d1", text)] }), req, NOW);
    expect(viaPick.operations).toEqual([]);
    expect(viaPick.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: text }]);
  });

  it("IR4: the model isn't told another member's meal is this card's ('chosen as mN' is only for your own)", () => {
    const req = withMeal(ideasViewRequest("x"), true, BEN);
    expect(renderIdeas(req).split("\n")[0]).toBe(
      "d1: Lemongrass chicken potato coconut curry · uses chicken thighs, potatoes, coconut milk, Greek yogurt · missing lemongrass",
    );
  });
});

describe("what the interpreter sees", () => {
  it("each card with what it uses and is missing, and 'chosen as mN · has recipe'", () => {
    const req = withMeal(ideasViewRequest("x"), true);
    expect(renderIdeas(req).split("\n")).toEqual([
      "d1: Lemongrass chicken potato coconut curry · uses chicken thighs, potatoes, coconut milk, Greek yogurt · missing lemongrass · chosen as m1 · has recipe",
      "d2: Beef mince fried rice · uses beef mince, jasmine rice · missing spring onions",
      "d3: Crispy tofu rice bowl · uses tofu, jasmine rice",
    ]);
  });
});

// ─── The idea change call and its guards ───────────────────────────────────────────────

function refineInput(text: string, opts: { restrictions?: ReturnType<typeof restriction>[] } = {}): IdeaRefineInput {
  const state = kitchen(IDEAS_KITCHEN);
  const { ideaId, name, why, uses, missing } = SHOWN_IDEAS[0];
  return {
    kitchenId: state.kitchenId,
    userId: "u-vero",
    state,
    members: MEMBERS,
    restrictions: opts.restrictions ?? [],
    idea: { ideaId, name, why, uses, missing },
    request: { messageId: "msg-1", text },
  };
}

type Body = Parameters<StreamingMessagesApi["stream"]>[0];

function streaming(json: unknown) {
  const calls: Body[] = [];
  const messages: StreamingMessagesApi = {
    stream: vi.fn((body: Body) => {
      calls.push(body);
      const text = JSON.stringify(json);
      return {
        async *textDeltas() {
          yield text;
        },
        finalMessage: async () => message(text),
      };
    }),
  };
  const logs: MealLog[] = [];
  return { meals: createRealMealAI({ messages, now: () => NOW, log: (e) => logs.push(e), env: {} }), calls, logs };
}

describe("refineIdea (real, mocked client)", () => {
  it("Vero's message: one call with <idea> and <change_request>; the card loses the yogurt, nothing else", async () => {
    const { meals, calls, logs } = streaming({
      name: "Lemongrass chicken potato coconut curry",
      why: "Creamy and cosy with the coconut milk",
      uses: ["i1", "i2", "i3"],
      missing: ["lemongrass"],
      basics: ["salt"],
      reply: "Took the yogurt out of the curry idea.",
    });
    const r = await meals.refineIdea(refineInput(IDEA_REFINE_MESSAGE));
    expect(calls).toHaveLength(1);
    const system = calls[0].system as Anthropic.Beta.Messages.BetaTextBlockParam[];
    expect(system[1].text).toBe(IDEA_REFINE_INSTRUCTIONS);
    const user = calls[0].messages[0].content as string;
    expect(user).toContain("<idea>\nName: Lemongrass chicken potato coconut curry");
    expect(user).toContain("Uses: i1 (chicken thighs), i2 (potatoes), i3 (coconut milk), i4 (Greek yogurt)");
    expect(user).toContain(`<change_request>\n${IDEA_REFINE_MESSAGE}\n</change_request>`);
    expect(logs[0]).toMatchObject({ event: "ai.usage", task: "idea-refine" });
    expect(r).toMatchObject({ ok: true, reply: "Took the yogurt out of the curry idea." });
    if (!r.ok || r.unchanged) throw new Error("expected a change");
    expect(r.idea.uses).toEqual(["item-1", "item-2", "item-3"]);
    expect(r.idea.missing).toEqual(["lemongrass"]);
  });

  it("an answer that changes nothing is 'unchanged' (no save)", async () => {
    const { ideaId: _id, ...card } = SHOWN_IDEAS[0];
    void _id;
    const { meals } = streaming({ ...card, uses: ["i1", "i2", "i3", "i4"], basics: [], reply: "There's no cheese in it." });
    const r = await meals.refineIdea(refineInput("no cheese in the curry"));
    expect(r).toMatchObject({ ok: true, unchanged: true, reply: "There's no cheese in it." });
  });

  it("a refusal or an API error is a plain reply, never a crash (0018)", async () => {
    const messages: StreamingMessagesApi = {
      stream: () => ({
        async *textDeltas() {
          throw new Error("boom");
        },
        finalMessage: async () => {
          throw new Error("boom");
        },
      }),
    };
    const meals = createRealMealAI({ messages, now: () => NOW, log: () => {}, env: {} });
    const r = await meals.refineIdea(refineInput(IDEA_REFINE_MESSAGE));
    expect(r.ok).toBe(false);
  });
});

describe("code guards on a refined card (0019)", () => {
  const ben = restriction({ userId: "u-levi", subject: "seafood", note: "no shellfish at all" });

  it("a change that brings in someone's allergen nobody asked for is not saved", () => {
    const r = toRefinedIdea(
      { name: "Shrimp coconut curry", why: "x", uses: ["i2", "i3"], missing: ["shrimp", "lemongrass"], basics: [] },
      "Swapped in shrimp.",
      refineInput("swap the chicken for something else", { restrictions: [ben] }),
      NOW,
    );
    expect(r).toMatchObject({ ok: true, unchanged: true, reply: IDEA_ALLERGEN_REPLY });
  });

  it("the user's own typed words asking for it: allowed, and flagged by code", () => {
    const r = toRefinedIdea(
      { name: "Shrimp coconut curry", why: "x", uses: ["i2", "i3"], missing: ["shrimp", "lemongrass"], basics: [] },
      "Swapped the chicken for shrimp.",
      refineInput("swap the chicken for shrimp", { restrictions: [ben] }),
      NOW,
    );
    if (!r.ok || r.unchanged) throw new Error("expected a change");
    expect(r.idea.allergenFlags.length).toBeGreaterThan(0);
    expect(new Set(r.idea.allergenFlags.map((f) => f.userId))).toEqual(new Set(["u-levi"]));
  });

  it("unknown labels are dropped and a 'missing' item the kitchen has moves to Uses", () => {
    const r = toRefinedIdea(
      { name: "Tofu potato coconut curry", why: "x", uses: ["i2", "i3", "i99"], missing: ["tofu", "lemongrass"], basics: [] },
      "Swapped the chicken for tofu.",
      refineInput("swap the chicken for tofu"),
      NOW,
    );
    if (!r.ok || r.unchanged) throw new Error("expected a change");
    expect(r.idea.uses).toEqual(["item-2", "item-3", "item-5"]);
    expect(r.idea.missing).toEqual(["lemongrass"]);
  });
});

describe("the recipe for an edited idea honours it", () => {
  it("<meal> carries the user's words about the change, and the recipe prompt says to honour them", () => {
    const input = refineInput("x");
    const body = renderRecipeRequest(
      { ...input, meal: { mealId: "m", title: "Curry", idea: { name: "Curry", why: "w", uses: ["item-1"], missing: [], notes: "no yogurt please" } } },
      NOW,
    );
    expect(body).toContain("The user changed this idea before choosing it and said: no yogurt please");
    expect(RECIPE_INSTRUCTIONS).toContain("never add back an ingredient they took out");
  });
});

describe("the fake (repeatable e2e)", () => {
  const card = SHOWN_IDEAS[0];

  it.each([
    ["remove the yogurt from the curry", ["item-1", "item-2", "item-3"], ["lemongrass"], card.name],
    ["no yogurt in the curry", ["item-1", "item-2", "item-3"], ["lemongrass"], card.name],
    [IDEA_REFINE_MESSAGE, ["item-1", "item-2", "item-3"], ["lemongrass"], card.name],
    ["swap the chicken for tofu in the first one", ["item-2", "item-3", "item-4", "item-5"], ["lemongrass"], "Lemongrass Tofu potato coconut curry"],
    ["use the beef mince instead of the chicken", ["item-2", "item-3", "item-4", "item-6"], ["lemongrass"], "Lemongrass Beef mince potato coconut curry"],
    ["add ginger to the curry", ["item-1", "item-2", "item-3", "item-4"], ["lemongrass", "ginger"], card.name],
  ])("%s", async (text, uses, missing, name) => {
    const r = await createFakeMealAI(() => NOW).refineIdea(refineInput(text));
    if (!r.ok || r.unchanged) throw new Error(`expected a change for "${text}"`);
    expect(r.idea.uses).toEqual(uses);
    expect(r.idea.missing).toEqual(missing);
    expect(r.idea.name).toBe(name);
  });

  it("an ingredient that isn't on the card changes nothing", async () => {
    const r = await createFakeMealAI(() => NOW).refineIdea(refineInput("remove the cheese from the curry"));
    expect(r).toMatchObject({ ok: true, unchanged: true });
    expect(fakeIdeaChange("remove the cheese", refineInput("x").idea, refineInput("x")).reply).toBe("");
  });

  it("the fake follows 0051 like the eval cases: Vero's message → card; your recipe → recipe edit; another member's meal → card", async () => {
    const fake = createFakeInterpreter();
    const exact = await fake.interpret(ideasViewRequest(IDEA_REFINE_MESSAGE));
    expect(exact.proposal).toBeNull();
    expect(exact.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: IDEA_REFINE_MESSAGE }]);
    const text = "remove the yogurt from the curry";
    const mine = await fake.interpret(withMeal(ideasViewRequest(text), true));
    expect(mine.proposal).toBeNull();
    expect(mine.followUps).toEqual([{ kind: "recipe", meal: { mealId: "meal-curry" }, refine: text }]);
    const make = await fake.interpret(withMeal(ideasViewRequest("make the curry without yogurt"), true));
    expect(make.proposal).toBeNull();
    expect(make.followUps).toEqual([{ kind: "recipe", meal: { mealId: "meal-curry" }, refine: "make the curry without yogurt" }]);
    const theirs = await fake.interpret(withMeal(ideasViewRequest(text), true, { id: "u-ben", name: "Ben" }));
    expect(theirs.proposal).toBeNull();
    expect(theirs.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: text }]);
  });

  it("the fake interpreter routes edits to the card and 'make … without' to choose + recipe", async () => {
    const fake = createFakeInterpreter();
    const edit = await fake.interpret(ideasViewRequest("remove the yogurt from the lemongrass curry"));
    expect(edit.proposal).toBeNull();
    expect(edit.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-curry", request: "remove the yogurt from the lemongrass curry" }]);
    const swap = await fake.interpret(ideasViewRequest("swap the beef for tofu in the second one"));
    expect(swap.followUps).toEqual([{ kind: "idea-refine", ideaId: "idea-beef", request: "swap the beef for tofu in the second one" }]);
    const make = await fake.interpret(ideasViewRequest("make the curry without yogurt"));
    expect(make.proposal?.operations).toMatchObject([{ type: "meal.choose", target: { ideaId: "idea-curry" } }]);
    expect(make.followUps).toMatchObject([{ kind: "recipe", notes: "make the curry without yogurt" }]);
  });
});
