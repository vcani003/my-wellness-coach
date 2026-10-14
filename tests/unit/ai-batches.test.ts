/**
 * Older and newer batches (0025), the AI half: the real interpreter with a mocked client turns each
 * phrase into operations that pass the contract and that the kitchen validator applies; the
 * kitchen line shows batches compactly; the fake interpreter's two batch phrases.
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { ProposedChange } from "@/contracts/proposed-change";
import type { Operation } from "@/contracts/operations";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { toWire, type ModelOp, type ModelOutput } from "@/ai/real/model-output";
import { SYSTEM_PROMPT } from "@/ai/real/prompt";
import { createFakeInterpreter } from "@/ai/fake";
import type { InterpretRequest } from "@/ai/interpreter";
import { NOW, request } from "@/ai/eval/fixtures";
import { MemoryKitchen, said } from "../support/memory-kitchen";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.UTC(2026, 9, 14, 12) - n * DAY).toISOString();
const inferred = <T>(value: T) => ({ value, basis: "inferred" as const, confidence: "medium" as const });

function op(partial: Partial<ModelOp> & Pick<ModelOp, "action" | "evidence">): ModelOp {
  return { item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, meal: null, ...partial };
}

function respond(operations: ModelOp[]) {
  const out: ModelOutput = { kind: "change", reply: "Got it.", operations, clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null };
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

function requestFor(k: MemoryKitchen, text: string, history: InterpretRequest["history"] = []): InterpretRequest {
  const state = k.state();
  return { kitchenId: state.kitchenId, userId: "vero", message: { id: "msg-1", text }, state, version: state.version, history };
}

/** Eggs from Oct 2 (12) and today (6), and frozen chicken: i1 eggs, i2 chicken thighs. */
function kitchenWithBatches() {
  const k = new MemoryKitchen();
  const eggs = (n: number, ago: number) => ({
    type: "item.add" as const,
    fields: { name: said("eggs"), quantity: said({ asSaid: `${n} eggs`, amount: n, unit: "eggs" }), occurredAt: said(daysAgo(ago)) },
  });
  k.say("12 eggs", [eggs(12, 12)]);
  k.say("6 eggs", [eggs(6, 0)]);
  k.say("froze chicken", [{ type: "item.add", fields: { name: said("chicken thighs"), location: said("freezer"), frozen: said(true) } }]);
  return k;
}

/** Interprets `text` (the model answering `ops`), checks the contract, and applies it. */
async function interpretAndApply(k: MemoryKitchen, text: string, ops: ModelOp[], history: InterpretRequest["history"] = []) {
  const { interpreter, calls } = respond(ops);
  const result = await interpreter.interpret(requestFor(k, text, history));
  expect(result.kind, text).toBe("change");
  const operations: Operation[] = ProposedChange.parse(result.proposal).operations;
  const plan = k.say(text, operations);
  expect(plan.rejected, text).toEqual([]);
  return { operations, plan, calls };
}

const eggBatches = (k: MemoryKitchen) => k.state().items.find((i) => i.name.value === "eggs")?.batches ?? [];

describe("what the model sees (0025)", () => {
  it("shows batches compactly, oldest first, and keeps the cached prefix byte-identical", async () => {
    const k = kitchenWithBatches();
    const { interpreter, calls } = respond([]);
    await interpreter.interpret(requestFor(k, "what do I have?"));
    await interpreter.interpret(request("what do I have?"));
    const user = calls[0].messages[0].content as string;
    expect(user).toContain("i1: eggs · 18 eggs · not sure where · 2 batches (Oct 2, today)");
    expect(user).toMatch(/i2: chicken thighs · freezer(\n| · added)/); // one batch: no batch list
    expect(user).not.toContain(k.state().items[0].batches![0].id); // no batch IDs for the model to copy
    const systems = calls.map((c) => (c.system as Anthropic.Beta.Messages.BetaTextBlockParam[])[0].text);
    expect(systems[0]).toBe(systems[1]);
    expect(systems[0]).toBe(SYSTEM_PROMPT);
  });

  it("shows when something was defrosted", async () => {
    const k = kitchenWithBatches();
    k.say("defrosted the chicken", [{ type: "item.defrost", target: { name: "chicken thighs" } }]);
    const { interpreter, calls } = respond([]);
    await interpreter.interpret(requestFor(k, "what do I have?"));
    // Defrosting moves it to the fridge (DF1 Rec).
    expect(calls[0].messages[0].content as string).toContain("i2: chicken thighs · fridge · defrosted today");
  });
});

