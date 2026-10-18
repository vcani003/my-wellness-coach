/**
 * A dish the user names in chat (MI1 Rec, 0013 M1: naming it counts as choosing it). Vero's real
 * message: what she says she has goes into the kitchen, the dish is chosen directly (no idea
 * cards), and its recipe uses her notes, with Need = what she mentioned but doesn't have.
 * Mocked clients only; everything is applied through the real kitchen validator.
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { MealChoose } from "@/contracts/operations";
import { ProposedChange } from "@/contracts/proposed-change";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { createRealMealAI, type StreamingMessagesApi } from "@/ai/real/meals";
import { toWire, type ModelOp, type ModelOutput } from "@/ai/real/model-output";
import type { RecipeOutput } from "@/ai/meals/model-output";
import type { MealContext } from "@/ai/meals/types";
import { createFakeMealAI } from "@/ai/fake/meals";
import { createFakeInterpreter, STAND_IN_DECLINE_REPLY } from "@/ai/fake";
import { LEVI_SEAFOOD, MEMBERS } from "@/ai/eval/fixtures";
import { KITCHEN_EVENT, type ItemUsedPayload, type MealChosenPayload } from "@/domains/kitchen/state";
import { MemoryKitchen, said } from "../support/memory-kitchen";

type Message = Anthropic.Beta.Messages.BetaMessage;

/** Vero's message from her local test, exactly as typed. */
const VERO = "i was thinking a chicken curry, with coconutt milk, lemon grass, kaffir. I have a curry base seasoning packet. i also have potatoes";
const AT = new Date("2026-10-14T19:00:00Z");

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

function interpreterFor(o: ModelOutput) {
  const create = vi.fn(async () => message(JSON.stringify(toWire(o))));
  const messages = { create } as unknown as MessagesApi;
  return createRealInterpreter({ messages, now: () => AT, log: () => {}, env: {} });
}

function recipeClient(out: RecipeOutput) {
  const bodies: Array<Parameters<StreamingMessagesApi["stream"]>[0]> = [];
  const messages: StreamingMessagesApi = {
    stream: vi.fn((body: Parameters<StreamingMessagesApi["stream"]>[0]) => {
      bodies.push(body);
      const text = JSON.stringify(out);
      return {
        async *textDeltas() {
          for (let i = 0; i < text.length; i += 40) yield text.slice(i, i + 40);
        },
        async finalMessage() {
          return message(text);
        },
      };
    }),
  };
  return { meals: createRealMealAI({ messages, now: () => AT, log: () => {}, env: {} }), bodies };
}

const op = (action: ModelOp["action"], name: string | null, evidence: string): ModelOp => ({
  action,
  evidence,
  meal: null,
  item: null,
  name: name ? { value: name, basis: "said", confidence: "high" } : null,
  quantity: null,
  location: null,
  frozen: null,
  stock: null,
  amountUsed: null,
  batch: null,
  store: null,
});

const output = (partial: Partial<ModelOutput>): ModelOutput => ({
  kind: "change",
  reply: "Got it.",
  operations: [],
  clarification: null,
  rememberPreference: null,
  listOfferAccepted: null,
  generate: null,
  dish: null,
  ...partial,
});

const NOTES = "with coconut milk, lemongrass and kaffir lime leaves; use the curry base seasoning packet and potatoes";

/** What the prompt's own example says the model should answer for Vero's message. */
const VERO_OUTPUT = output({
  reply: "Chicken curry it is. I added the curry base packet and potatoes. Here's a recipe.",
  operations: [
    op("add", "curry base seasoning packet", "I have a curry base seasoning packet"),
    op("add", "potatoes", "i also have potatoes"),
  ],
  dish: { title: "Chicken curry", notes: NOTES, evidence: "i was thinking a chicken curry" },
});

/** A kitchen with chicken thighs bought twice (two batches, 0025). */
function chickenKitchen() {
  const k = new MemoryKitchen();
  k.say("I bought chicken thighs", [{ type: "item.add", fields: { name: said("chicken thighs"), location: said("fridge") } }]);
  k.say("I bought chicken thighs", [{ type: "item.add", fields: { name: said("chicken thighs"), location: said("fridge") } }]);
  return k;
}

const interpret = (k: MemoryKitchen, text: string, o: ModelOutput, ideas?: Array<{ ideaId: string; name: string }>) => {
  const state = k.state();
  return interpreterFor(o).interpret({
    kitchenId: k.kitchenId,
    userId: "vero",
    message: { id: "msg-curry", text },
    state,
    version: state.version,
    history: [],
    ...(ideas ? { ideas } : {}),
  });
};

