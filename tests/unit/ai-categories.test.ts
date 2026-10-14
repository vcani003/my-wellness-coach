/**
 * Item categories (CAT1), the AI half: the real interpreter with a mocked client guesses a category
 * on every add (Vietnamese and Asian pantry items too), turns "fish sauce goes under sauces" into a
 * said correction, and answers "where's the fish sauce?" from a kitchen line that shows the type.
 * Every result passes the contract and is applied by the real kitchen validator (MemoryKitchen).
 * Also: the code guards on a "said" category, the wire sentinel, and the fake interpreter.
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { ItemCategory } from "@/contracts/common";
import { ProposedChange } from "@/contracts/proposed-change";
import type { Operation, OperationOf } from "@/contracts/operations";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { fromWire, modelOutputFormat, NO_CATEGORY, toWire, type ModelOp, type ModelOutput } from "@/ai/real/model-output";
import { NOTHING_TO_CHANGE_REPLY } from "@/ai/real/to-proposal";
import { createFakeInterpreter } from "@/ai/fake";
import { categoryFromWords } from "@/ai/fake/patterns";
import type { InterpretRequest } from "@/ai/interpreter";
import { NOW } from "@/ai/eval/fixtures";
import { MemoryKitchen, said } from "../support/memory-kitchen";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Cat = NonNullable<ModelOp["category"]>;

const guess = (value: ItemCategory, confidence: Cat["confidence"] = "high"): Cat => ({ value, basis: "inferred", confidence });
const told = (value: ItemCategory): Cat => ({ value, basis: "said", confidence: "high" });
const name = (value: string) => ({ value, basis: "said" as const, confidence: "high" as const });

function op(partial: Partial<ModelOp> & Pick<ModelOp, "action" | "evidence">): ModelOp {
  return { item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, meal: null, ...partial };
}

function respond(operations: ModelOp[], kind: ModelOutput["kind"] = "change", reply = "Got it.") {
  const out: ModelOutput = { kind, reply, operations, clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null };
  const calls: Params[] = [];
  const messages: MessagesApi = {
    create: vi.fn(async (body: Params) => {
      calls.push(body);
      return {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(toWire(out)), citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
      } as unknown as Message;
    }),
  };
  return { interpreter: createRealInterpreter({ messages, now: () => NOW, log: () => {}, env: {} }), calls };
}

function requestFor(k: MemoryKitchen, text: string): InterpretRequest {
  const state = k.state();
  return { kitchenId: state.kitchenId, userId: "vero", message: { id: "msg-1", text }, state, version: state.version, history: [] };
}

/** Interprets `text` (the model answering `ops`), checks the contract, and applies it. */
async function interpretAndApply(k: MemoryKitchen, text: string, ops: ModelOp[]) {
  const { interpreter } = respond(ops);
  const result = await interpreter.interpret(requestFor(k, text));
  expect(result.kind, text).toBe("change");
  const operations: Operation[] = ProposedChange.parse(result.proposal).operations;
  const plan = k.say(text, operations);
  expect(plan.rejected, text).toEqual([]);
  return operations;
}

/** Schema nodes using anyOf / oneOf / a type array (as the guard test counts them). */
function countUnions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + countUnions(x), 0);
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  const self = Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.oneOf) ? 1 : 0;
  return self + Object.values(o).reduce((n: number, v) => n + countUnions(v), 0);
}

const row = (k: MemoryKitchen, n: string) => k.state().items.find((i) => i.name.value === n);
const categoryOf = (k: MemoryKitchen, n: string) => row(k, n)?.category;
const adds = (ops: Operation[]) => ops.filter((o): o is OperationOf<"item.add"> => o.type === "item.add");
const updates = (ops: Operation[]) => ops.filter((o): o is OperationOf<"item.update"> => o.type === "item.update");