describe("batch phrases → operations the kitchen applies (0025)", () => {
  it("'I bought eggs' when eggs exist is a plain item.add; the backend adds the batch", async () => {
    const k = kitchenWithBatches();
    const text = "I bought eggs";
    const { operations, plan } = await interpretAndApply(k, text, [op({ action: "add", evidence: text, item: "i1", name: said("eggs") })]);
    expect(operations).toEqual([expect.objectContaining({ type: "item.add", fields: { name: said("eggs") } })]);
    expect(plan.applied[0].summary.code).toBe("ITEM_BATCH_ADDED");
    expect(eggBatches(k)).toHaveLength(3);
    expect(k.state().items.filter((i) => i.name.value === "eggs")).toHaveLength(1);
  });

  it("'the new eggs' targets the newest batch", async () => {
    const k = kitchenWithBatches();
    const text = "I used 3 of the new eggs";
    const { operations } = await interpretAndApply(k, text, [
      op({ action: "use", evidence: text, item: "i1", batch: "newest", amountUsed: { asSaid: "3", amount: 3, unit: "eggs", basis: "said", confidence: "high" } }),
    ]);
    expect(operations[0]).toMatchObject({ type: "item.use", target: { itemId: k.item("eggs")!.id, which: "newest" } });
    expect(eggBatches(k).map((b) => b.quantity?.value.amount)).toEqual([12, 3]);
  });

  it("'the ones I just bought' targets the newest batch too", async () => {
    const k = kitchenWithBatches();
    const text = "I put the ones I just bought in the fridge";
    const { operations } = await interpretAndApply(k, text, [
      op({ action: "update", evidence: text, item: "i1", batch: "newest", location: said("fridge") }),
    ]);
    expect(operations[0]).toMatchObject({ type: "item.update", target: { which: "newest" } });
    expect(eggBatches(k).map((b) => b.location?.value)).toEqual([undefined, "fridge"]);
  });

  it("'I used the old eggs' takes only the oldest batch", async () => {
    const k = kitchenWithBatches();
    const text = "I used the old eggs";
    const { operations } = await interpretAndApply(k, text, [op({ action: "use", evidence: text, item: "i1", batch: "oldest", stock: said("out") })]);
    expect(operations[0]).toMatchObject({ type: "item.use", target: { which: "oldest" } });
    expect(eggBatches(k).map((b) => b.addedAt)).toEqual([daysAgo(0)]);
  });

  it("a batch the user didn't name is dropped: 'we're out of eggs' still means every batch", async () => {
    const k = kitchenWithBatches();
    const text = "we're out of eggs";
    const { operations } = await interpretAndApply(k, text, [op({ action: "use", evidence: text, item: "i1", batch: "oldest", stock: said("out") })]);
    expect(operations[0]).toMatchObject({ type: "item.use", target: { itemId: k.item("eggs")!.id } });
    expect(operations[0]).not.toHaveProperty("target.which");
    expect(k.state().items.map((i) => i.name.value)).toEqual(["chicken thighs"]);
  });

  it("'the old eggs are gone' closes the oldest batch", async () => {
    const k = kitchenWithBatches();
    const text = "the old eggs are gone";
    const { operations, plan } = await interpretAndApply(k, text, [op({ action: "batch_gone", evidence: text, item: "i1", batch: "oldest" })]);
    expect(operations).toEqual([expect.objectContaining({ type: "item.batch.close", target: { itemId: k.item("eggs")!.id, which: "oldest" } })]);
    expect(plan.applied[0].summary.code).toBe("ITEM_BATCH_GONE");
    expect(eggBatches(k).map((b) => b.addedAt)).toEqual([daysAgo(0)]);
  });

  it("'we finished the older ones' (a reference) closes the oldest, also when the model leaves batch null", async () => {
    const k = kitchenWithBatches();
    const text = "we finished the older ones";
    const history = [
      { role: "user" as const, text: "I bought eggs" },
      { role: "assistant" as const, text: "Got it. You also had eggs from Oct 2." },
    ];
    const { operations } = await interpretAndApply(k, text, [op({ action: "batch_gone", evidence: text, item: "i1" })], history);
    expect(operations[0]).toMatchObject({ type: "item.batch.close", target: { which: "oldest" } });
    expect(eggBatches(k)).toHaveLength(1);
  });

  it("'I defrosted the chicken' is item.defrost, plus the move to the fridge", async () => {
    const k = kitchenWithBatches();
    const text = "I defrosted the chicken";
    const { operations, plan } = await interpretAndApply(k, text, [
      op({ action: "defrost", evidence: text, item: "i2", location: inferred("fridge") }),
    ]);
    const id = k.item("chicken thighs")!.id;
    expect(operations).toEqual([
      expect.objectContaining({ type: "item.defrost", target: { itemId: id } }),
      expect.objectContaining({ type: "item.update", target: { itemId: id }, fields: { location: inferred("fridge") } }),
    ]);
    expect(plan.applied[0].summary.code).toBe("ITEM_DEFROSTED");
    const chicken = k.state().items.find((i) => i.id === id)!;
    expect(chicken.defrostedOn).toBeDefined();
    expect(chicken.frozen?.value).toBe(false);
    expect(chicken.location?.value).toBe("fridge");
  });

  it("an older-style 'update frozen: false' for a defrost still becomes item.defrost", async () => {
    const k = kitchenWithBatches();
    const text = "took the chicken out to thaw";
    const { operations } = await interpretAndApply(k, text, [
      op({ action: "update", evidence: text, item: "i2", frozen: said(false), location: inferred("fridge") }),
    ]);
    expect(operations.map((o) => o.type)).toEqual(["item.defrost", "item.update"]);
    expect(k.state().items.find((i) => i.name.value === "chicken thighs")?.defrostedOn).toBeDefined();
  });

  it("defrosting something not in the kitchen still records it (0011)", async () => {
    const k = kitchenWithBatches();
    const text = "I defrosted the shrimp";
    const { operations } = await interpretAndApply(k, text, [op({ action: "defrost", evidence: text, name: said("shrimp") })]);
    expect(operations).toEqual([expect.objectContaining({ type: "item.defrost", target: { name: "shrimp" } })]);
    expect(k.state().items.find((i) => i.name.value === "shrimp")?.defrostedOn).toBeDefined();
  });

  it("an untargeted update goes to the oldest batch (the backend default)", async () => {
    const k = kitchenWithBatches();
    const text = "the eggs are in the fridge";
    const { operations } = await interpretAndApply(k, text, [op({ action: "update", evidence: text, item: "i1", location: said("fridge") })]);
    expect(operations[0]).toMatchObject({ type: "item.update", target: { itemId: k.item("eggs")!.id } });
    expect(operations[0]).not.toHaveProperty("target.which");
    expect(eggBatches(k).map((b) => b.location?.value)).toEqual(["fridge", undefined]);
  });
});

describe("the fake interpreter's batch phrases (e2e stand-in)", () => {
  it("'the old eggs are gone' and 'I defrosted the chicken' apply through the kitchen validator", async () => {
    const k = kitchenWithBatches();
    const fake = createFakeInterpreter();
    for (const [text, code] of [
      ["The old eggs are gone", "ITEM_BATCH_GONE"],
      ["I defrosted the chicken thighs", "ITEM_DEFROSTED"],
    ] as const) {
      const result = await fake.interpret(requestFor(k, text));
      const plan = k.say(text, ProposedChange.parse(result.proposal).operations);
      expect(plan.rejected, text).toEqual([]);
      expect(plan.applied[0].summary.code, text).toBe(code);
    }
    expect(eggBatches(k)).toHaveLength(1);
    expect(k.state().items.find((i) => i.name.value === "chicken thighs")?.frozen?.value).toBe(false);
  });
});