describe("Vero's message: a named dish is chosen directly (MI1)", () => {
  it("kitchen adds + a direct choose + a recipe whose Need is coconut milk, lemongrass, kaffir lime leaves", async () => {
    const k = chickenKitchen();
    const result = await interpret(k, VERO, VERO_OUTPUT);

    // One change: the two things she has, then the dish itself. No idea cards.
    expect(result.kind).toBe("change");
    const ops = ProposedChange.parse(result.proposal).operations;
    expect(ops.map((o) => o.type)).toEqual(["item.add", "item.add", "meal.choose"]);
    expect(ops[0]).toMatchObject({ fields: { name: { value: "curry base seasoning packet", basis: "said" } } });
    expect(ops[1]).toMatchObject({ fields: { name: { value: "potatoes", basis: "said" } } });
    expect(ops[2]).toMatchObject({ target: { title: "Chicken curry", notes: NOTES }, evidence: "i was thinking a chicken curry" });
    expect(result.followUps).toEqual([{ kind: "recipe", meal: { chooseOpId: ops[2].opId }, notes: NOTES }]);

    // The real validator: a new chosen meal with no idea, and the notes kept in history.
    const applied = k.say(VERO, ops);
    expect(applied.rejected).toEqual([]);
    const mealId = applied.applied[2].refs.find((r) => r.kind === "meal")!.id;
    expect(k.kitchen.meals[mealId]).toMatchObject({ title: "Chicken curry", status: "chosen" });
    expect(k.kitchen.meals[mealId].ideaId).toBeUndefined();
    const chosen = k.events.find((e) => e.type === KITCHEN_EVENT.mealChosen)!.payload as MealChosenPayload;
    expect(chosen).toMatchObject({ title: "Chicken curry", notes: NOTES, isNew: true });

    // The recipe sees the kitchen AFTER this turn's adds, plus her notes.
    const state = k.state();
    const label = (name: string) => `i${state.items.findIndex((i) => i.name.value === name) + 1}`;
    const { meals, bodies } = recipeClient({
      title: "Chicken curry",
      summary: "A cosy coconut chicken curry.",
      servings: "4",
      ingredients: [
        { name: "chicken thighs", amount: "600 g", item: label("chicken thighs"), basic: false },
        { name: "curry base seasoning packet", amount: "1", item: null, basic: false },
        { name: "potatoes", amount: "3", item: null, basic: false },
        { name: "coconut milk", amount: "1 can", item: null, basic: false },
        { name: "lemongrass", amount: "2 stalks", item: null, basic: false },
        { name: "kaffir lime leaves", amount: "4", item: null, basic: false },
        { name: "salt", amount: "to taste", item: null, basic: true },
        { name: "cooking oil", amount: "1 tbsp", item: null, basic: true },
      ],
      steps: ["Brown the chicken.", "Add the curry base, lemongrass and lime leaves.", "Add potatoes and coconut milk; simmer until tender."],
      reply: "Here's a chicken curry with what you have.",
    });
    const ctx: MealContext = { kitchenId: k.kitchenId, userId: "vero", state, members: MEMBERS, restrictions: [LEVI_SEAFOOD] };
    const recipe = await meals.generateRecipe({ ...ctx, meal: { mealId, title: "Chicken curry", notes: NOTES } });
    if (!recipe.ok) throw new Error("recipe failed");
    expect(bodies[0].messages[0].content).toContain(`<meal>\nDish: Chicken curry\nThe user named this dish and said: ${NOTES}\n</meal>`);

    const group = (g: string) => recipe.recipe.ingredients.filter((i) => i.group === g).map((i) => i.name);
    expect(group("kitchen")).toEqual(["chicken thighs", "curry base seasoning packet", "potatoes"]);
    expect(group("need")).toEqual(["coconut milk", "lemongrass", "kaffir lime leaves"]);
    expect(recipe.recipe.basicsAssumed).toEqual(["salt", "cooking oil"]);
    expect(recipe.notes[0]?.code).toBe("BASICS_ASSUMED");
    expect(recipe.recipe.allergenFlags).toEqual([]); // no seafood: no badge
    expect(k.tap([recipe.operation]).rejected).toEqual([]);

    // Cooking it uses the OLDEST chicken batch first (0025).
    const oldest = k.item("chicken thighs")!.batches[0].id;
    k.say("start cooking", [{ type: "meal.transition", target: { mealId }, to: "cooking" }]);
    k.say("I made it", [{ type: "meal.transition", target: { mealId }, to: "done" }]);
    const used = k.events.filter((e) => e.type === KITCHEN_EVENT.itemUsed).map((e) => e.payload as ItemUsedPayload);
    const chicken = k.item("chicken thighs")!;
    expect(used.find((u) => u.itemId === chicken.id)).toMatchObject({ batchId: oldest, mealId });
  });

  it("ingredients said as part of the dish are not kitchen adds unless she says she has them", async () => {
    const k = chickenKitchen();
    const wrong = output({
      ...VERO_OUTPUT,
      operations: [
        op("add", "coconut milk", "coconutt milk"),
        op("add", "lemongrass", "lemon grass"),
        ...VERO_OUTPUT.operations,
      ],
    });
    const result = await interpret(k, VERO, wrong);
    const names = ProposedChange.parse(result.proposal).operations.flatMap((o) => (o.type === "item.add" ? [o.fields.name.value] : []));
    expect(names).toEqual(["curry base seasoning packet", "potatoes"]);
  });

  it("'or something else?' goes to ideas, even if the model also named the dish", async () => {
    const k = chickenKitchen();
    const text = "i was thinking a chicken curry, or something else?";
    const routed = await interpret(k, text, output({ kind: "answer", reply: "Let me look at what you have.", generate: { what: "ideas", meal: null } }));
    expect(routed).toMatchObject({ kind: "answer", proposal: null, followUps: [{ kind: "ideas", request: text }] });

    const guarded = await interpret(k, text, output({ kind: "change", reply: "Sure.", dish: { title: "Chicken curry", notes: null, evidence: "i was thinking a chicken curry" } }));
    expect(guarded.proposal).toBeNull();
    expect(guarded.followUps).toEqual([{ kind: "ideas", request: text }]);
  });

  it("a named dish that matches a shown idea card chooses that card", async () => {
    const k = chickenKitchen();
    k.ideas.set("idea-curry", { name: "Chicken curry" });
    const result = await interpret(k, "let's do a chicken curry", output({ dish: { title: "chicken curry", notes: null, evidence: "let's do a chicken curry" } }), [
      { ideaId: "idea-curry", name: "Chicken curry" },
    ]);
    const ops = ProposedChange.parse(result.proposal).operations;
    expect(ops).toEqual([{ opId: "msg-curry:dish", type: "meal.choose", target: { ideaId: "idea-curry" }, evidence: "let's do a chicken curry" }]);
    expect(k.say("let's do a chicken curry", ops).rejected).toEqual([]);
  });

  it("the contract: a named dish needs a title; notes are optional", () => {
    expect(MealChoose.safeParse({ opId: "1", type: "meal.choose", target: { title: "  " } }).success).toBe(false);
    expect(MealChoose.safeParse({ opId: "1", type: "meal.choose", target: { title: "Pad thai" } }).success).toBe(true);
    expect(MealChoose.safeParse({ opId: "1", type: "meal.choose", target: { title: "Pad thai", ideaId: "x" } }).success).toBe(false);
  });
});