describe("inferring a category on add (CAT1)", () => {
  it("sorts a Vietnamese grocery haul and pho leftovers, as the model's guess", async () => {
    const k = new MemoryKitchen();
    const text = "Got nước mắm, 2 bags of bánh phở, culantro, lemongrass and I made pho";
    const ops = await interpretAndApply(k, text, [
      op({ action: "add", evidence: "nước mắm", name: name("nước mắm (fish sauce)"), category: guess("sauces_condiments") }),
      op({ action: "add", evidence: "2 bags of bánh phở", name: name("bánh phở (rice noodles)"), category: guess("rice_noodles_grains") }),
      op({ action: "add", evidence: "culantro", name: name("culantro"), category: guess("produce") }),
      op({ action: "add", evidence: "lemongrass", name: name("lemongrass"), category: guess("produce") }),
      op({ action: "add", evidence: "I made pho", name: { ...name("pho (leftovers)"), basis: "inferred" }, category: guess("leftovers") }),
    ]);
    expect(adds(ops).map((o) => o.fields.category)).toEqual([
      guess("sauces_condiments"),
      guess("rice_noodles_grains"),
      guess("produce"),
      guess("produce"),
      guess("leftovers"),
    ]);
    expect(categoryOf(k, "nước mắm (fish sauce)")).toEqual(guess("sauces_condiments"));
    expect(categoryOf(k, "bánh phở (rice noodles)")).toEqual(guess("rice_noodles_grains"));
    expect(categoryOf(k, "culantro")).toEqual(guess("produce")); // the keyword map alone would say "other"
    expect(categoryOf(k, "pho (leftovers)")).toEqual(guess("leftovers"));
    expect(k.kitchen.categoryPrefs).toEqual({}); // a guess is never remembered
  });

  it("no category from the model ('none') or a low-confidence one: the backend's keyword guess", async () => {
    const k = new MemoryKitchen();
    const ops = await interpretAndApply(k, "bought hoisin and zzz", [
      op({ action: "add", evidence: "hoisin", name: name("hoisin") }),
      op({ action: "add", evidence: "zzz", name: name("zzz"), category: guess("drinks", "low") }),
    ]);
    expect(adds(ops).every((o) => !("category" in o.fields))).toBe(true);
    expect(categoryOf(k, "hoisin")?.value).toBe("sauces_condiments");
    expect(categoryOf(k, "zzz")).toEqual({ value: "other", basis: "inferred", confidence: "low" });
  });

  it("a household's remembered correction beats the model's guess (the backend applies it)", async () => {
    const k = new MemoryKitchen();
    k.say("bought tofu", [{ type: "item.add", fields: { name: said("tofu") } }]);
    k.say("put the tofu in dairy & eggs", [{ type: "item.update", target: { name: "tofu" }, fields: { category: said("dairy_eggs") } }]);
    k.say("tossed the tofu", [{ type: "item.remove", target: { name: "tofu" } }]);
    await interpretAndApply(k, "bought tofu", [op({ action: "add", evidence: "bought tofu", name: name("tofu"), category: guess("produce") })]);
    expect(categoryOf(k, "tofu")).toEqual({ value: "dairy_eggs", basis: "inferred", confidence: "high" });
  });

  it("a 'said' category on a plain add is downgraded to the model's guess, so it isn't remembered", async () => {
    // Regression guard: the model claiming "said" for "I bought hoisin" would otherwise teach the
    // kitchen a category the user never chose.
    const k = new MemoryKitchen();
    const ops = await interpretAndApply(k, "I bought hoisin", [op({ action: "add", evidence: "I bought hoisin", name: name("hoisin"), category: told("drinks") })]);
    expect(adds(ops)[0].fields.category).toEqual(guess("drinks"));
    expect(k.kitchen.categoryPrefs).toEqual({});
  });

  it("a category the user names while adding stays said, and is remembered", async () => {
    const k = new MemoryKitchen();
    const text = "bought hoisin, it goes under sauces";
    await interpretAndApply(k, text, [op({ action: "add", evidence: "bought hoisin", name: name("hoisin"), category: told("sauces_condiments") })]);
    expect(categoryOf(k, "hoisin")).toEqual(said("sauces_condiments"));
    expect(k.kitchen.categoryPrefs["hoisin"]?.category).toBe("sauces_condiments");
  });
});

describe("corrections (CAT1)", () => {
  function stocked() {
    const k = new MemoryKitchen();
    k.say("bought nước mắm (fish sauce) and tofu", [
      { type: "item.add", fields: { name: said("nước mắm (fish sauce)") } },
      { type: "item.add", fields: { name: said("tofu") } },
    ]);
    return k; // i1 nước mắm (fish sauce), i2 tofu
  }

  it.each<[string, string, ItemCategory]>([
    ["fish sauce goes under sauces", "i1", "sauces_condiments"],
    ["put the tofu in dairy & eggs", "i2", "dairy_eggs"],
    ["hoisin is a condiment", "i1", "sauces_condiments"],
    ["file the tofu under produce", "i2", "produce"],
  ])("%s → item.update with a said category, applied and remembered", async (text, label, category) => {
    const k = stocked();
    const ops = await interpretAndApply(k, text, [op({ action: "update", evidence: text, item: label, category: told(category) })]);
    const [upd] = updates(ops);
    expect(upd.target).toEqual({ itemId: k.state().items[Number(label.slice(1)) - 1].id });
    expect(upd.fields).toEqual({ category: said(category) });
    const itemName = k.state().items[Number(label.slice(1)) - 1].name.value;
    expect(categoryOf(k, itemName)).toEqual(said(category));
    expect(Object.values(k.kitchen.categoryPrefs).map((p) => p.category)).toEqual([category]);
  });

  it("drops an update category that isn't the user's own correction (the model re-sorting on its own)", async () => {
    const k = stocked();
    const { interpreter } = respond([op({ action: "update", evidence: "the tofu", item: "i2", category: guess("produce") })]);
    const r = await interpreter.interpret(requestFor(k, "how's the tofu?"));
    expect(r).toMatchObject({ kind: "answer", proposal: null, reply: NOTHING_TO_CHANGE_REPLY });
  });

  it("drops a 'said' update category when the words don't talk about categories", async () => {
    const k = stocked();
    const { interpreter } = respond([op({ action: "update", evidence: "the tofu", item: "i2", category: told("drinks") })]);
    const r = await interpreter.interpret(requestFor(k, "I opened the tofu"));
    expect(r.proposal).toBeNull();
  });

  it("a correction for something not in the kitchen still goes to the backend, which remembers it", async () => {
    const k = stocked();
    const text = "hoisin goes under sauces";
    const { interpreter } = respond([op({ action: "update", evidence: text, name: name("hoisin"), category: told("sauces_condiments") })]);
    const r = await interpreter.interpret(requestFor(k, text));
    const plan = k.say(text, ProposedChange.parse(r.proposal).operations);
    expect(plan.rejected).toEqual([]);
    expect(row(k, "hoisin")).toBeUndefined(); // nothing added
    expect(k.kitchen.categoryPrefs["hoisin"]?.category).toBe("sauces_condiments");
  });
});

