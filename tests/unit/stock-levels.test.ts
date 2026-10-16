/**
 * Stock levels plenty / some / low / out (0045 KOS4) on the pure domain and the AI: the contract
 * (old low/out events stay valid), `item.stock.set` (whole item, one batch, Out, no-change, an
 * unknown item, an Out item coming back), the row's level from its batches, Undo, replay, the SL3
 * rule (only Low and Out offer the list), and the interpreter (real with a mocked model, and the fake).
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { STOCK_LEVELS, StockLevel, offersListAdd } from "@/contracts/common";
import { KitchenState } from "@/contracts/kitchen-state";
import { Operation } from "@/contracts/operations";
import { ProposedChange } from "@/contracts/proposed-change";
import { createFakeInterpreter } from "@/ai/fake";
import { matchIntent } from "@/ai/fake/patterns";
import type { InterpretRequest } from "@/ai/interpreter";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { toWire, type ModelOp, type ModelOutput } from "@/ai/real/model-output";
import { renderKitchen, SYSTEM_PROMPT } from "@/ai/real/prompt";
import { NOW } from "@/ai/eval/fixtures";
import { getKitchenEntity, kitchenTouchedKeys, replay, KITCHEN_EVENT } from "@/domains/kitchen/state";
import type { Plan, RevertPlan } from "@/domains/kitchen/validate";
import { MemoryKitchen, said } from "../support/memory-kitchen";

const codes = (p: Plan) => p.rejected.map((r) => r.reason.code);
const row = (k: MemoryKitchen, name: string) => k.state().items.find((i) => i.name.value === name);
const level = (stock: StockLevel) => ({ stock: said(stock) });

function revertPlan(k: MemoryKitchen, plan: Plan): RevertPlan {
  const csId = plan.events[0].changeSetId;
  const first = k.events.findIndex((e) => e.changeSetId === csId);
  const before = replay(k.events.slice(0, first));
  const restore: Record<string, unknown> = {};
  for (const key of new Set(k.events.filter((e) => e.changeSetId === csId).flatMap(kitchenTouchedKeys))) {
    restore[key] = getKitchenEntity(before, key);
  }
  return { ok: true, restoreByStream: { [`kitchen:${k.kitchenId}`]: restore } };
}
function undo(k: MemoryKitchen, plan: Plan): Plan {
  const csId = plan.events[0].changeSetId;
  return k.tap([{ type: "changeset.revert", target: { changeSetId: csId } }], { reverts: new Map([[csId, revertPlan(k, plan)]]) });
}

/** Rice (one batch) and eggs (two batches: Oct 2 and today). */
function kitchen() {
  const k = new MemoryKitchen();
  k.say("bought rice", [{ type: "item.add", fields: { name: said("rice"), location: said("pantry") } }]);
  k.say("eggs on Oct 2", [{ type: "item.add", fields: { name: said("eggs"), occurredAt: said("2026-10-02T12:00:00.000Z") } }]);
  k.say("bought eggs", [{ type: "item.add", fields: { name: said("eggs") } }]);
  return k;
}

describe("the contract (KOS4)", () => {
  it("has four levels, and Low and Out are the only ones that offer the list (SL3)", () => {
    expect(STOCK_LEVELS).toEqual(["plenty", "some", "low", "out"]);
    expect(STOCK_LEVELS.filter(offersListAdd)).toEqual(["low", "out"]);
    expect(offersListAdd(undefined)).toBe(false);
  });

  it("parses item.stock.set and the older item.use with low/out; rejects a made-up level", () => {
    const set = { opId: "1", type: "item.stock.set", evidence: "x", target: { itemId: "i1" }, fields: { stock: said("plenty") } };
    expect(Operation.safeParse(set).success).toBe(true);
    expect(Operation.safeParse({ ...set, target: { itemId: "i1", batchId: "b1" }, fields: { stock: said("some") } }).success).toBe(true);
    expect(Operation.safeParse({ ...set, fields: { stock: said("lots") } }).success).toBe(false);
    // A level is required: "unknown" is the absence of a level, never a value to set.
    expect(Operation.safeParse({ ...set, fields: {} }).success).toBe(false);
    for (const stock of ["low", "out"] as const) {
      expect(Operation.safeParse({ opId: "2", type: "item.use", target: { name: "eggs" }, fields: { stock: said(stock) } }).success).toBe(true);
    }
  });

  it("a kitchen row with no level stays valid (unknown, no default)", () => {
    const k = kitchen();
    expect(KitchenState.parse(k.state()).items.every((i) => i.stock === undefined)).toBe(true);
  });
});