describe("the stand-in AI and a named dish (0059 PF10)", () => {
  it("Vero's message needs the real AI: the decline line, nothing added or chosen (no 'ingredients needed…' items)", async () => {
    const k = chickenKitchen();
    const state = k.state();
    for (const text of [VERO, "I want to make a chicken curry. I have the ingredients needed to make this"]) {
      const result = await createFakeInterpreter().interpret({ kitchenId: k.kitchenId, userId: "vero", message: { id: "msg-f", text }, state, version: state.version, history: [] });
      expect(result, text).toEqual({ kind: "answer", proposal: null, reply: STAND_IN_DECLINE_REPLY });
    }
  });

  it("'make me a sample recipe for chicken curry' → a clearly titled sample, chosen; what she has goes under In your kitchen", async () => {
    const k = chickenKitchen();
    const state = k.state();
    const text = "make me a sample recipe for chicken curry";
    const result = await createFakeInterpreter().interpret({ kitchenId: k.kitchenId, userId: "vero", message: { id: "msg-s", text }, state, version: state.version, history: [] });
    const ops = ProposedChange.parse(result.proposal).operations;
    expect(ops).toMatchObject([{ type: "meal.choose", target: { title: "Sample recipe (stand-in): Chicken curry" } }]);
    const applied = k.say(text, ops);
    expect(applied.rejected).toEqual([]);
    const mealId = applied.applied[0].refs.find((r) => r.kind === "meal")!.id;
    const recipe = await createFakeMealAI().generateRecipe({
      kitchenId: k.kitchenId,
      userId: "vero",
      state: k.state(),
      members: MEMBERS,
      restrictions: [],
      meal: { mealId, title: "Sample recipe (stand-in): Chicken curry" },
    });
    if (!recipe.ok) throw new Error("recipe failed");
    const group = (g: string) => recipe.recipe.ingredients.filter((i) => i.group === g).map((i) => i.name);
    expect(group("kitchen")).toContain("chicken thighs");
    expect(group("need")).toEqual(expect.arrayContaining(["curry paste", "coconut milk"]));
    expect(recipe.recipe.ingredients.filter((i) => i.group !== "basic").every((i) => i.amount)).toBe(true);
  });

  it("an allergen sample dish is allowed and flagged by code (0019)", async () => {
    const k = new MemoryKitchen();
    const recipe = await createFakeMealAI().generateRecipe({
      kitchenId: k.kitchenId,
      userId: "vero",
      state: k.state(),
      members: MEMBERS,
      restrictions: [LEVI_SEAFOOD],
      meal: { mealId: "meal-x", title: "Sample recipe (stand-in): Shrimp tacos" },
    });
    expect(recipe.ok && recipe.recipe.allergenFlags.map((f) => f.subject)).toContain("seafood");
  });
});
