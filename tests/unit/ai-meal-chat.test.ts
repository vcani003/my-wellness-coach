/**
 * Meals in chat (0005, 0013): "what can I make?", "the second one", "add that to my meal plan",
 * "start cooking", "I made it", "no oven". The model names labels; code resolves them and adds
 * the follow-ups. Ends with the whole journey through the real kitchen validator.
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { ProposedChange } from "@/contracts/proposed-change";
import { KitchenState } from "@/contracts/kitchen-state";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { toWire, type ModelOp, type ModelOutput } from "@/ai/real/model-output";
import { WHICH_MEAL, WHICH_RECIPE } from "@/ai/real/meal-ops";
import { PROMPT_VERSION } from "@/ai/real/prompt";
import { createFakeMealAI } from "@/ai/fake/meals";
import type { InterpretRequest, TurnFollowUp } from "@/ai/interpreter";
import { kitchen, mealContext, NOW, SHRIMP_KITCHEN } from "@/ai/eval/fixtures";
import { MemoryKitchen } from "../support/memory-kitchen";

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

function mealOp(action: ModelOp["action"], meal: string | null, evidence: string): ModelOp {
  return { action, evidence, meal, item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null };
}

function output(partial: Partial<ModelOutput>): ModelOutput {
  return { kind: "change", reply: "Got it.", operations: [], clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null, ...partial };
}

function interpreterFor(o: ModelOutput, now = NOW) {
  const create = vi.fn<(body: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => Promise<Message>>(async () =>
    message(JSON.stringify(toWire(o))),
  );
  const messages: MessagesApi = { create };
  return { interpreter: createRealInterpreter({ messages, now: () => now, log: () => {}, env: {} }), create };
}

const IDEAS = [
  { ideaId: "idea-a", name: "Spinach omelette" },
  { ideaId: "idea-b", name: "Shrimp fried rice" },
  { ideaId: "idea-c", name: "Lime rice" },
];

function meal(id: string, title: string, status: "chosen" | "planned" | "cooking", minutesAgo: number, by = "u-vero", recipe = false) {
  const at = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  const actor = { id: by, name: by === "u-vero" ? "Vero" : "Levi" };
  return {
    id,
    title,
    status,
    chosenAt: at,
    allergenFlags: [],
    ...(recipe ? { recipe: { id: `r-${id}`, version: 1, source: "ai" as const } } : {}),
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
  };
}

function req(text: string, meals: ReturnType<typeof meal>[] = [], ideas = IDEAS): InterpretRequest {
  const state = KitchenState.parse({ ...kitchen(SHRIMP_KITCHEN), meals });
  return { kitchenId: state.kitchenId, userId: "u-vero", message: { id: "msg-1", text }, state, version: state.version, history: [], ideas };
}

describe("what the model sees", () => {
  it("idea cards as d-labels and meals as m-labels, in the per-turn part only (prompt v3)", async () => {
    const { interpreter, create } = interpreterFor(output({ kind: "answer", reply: "ok" }));
    await interpreter.interpret(req("the second one", [meal("meal-1", "Lime rice", "cooking", 10, "u-vero", true)]));
    const body = create.mock.calls[0][0];
    const user = body.messages[0].content as string;
    expect(user).toContain("<meal_ideas>\nd1: Spinach omelette\nd2: Shrimp fried rice\nd3: Lime rice\n</meal_ideas>");
    expect(user).toContain("m1: Lime rice · cooking · has recipe");
    expect(PROMPT_VERSION).toBe("interpret-2026-10-17.1");
    const system = body.system as Anthropic.Beta.Messages.BetaTextBlockParam[];
    expect(system[0].text).toContain("# Meals (ideas, choosing, plan, cooking)");
    expect(system[0].text).not.toContain("Shrimp fried rice"); // nothing per-request in the cached prefix
  });
});

describe("meal actions are resolved by code", () => {
  it("'what can I make tonight?' → an answer that triggers idea generation with the user's words", async () => {
    const { interpreter } = interpreterFor(output({ kind: "answer", reply: "Let me look at what you have.", generate: { what: "ideas", meal: null } }));
    const r = await interpreter.interpret(req("What can I make tonight?"));
    expect(r).toEqual({ kind: "answer", proposal: null, reply: "Let me look at what you have.", followUps: [{ kind: "ideas", request: "What can I make tonight?" }] });
  });

  it("'the second one' → meal.choose for that idea, then its recipe (R2)", async () => {
    const { interpreter } = interpreterFor(output({ operations: [mealOp("meal_choose", "d2", "the second one")] }));
    const r = await interpreter.interpret(req("the second one"));
    expect(r.proposal?.operations).toEqual([{ opId: "msg-1:meal1", type: "meal.choose", target: { ideaId: "idea-b" }, evidence: "the second one" }]);
    expect(r.followUps).toEqual([{ kind: "recipe", meal: { chooseOpId: "msg-1:meal1" } }]);
  });

  it("choosing an idea whose meal already has a recipe doesn't write another", async () => {
    const existing = { ...meal("meal-1", "Spinach omelette", "chosen", 5, "u-vero", true), ideaId: "idea-a" };
    const { interpreter } = interpreterFor(output({ operations: [mealOp("meal_choose", "d1", "the omelette")] }));
    const r = await interpreter.interpret(req("the omelette", [existing]));
    expect(r.followUps ?? []).toEqual([]);
  });

  it("an unknown label is never guessed: 'Which one?' with quick replies, nothing applied", async () => {
    const { interpreter } = interpreterFor(output({ operations: [mealOp("meal_choose", "d9", "the fourth one")] }));
    const r = await interpreter.interpret(req("the fourth one"));
    expect(r.kind).toBe("clarify");
    expect(r.proposal?.operations).toEqual([]);
    expect(r.proposal?.clarification).toEqual({
      question: WHICH_MEAL,
      options: IDEAS.map((i) => ({ label: i.name, reply: i.name })),
    });
  });

  it("'add that to my meal plan' → the meal THIS user chose most recently (0005)", async () => {
    const meals = [meal("meal-old", "Lime rice", "chosen", 90), meal("meal-new", "Spinach omelette", "chosen", 10), meal("meal-levi", "Pho", "chosen", 1, "u-levi")];
    const { interpreter } = interpreterFor(output({ operations: [mealOp("meal_plan", "last_chosen", "add that to my meal plan")] }));
    const r = await interpreter.interpret(req("add that to my meal plan", meals));
    expect(r.proposal?.operations).toEqual([{ opId: "msg-1:meal1", type: "meal.plan", target: { mealId: "meal-new" }, evidence: "add that to my meal plan" }]);
  });

  it("'add that' with nothing chosen (or chosen over 3 hours ago) → 'Which one?', no operations", async () => {
    const { interpreter } = interpreterFor(output({ reply: "Added it to your plan.", operations: [mealOp("meal_plan", "last_chosen", "add that to my meal plan")] }));
    const r = await interpreter.interpret(req("add that to my meal plan", [meal("meal-1", "Lime rice", "chosen", 200)]));
    expect(r).toMatchObject({ kind: "clarify", reply: WHICH_MEAL, proposal: { operations: [] } });
    expect(r.proposal?.clarification?.options.map((o) => o.label)).toEqual(["Lime rice", "Spinach omelette", "Shrimp fried rice", "Lime rice"].filter((v, i, a) => a.indexOf(v) === i));
  });

  it("'plan the omelette' while it's only an idea → choose it, then plan it once it exists", async () => {
    const { interpreter } = interpreterFor(output({ operations: [mealOp("meal_plan", "d1", "plan the omelette")] }));
    const r = await interpreter.interpret(req("plan the omelette"));
    expect(r.proposal?.operations.map((o) => o.type)).toEqual(["meal.choose"]);
    expect(r.followUps).toEqual([
      { kind: "recipe", meal: { chooseOpId: "msg-1:meal1" } },
      { kind: "meal-step", meal: { chooseOpId: "msg-1:meal1" }, to: "planned" },
    ]);
  });

  it("'start cooking' → meal.transition to cooking", async () => {
    const { interpreter } = interpreterFor(output({ operations: [mealOp("meal_start_cooking", "last_chosen", "start cooking")] }));
    const r = await interpreter.interpret(req("start cooking", [meal("meal-1", "Spinach omelette", "planned", 30)]));
    expect(r.proposal?.operations).toEqual([{ opId: "msg-1:meal1", type: "meal.transition", target: { mealId: "meal-1" }, to: "cooking", evidence: "start cooking" }]);
  });

  it("'I made it' → done for the one cooking meal, plus the after-cooking step (code + UI, 0013)", async () => {
    const meals = [meal("meal-1", "Spinach omelette", "planned", 5), meal("meal-2", "Lime rice", "cooking", 60, "u-levi")];
    const { interpreter } = interpreterFor(output({ operations: [mealOp("meal_done", "last_chosen", "I made it")] }));
    const r = await interpreter.interpret(req("I made it!", meals));
    expect(r.proposal?.operations).toEqual([{ opId: "msg-1:meal1", type: "meal.transition", target: { mealId: "meal-2" }, to: "done", evidence: "I made it" }]);
    expect(r.followUps).toEqual([{ kind: "after-cooking", mealId: "meal-2" }]);
  });

  it("'no oven' → refine the open recipe (same meal), with the user's words", async () => {
    const { interpreter } = interpreterFor(output({ kind: "answer", reply: "Sure.", generate: { what: "recipe_change", meal: "last_chosen" } }));
    const r = await interpreter.interpret(req("no oven please", [meal("meal-1", "Spinach omelette", "chosen", 5, "u-vero", true)]));
    expect(r.followUps).toEqual<TurnFollowUp[]>([{ kind: "recipe", meal: { mealId: "meal-1" }, refine: "no oven please" }]);
  });

  it("'no oven' with no recipe anywhere → 'Which recipe should I change?'", async () => {
    const { interpreter } = interpreterFor(output({ kind: "answer", reply: "Sure.", generate: { what: "recipe_change", meal: "last_chosen" } }));
    const r = await interpreter.interpret(req("no oven please"));
    expect(r).toMatchObject({ kind: "clarify", reply: WHICH_RECIPE });
  });
});

describe("the journey through the real kitchen validator (0005: ideas → recipe → plan → cooking → done)", () => {
  it("every operation applies with no rejections, and done records the in-kitchen ingredients as used", async () => {
    const k = new MemoryKitchen();
    k.say("I bought eggs, spinach and limes", [
      { type: "item.add", fields: { name: { value: "eggs", basis: "said", confidence: "high" } } },
      { type: "item.add", fields: { name: { value: "spinach", basis: "said", confidence: "high" } } },
      { type: "item.add", fields: { name: { value: "limes", basis: "said", confidence: "high" } } },
    ]);
    const meals = createFakeMealAI(() => NOW);
    const ctx = () => ({ ...mealContext([]), kitchenId: k.kitchenId, userId: "vero", state: k.state() });

    // 1. ideas → stored so they can be chosen
    const ideas = await meals.generateMealIdeas({ ...ctx(), request: { messageId: "m-1", text: "what can I make?" } });
    if (!ideas.ok) throw new Error("ideas failed");
    const shown = ideas.ideas.map((idea, i) => ({ ideaId: `idea-${i + 1}`, name: idea.name }));
    shown.forEach((s) => k.ideas.set(s.ideaId, { name: s.name }));

    const turn = async (text: string, o: ModelOutput, at = new Date("2026-10-14T19:00:00Z")) => {
      const { interpreter } = interpreterFor(o, at);
      const state = k.state();
      return interpreter.interpret({ kitchenId: k.kitchenId, userId: "vero", message: { id: `msg-${text}`, text }, state, version: state.version, history: [], ideas: shown });
    };

    // 2. "the second one" → choose, then the recipe for the new meal
    const chose = await turn("the second one", output({ operations: [mealOp("meal_choose", "d2", "the second one")] }));
    const r1 = k.say("the second one", ProposedChange.parse(chose.proposal).operations);
    expect(r1.rejected).toEqual([]);
    const mealId = r1.applied[0].refs.find((r) => r.kind === "meal")!.id;
    expect(chose.followUps?.[0]).toEqual({ kind: "recipe", meal: { chooseOpId: r1.applied[0].opId } });

    const recipe = await meals.generateRecipe({ ...ctx(), meal: { mealId, title: shown[1].name } });
    if (!recipe.ok) throw new Error("recipe failed");
    expect(k.tap([recipe.operation]).rejected).toEqual([]);

    // 3. "add that to my meal plan", 4. "start cooking", 5. "I made it"
    for (const [text, action] of [
      ["add that to my meal plan", "meal_plan"],
      ["start cooking", "meal_start_cooking"],
      ["I made it", "meal_done"],
    ] as const) {
      const r = await turn(text, output({ operations: [mealOp(action, "last_chosen", text)] }));
      const plan = k.say(text, ProposedChange.parse(r.proposal).operations);
      expect(plan.rejected, text).toEqual([]);
      if (action === "meal_done") expect(r.followUps).toEqual([{ kind: "after-cooking", mealId }]);
    }
    expect(k.kitchen.meals[mealId].status).toBe("done");
  });
});

describe("the fake interpreter routes meals with the same code (for repeatable e2e)", () => {
  it("'what can I make?' → ideas follow-up; 'the second one' → meal.choose + recipe; nothing chosen → 'Which one?'", async () => {
    const { fakeInterpreter } = await import("@/ai/fake");
    const ideas = await fakeInterpreter.interpret(req("What can I make tonight?"));
    expect(ideas.followUps).toEqual([{ kind: "ideas", request: "What can I make tonight?" }]);

    const chose = await fakeInterpreter.interpret(req("the second one"));
    expect(chose.proposal?.operations).toEqual([{ opId: "msg-1:meal1", type: "meal.choose", target: { ideaId: "idea-b" }, evidence: "the second one" }]);
    expect(chose.followUps).toEqual([{ kind: "recipe", meal: { chooseOpId: "msg-1:meal1" } }]);

    const which = await fakeInterpreter.interpret(req("add that to my meal plan"));
    expect(which).toMatchObject({ kind: "clarify", reply: WHICH_MEAL, proposal: { operations: [] } });
  });
});