describe("item.stock.set (KOS4)", () => {
  it("sets plenty on the whole item: every open batch, one event each, no 'last used'", () => {
    const k = kitchen();
    const eggsId = k.item("eggs")!.id;
    const plan = k.tap([{ type: "item.stock.set", target: { itemId: eggsId }, fields: level("plenty") }]);
    expect(codes(plan)).toEqual([]);
    expect(plan.events.map((e) => e.type)).toEqual([KITCHEN_EVENT.stockSet, KITCHEN_EVENT.stockSet]);
    expect(plan.applied[0].summary).toMatchObject({ code: "ITEM_PLENTY", params: { name: "eggs" } });
    expect(plan.applied[0].refs).toEqual([{ kind: "item", id: eggsId, change: "updated" }]);
    const eggs = row(k, "eggs")!;
    expect(eggs.stock).toEqual(said("plenty"));
    expect(eggs.batches!.every((b) => b.stock?.value === "plenty")).toBe(true);
    expect(eggs.lastUsedAt).toBeUndefined();
  });

  it("some on one named batch: the row stays unknown until every open batch has a level", () => {
    const k = kitchen();
    const eggs = k.item("eggs")!;
    const plan = k.tap([{ type: "item.stock.set", target: { itemId: eggs.id, which: "newest" }, fields: level("some") }]);
    expect(plan.applied[0].summary.code).toBe("ITEM_SOME");
    expect(plan.applied[0].refs[0].batchId).toBe(row(k, "eggs")!.batches![1].id);
    expect(row(k, "eggs")!.stock).toBeUndefined();
    // Now the older batch is low: the row shows the highest level (some > low).
    k.tap([{ type: "item.stock.set", target: { itemId: eggs.id, which: "oldest" }, fields: level("low") }]);
    expect(row(k, "eggs")!.stock?.value).toBe("some");
  });

  it("low and out keep their meaning: Low is labelled, Out closes every batch and drops the row", () => {
    const k = kitchen();
    const riceId = k.item("rice")!.id;
    const low = k.tap([{ type: "item.stock.set", target: { itemId: riceId }, fields: level("low") }]);
    expect(low.applied[0].summary.code).toBe("ITEM_LOW");
    expect(row(k, "rice")!.stock?.value).toBe("low");
    const eggsId = k.item("eggs")!.id;
    const out = k.tap([{ type: "item.stock.set", target: { itemId: eggsId }, fields: level("out") }]);
    expect(out.applied[0].summary.code).toBe("ITEM_OUT");
    expect(row(k, "eggs")).toBeUndefined();
    expect(k.item("eggs")!.stock?.value).toBe("out");
    expect(k.item("eggs")!.batches.every((b) => b.closedReason === "used-up")).toBe(true);
  });

  it("out on one batch closes only that one", () => {
    const k = kitchen();
    const eggsId = k.item("eggs")!.id;
    const plan = k.tap([{ type: "item.stock.set", target: { itemId: eggsId, which: "oldest" }, fields: level("out") }]);
    expect(plan.applied[0].summary).toMatchObject({ code: "ITEM_BATCH_USED_UP", params: { left: 1 } });
    expect(row(k, "eggs")!.batches).toHaveLength(1);
  });

  it("the same level again is no change (a double tap is harmless)", () => {
    const k = kitchen();
    const riceId = k.item("rice")!.id;
    k.tap([{ type: "item.stock.set", target: { itemId: riceId }, fields: level("plenty") }]);
    const again = k.tap([{ type: "item.stock.set", target: { itemId: riceId }, fields: level("plenty") }]);
    expect(again.events).toEqual([]);
    expect(again.applied[0].summary.code).toBe("NO_CHANGE");
  });

  it("an item the kitchen never heard about is recorded with that level (0011)", () => {
    const k = kitchen();
    const plan = k.say("we have plenty of fish sauce", [{ type: "item.stock.set", target: { name: "fish sauce" }, fields: level("plenty") }]);
    expect(codes(plan)).toEqual([]);
    expect(plan.applied[0].refs[0].change).toBe("added");
    expect(row(k, "fish sauce")!.stock?.value).toBe("plenty");
  });

  it("an Out item set to some is back in stock as a new batch; out again is no change", () => {
    const k = kitchen();
    const riceId = k.item("rice")!.id;
    k.tap([{ type: "item.stock.set", target: { itemId: riceId }, fields: level("out") }]);
    expect(row(k, "rice")).toBeUndefined();
    expect(k.tap([{ type: "item.stock.set", target: { itemId: riceId }, fields: level("out") }]).applied[0].summary.code).toBe("NO_CHANGE");
    const back = k.say("there's some rice left", [{ type: "item.stock.set", target: { name: "rice" }, fields: level("some") }]);
    expect(codes(back)).toEqual([]);
    const rice = row(k, "rice")!;
    expect(rice.id).toBe(riceId);
    expect(rice.stock?.value).toBe("some");
    expect(rice.batches).toHaveLength(1);
    expect(rice.location?.value).toBe("pantry"); // where it was before (0041)
  });

  it("buying more adds a batch with no level, so the row is unknown again (as with Low)", () => {
    const k = kitchen();
    const riceId = k.item("rice")!.id;
    k.tap([{ type: "item.stock.set", target: { itemId: riceId }, fields: level("plenty") }]);
    k.say("bought rice", [{ type: "item.add", fields: { name: said("rice") } }]);
    expect(row(k, "rice")!.stock).toBeUndefined();
  });

  it("an unknown item ID or batch is refused", () => {
    const k = kitchen();
    expect(codes(k.tap([{ type: "item.stock.set", target: { itemId: "nope" }, fields: level("some") }]))).toEqual(["UNKNOWN_ITEM"]);
    const eggsId = k.item("eggs")!.id;
    expect(codes(k.tap([{ type: "item.stock.set", target: { itemId: eggsId, batchId: "nope" }, fields: level("some") }]))).toEqual([
      "UNKNOWN_TARGET",
    ]);
  });

  it("Undo puts the level back, and replaying the log gives the same state", () => {
    const k = kitchen();
    const eggsId = k.item("eggs")!.id;
    k.tap([{ type: "item.stock.set", target: { itemId: eggsId }, fields: level("some") }]);
    const plenty = k.tap([{ type: "item.stock.set", target: { itemId: eggsId }, fields: level("plenty") }]);
    expect(row(k, "eggs")!.stock?.value).toBe("plenty");
    const undone = undo(k, plenty);
    expect(codes(undone)).toEqual([]);
    expect(row(k, "eggs")!.stock?.value).toBe("some");
    // Undoing an Out brings the row back.
    const out = k.tap([{ type: "item.stock.set", target: { itemId: eggsId }, fields: level("out") }]);
    expect(row(k, "eggs")).toBeUndefined();
    undo(k, out);
    expect(row(k, "eggs")!.stock?.value).toBe("some");
    expect(k.replayKitchen()).toEqual(k.kitchen);
  });

  it("a use can carry a level too ('used some milk, plenty left') and says so", () => {
    const k = kitchen();
    const plan = k.say("used some rice, still plenty", [{ type: "item.use", target: { name: "rice" }, fields: { stock: said("plenty") } }]);
    expect(plan.applied[0].summary.code).toBe("ITEM_PLENTY");
    expect(row(k, "rice")!.stock?.value).toBe("plenty");
  });
});