describe("where's the fish sauce? (CAT1)", () => {
  it("the model sees each item's place and type, and answers without changing anything", async () => {
    const k = new MemoryKitchen();
    k.say("bought nước mắm (fish sauce)", [{ type: "item.add", fields: { name: said("nước mắm (fish sauce)"), location: said("pantry") } }]);
    const reply = "Your nước mắm (fish sauce) is in the pantry, under Sauces & condiments.";
    const { interpreter, calls } = respond([], "answer", reply);
    const r = await interpreter.interpret(requestFor(k, "where's the fish sauce?"));
    expect(r).toMatchObject({ kind: "answer", proposal: null, reply });
    const user = calls[0].messages[0].content as string;
    expect(user).toMatch(/i1: nước mắm \(fish sauce\) · pantry · type sauces_condiments/);
    const system = JSON.stringify(calls[0].system);
    expect(system).toContain("Where's the X?");
    expect(system).toContain("sauces_condiments: fish sauce");
  });
});

describe("the wire sentinel (CAT1, schema limit)", () => {
  it("adds no union type: category is an object whose value 'none' means absent", () => {
    const props = (modelOutputFormat().schema as { properties: { operations: { items: { properties: Record<string, unknown> } } } }).properties.operations.items.properties;
    expect(countUnions(props.category)).toBe(0);
    expect(JSON.stringify(props.category)).toContain('"none"');
  });

  it("'none' decodes to no category, and a category round-trips", () => {
    const base = op({ action: "add", evidence: "x", name: name("x") });
    const wire = toWire({ kind: "change", reply: "ok", operations: [base], clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null });
    expect(wire.operations[0].category).toEqual(NO_CATEGORY);
    expect(fromWire(wire).operations[0]).not.toHaveProperty("category");
    const withCat = { ...wire, operations: [{ ...wire.operations[0], category: guess("produce") }] };
    expect(fromWire(withCat).operations[0].category).toEqual(guess("produce"));
  });
});

describe("the fake interpreter (CAT1)", () => {
  const fake = createFakeInterpreter();

  it("puts bought items into categories with the shared keyword map", async () => {
    const k = new MemoryKitchen();
    const r = await fake.interpret(requestFor(k, "I bought fish sauce, bánh phở and lemongrass"));
    const ops = ProposedChange.parse(r.proposal).operations;
    expect(adds(ops).map((o) => o.fields.category?.value)).toEqual(["sauces_condiments", "rice_noodles_grains", "produce"]);
    expect(k.say("bought", ops).rejected).toEqual([]);
  });

  it("'X goes under Y' is a said correction the backend remembers", async () => {
    const k = new MemoryKitchen();
    k.say("bought tofu", [{ type: "item.add", fields: { name: said("tofu") } }]);
    const r = await fake.interpret(requestFor(k, "tofu goes under dairy & eggs"));
    expect(r.reply).toBe("Done: the tofu is under Dairy & eggs now.");
    const plan = k.say("tofu goes under dairy & eggs", ProposedChange.parse(r.proposal).operations);
    expect(plan.rejected).toEqual([]);
    expect(categoryOf(k, "tofu")).toEqual(said("dairy_eggs"));
    expect(k.kitchen.categoryPrefs["tofu"]?.category).toBe("dairy_eggs");
  });

  it("'put X in the fridge' is not a category; nearest category words map to IDs", async () => {
    const r = await fake.interpret(requestFor(new MemoryKitchen(), "put the milk in the fridge"));
    expect(r.proposal).toBeNull();
    expect(categoryFromWords("sauces")).toBe("sauces_condiments");
    expect(categoryFromWords("the Spices")).toBe("spices_seasonings");
    expect(categoryFromWords("noodles")).toBe("rice_noodles_grains");
    expect(categoryFromWords("the fridge")).toBeNull();
  });
});