describe("events from before KOS4 still replay", () => {
  it("item.used with low (no batch) marks every open batch low, as before", () => {
    const k = kitchen();
    k.say("eggs are running low", [{ type: "item.use", target: { name: "eggs" }, fields: { stock: said("low") } }]);
    const eggs = row(k, "eggs")!;
    expect(eggs.stock?.value).toBe("low");
    expect(k.replayKitchen()).toEqual(k.kitchen);
    // A stock.set event for a batch that no longer exists is ignored, never thrown (0018).
    const bogus = { ...k.events.at(-1)!, type: KITCHEN_EVENT.stockSet, payload: { itemId: eggs.id, batchId: "gone", stock: said("plenty") } };
    expect(() => replay([...k.events, bogus])).not.toThrow();
    expect(replay([...k.events, bogus]).items[eggs.id].stock?.value).toBe("low");
  });
});

// ─── The AI ───────────────────────────────────────────────────────────────────────────

function op(partial: Partial<ModelOp> & Pick<ModelOp, "action" | "evidence">): ModelOp {
  return { item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, meal: null, ...partial };
}

function respond(operations: ModelOp[]) {
  const out: ModelOutput = { kind: "change", reply: "Got it.", operations, clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null };
  const messages: MessagesApi = {
    create: vi.fn(async () => {
      return {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(toWire(out)), citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Beta.Messages.BetaMessage;
    }),
  };
  return createRealInterpreter({ messages, now: () => NOW, log: () => {}, env: {} });
}

function requestFor(k: MemoryKitchen, text: string): InterpretRequest {
  const state = k.state();
  return { kitchenId: state.kitchenId, userId: "vero", message: { id: "msg-1", text }, state, version: state.version, history: [] };
}

async function interpretAndApply(k: MemoryKitchen, text: string, ops: ModelOp[]) {
  const result = await respond(ops).interpret(requestFor(k, text));
  const operations = ProposedChange.parse(result.proposal).operations;
  const plan = k.say(text, operations);
  expect(plan.rejected, text).toEqual([]);
  return { operations, plan };
}

const stockFact = (value: StockLevel) => ({ value, basis: "said" as const, confidence: "high" as const });
const nameFact = (value: string) => ({ value, basis: "said" as const, confidence: "high" as const });

describe("the interpreter maps level phrases (real, mocked model)", () => {
  it("'we have plenty of rice' (level) → item.stock.set plenty on the listed item", async () => {
    const k = kitchen(); // i1 eggs, i2 rice (labels follow the list order)
    const { operations } = await interpretAndApply(k, "we have plenty of rice", [
      op({ action: "level", evidence: "we have plenty of rice", item: "i2", stock: stockFact("plenty") }),
    ]);
    expect(operations).toEqual([expect.objectContaining({ type: "item.stock.set", target: { itemId: k.item("rice")!.id }, fields: { stock: stockFact("plenty") } })]);
    expect(row(k, "rice")!.stock?.value).toBe("plenty");
  });

  it("'there's some milk left' read as a use is still a level, not a use", async () => {
    const k = kitchen();
    const { operations } = await interpretAndApply(k, "there's some milk left", [
      op({ action: "use", evidence: "there's some milk left", name: nameFact("milk"), stock: stockFact("some") }),
    ]);
    expect(operations[0]).toMatchObject({ type: "item.stock.set", target: { name: "milk" }, fields: { stock: { value: "some" } } });
    expect(row(k, "milk")!.stock?.value).toBe("some");
  });

  it("'we're low on eggs' stays a use with low (unchanged)", async () => {
    const k = kitchen();
    const { operations } = await interpretAndApply(k, "we're low on eggs", [
      op({ action: "use", evidence: "we're low on eggs", item: "i1", stock: stockFact("low") }),
    ]);
    expect(operations[0]).toMatchObject({ type: "item.use", fields: { stock: { value: "low" } } });
    expect(row(k, "eggs")!.stock?.value).toBe("low");
  });

  it("a level action with no level proposes nothing", async () => {
    const k = kitchen();
    const result = await respond([op({ action: "level", evidence: "rice", item: "i1" })]).interpret(requestFor(k, "rice"));
    expect(result.proposal?.operations ?? []).toEqual([]);
  });

  it("Low still blocks an unasked list add (SL3); plenty never counts as marked Out/Low", async () => {
    const k = kitchen();
    const low = await respond([
      op({ action: "use", evidence: "we're low on rice", item: "i2", stock: stockFact("low") }),
      op({ action: "list_add", evidence: "rice", name: nameFact("rice") }),
    ]).interpret(requestFor(k, "we're low on rice"));
    expect(low.proposal!.operations.map((o) => o.type)).toEqual(["item.use"]);
    const plenty = await respond([
      op({ action: "level", evidence: "plenty of rice", item: "i2", stock: stockFact("plenty") }),
      op({ action: "list_add", evidence: "eggs", name: nameFact("eggs") }),
    ]).interpret(requestFor(k, "plenty of rice, need eggs"));
    expect(plenty.proposal!.operations.map((o) => o.type)).toEqual(["item.stock.set", "shopping.add"]);
  });

  it("the kitchen context shows Plenty / Some / Low, and the prompt teaches levels without a list offer", () => {
    const k = kitchen();
    k.tap([{ type: "item.stock.set", target: { itemId: k.item("rice")!.id }, fields: level("plenty") }]);
    k.tap([{ type: "item.stock.set", target: { itemId: k.item("eggs")!.id }, fields: level("some") }]);
    const text = renderKitchen(k.state(), NOW);
    expect(text).toMatch(/i2: rice · pantry · Plenty/);
    expect(text).toMatch(/i1: eggs · fridge · Some/);
    expect(SYSTEM_PROMPT).toMatch(/- level — how much is left/);
    // SS10 (0054): the receipt button offers the list, so the reply never asks, and Plenty / Some never need it.
    expect(SYSTEM_PROMPT).toMatch(/don't offer it in your reply either/);
    expect(SYSTEM_PROMPT).toMatch(/Plenty or some never need it/);
    expect(SYSTEM_PROMPT).not.toMatch(/your reply may offer: "Want me to add fish sauce/);
  });
});

describe("the fake interpreter understands levels", () => {
  it.each([
    ["We have plenty of rice", "plenty", ["rice"]],
    ["we've got lots of eggs", "plenty", ["eggs"]],
    ["There's some milk left", "some", ["milk"]],
    ["we still have some fish sauce left.", "some", ["fish sauce"]],
  ] as const)("%s → %s", (text, lvl, names) => {
    const intent = matchIntent(text);
    expect(intent).toMatchObject({ kind: "level", level: lvl });
    expect("targets" in intent ? intent.targets.map((s) => s.name) : []).toEqual(names);
  });

  it("'we're low on eggs' is still Low, and 'we got some milk' is still a purchase", () => {
    expect(matchIntent("We're low on eggs").kind).toBe("low");
    expect(matchIntent("We got some milk").kind).toBe("bought");
  });

  it("proposes item.stock.set that the kitchen applies, with the right receipt", async () => {
    const k = kitchen();
    const fake = createFakeInterpreter();
    for (const [text, code, name, value] of [
      ["We have plenty of rice", "ITEM_PLENTY", "rice", "plenty"],
      ["There's some eggs left", "ITEM_SOME", "eggs", "some"],
    ] as const) {
      const result = await fake.interpret(requestFor(k, text));
      const plan = k.say(text, ProposedChange.parse(result.proposal).operations);
      expect(plan.rejected, text).toEqual([]);
      expect(plan.applied[0].summary.code, text).toBe(code);
      expect(row(k, name)!.stock?.value, text).toBe(value);
    }
  });
});
