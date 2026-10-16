/**
 * Kitchen infers where things go (0041), the AI half: the real interpreter with a mocked client
 * proposes the usual place on adds (inferred, medium), keeps a said or implied one, turns "onions go
 * in the pantry" into a remembered place, and its code guards stop the model from inventing a
 * "said" place or moving an item by itself. Every result passes the contract and is applied by the
 * real kitchen validator (MemoryKitchen). Also: the prompt and the fake interpreter.
 * People are fictional (Ana, Ben).
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { Location } from "@/contracts/common";
import { ProposedChange } from "@/contracts/proposed-change";
import type { Operation, OperationOf } from "@/contracts/operations";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { toWire, type ModelOp, type ModelOutput } from "@/ai/real/model-output";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/ai/real/prompt";
import { NOTHING_TO_CHANGE_REPLY, PLACE_WORDS } from "@/ai/real/to-proposal";
import { createFakeInterpreter } from "@/ai/fake";
import type { InterpretRequest } from "@/ai/interpreter";
import { NOW } from "@/ai/eval/fixtures";
import { MemoryKitchen, said } from "../support/memory-kitchen";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Loc = NonNullable<ModelOp["location"]>;

const usual = (value: Location): Loc => ({ value, basis: "inferred", confidence: "medium" });
const implied = (value: Location): Loc => ({ value, basis: "inferred", confidence: "high" });
const told = (value: Location): Loc => ({ value, basis: "said", confidence: "high" });
const name = (value: string) => ({ value, basis: "said" as const, confidence: "high" as const });

function op(partial: Partial<ModelOp> & Pick<ModelOp, "action" | "evidence">): ModelOp {
  return { item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, meal: null, ...partial };
}

function interpreterAnswering(operations: ModelOp[]) {
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
      } as unknown as Message;
    }),
  };
  return createRealInterpreter({ messages, now: () => NOW, log: () => {}, env: {} });
}

function kitchen(): MemoryKitchen {
  const k = new MemoryKitchen();
  k.members = new Map([
    ["ana", "Ana"],
    ["ben", "Ben"],
  ]);
  return k;
}

function requestFor(k: MemoryKitchen, text: string): InterpretRequest {
  const state = k.state();
  return { kitchenId: state.kitchenId, userId: "ana", message: { id: "msg-1", text }, state, version: state.version, history: [] };
}

async function interpretAndApply(k: MemoryKitchen, text: string, ops: ModelOp[]) {
  const result = await interpreterAnswering(ops).interpret(requestFor(k, text));
  expect(result.kind, text).toBe("change");
  const operations: Operation[] = ProposedChange.parse(result.proposal).operations;
  const plan = k.say(text, operations, { actor: "ana" });
  expect(plan.rejected, text).toEqual([]);
  return { operations, plan };
}

const placeOf = (k: MemoryKitchen, n: string) => k.state().items.find((i) => i.name.value === n)?.location;
const adds = (ops: Operation[]) => ops.filter((o): o is OperationOf<"item.add"> => o.type === "item.add");

describe("adds get the usual place (0041)", () => {
  it("a grocery haul with no places said: each goes where it usually goes, as inferred", async () => {
    const k = kitchen();
    const text = "Got milk, nước mắm, a bunch of rau răm, frozen peas and bananas";
    const { operations } = await interpretAndApply(k, text, [
      op({ action: "add", evidence: "milk", name: name("milk"), location: usual("fridge") }),
      op({ action: "add", evidence: "nước mắm", name: name("nước mắm (fish sauce)"), location: usual("pantry") }),
      op({ action: "add", evidence: "a bunch of rau răm", name: name("rau răm (Vietnamese coriander)"), location: usual("fridge") }),
      op({ action: "add", evidence: "frozen peas", name: name("frozen peas"), location: implied("freezer") }),
      op({ action: "add", evidence: "bananas", name: name("bananas") }), // the model left it: the code places it
    ]);
    expect(adds(operations).map((o) => o.fields.location)).toEqual([usual("fridge"), usual("pantry"), usual("fridge"), implied("freezer"), undefined]);
    expect(placeOf(k, "milk")).toEqual(usual("fridge"));
    expect(placeOf(k, "nước mắm (fish sauce)")).toEqual(usual("pantry"));
    expect(placeOf(k, "frozen peas")).toEqual(implied("freezer")); // "frozen" is a place word
    expect(placeOf(k, "bananas")).toEqual(usual("counter")); // the code's guess (0057 KOS3-a)
    expect(k.kitchen.locationPrefs).toEqual({}); // guesses are never remembered
  });

  it("when the model gives no place, the code's guess still places it (type → place)", async () => {
    const k = kitchen();
    await interpretAndApply(k, "bought jasmine rice and eggs", [
      op({ action: "add", evidence: "jasmine rice", name: name("jasmine rice") }),
      op({ action: "add", evidence: "eggs", name: name("eggs") }),
    ]);
    expect(placeOf(k, "jasmine rice")).toEqual(usual("pantry"));
    expect(placeOf(k, "eggs")).toEqual(usual("fridge"));
  });

  it("a said place wins and is remembered", async () => {
    const k = kitchen();
    const text = "bought milk, it's in the freezer";
    const { operations } = await interpretAndApply(k, text, [op({ action: "add", evidence: text, name: name("milk"), location: told("freezer") })]);
    expect(adds(operations)[0].fields.location).toEqual(told("freezer"));
    expect(placeOf(k, "milk")).toEqual(told("freezer"));
    expect(k.kitchen.locationPrefs["milk"]?.location).toBe("freezer");
  });

  it("guard: a 'said' or 'high' place with no place words in the message is the model's guess (medium), never remembered", async () => {
    // Regression guard: the model claiming "said" for "I bought rice" would teach the kitchen a
    // place nobody chose, and a "high" guess would beat the household's remembered place.
    const k = kitchen();
    const { operations } = await interpretAndApply(k, "I bought rice and milk", [
      op({ action: "add", evidence: "rice", name: name("rice"), location: told("pantry") }),
      op({ action: "add", evidence: "milk", name: name("milk"), location: implied("fridge") }),
    ]);
    expect(adds(operations).map((o) => o.fields.location)).toEqual([usual("pantry"), usual("fridge")]);
    expect(k.kitchen.locationPrefs).toEqual({});
  });

  it("a remembered place beats the model's usual-place guess (the backend applies it)", async () => {
    const k = kitchen();
    k.say("onions go in the fridge", [{ type: "item.update", target: { name: "onions" }, fields: { location: said("fridge") } }], { actor: "ben" });
    await interpretAndApply(k, "bought onions", [op({ action: "add", evidence: "bought onions", name: name("onions"), location: usual("pantry") })]);
    expect(placeOf(k, "onions")).toEqual({ value: "fridge", basis: "inferred", confidence: "high" });
  });
});

describe("corrections and habits are remembered (0041)", () => {
  it("'onions go in the pantry' with no onions: remembered, not added; the next add goes there", async () => {
    const k = kitchen();
    const text = "onions go in the pantry";
    const { plan } = await interpretAndApply(k, text, [op({ action: "update", evidence: text, item: "", name: name("onions"), location: told("pantry") })]);
    expect(plan.applied.map((a) => a.summary.code)).toEqual(["PLACE_REMEMBERED"]);
    expect(k.state().items).toEqual([]);
    await interpretAndApply(k, "bought onions", [op({ action: "add", evidence: "bought onions", name: name("onions"), location: usual("fridge") })]);
    expect(placeOf(k, "onions")?.value).toBe("pantry");
  });

  it("moving an item ('put the milk in the freezer') moves it and is remembered", async () => {
    const k = kitchen();
    k.say("bought milk", [{ type: "item.add", fields: { name: said("milk") } }], { actor: "ana" });
    const text = "put the milk in the freezer";
    const { plan } = await interpretAndApply(k, text, [op({ action: "update", evidence: text, item: "i1", location: told("freezer") })]);
    expect(plan.applied.map((a) => a.summary.code)).toEqual(["ITEM_MOVED"]);
    expect(placeOf(k, "milk")).toEqual(told("freezer"));
    expect(k.kitchen.locationPrefs["milk"]?.location).toBe("freezer");
  });

  it("'I froze the beef' moves it (implied) but isn't remembered as a habit", async () => {
    const k = kitchen();
    k.say("bought beef", [{ type: "item.add", fields: { name: said("beef") } }], { actor: "ana" });
    await interpretAndApply(k, "I froze the beef", [op({ action: "update", evidence: "I froze the beef", item: "i1", location: implied("freezer"), frozen: { value: true, basis: "said", confidence: "high" } })]);
    expect(placeOf(k, "beef")).toEqual(implied("freezer"));
    expect(k.kitchen.locationPrefs).toEqual({});
  });

  it("guard: an update that moves an item with no place words is dropped (the model never moves things by itself)", async () => {
    const k = kitchen();
    k.say("bought milk", [{ type: "item.add", fields: { name: said("milk") } }], { actor: "ana" });
    const result = await interpreterAnswering([op({ action: "update", evidence: "the milk", item: "i1", location: usual("pantry") })]).interpret(requestFor(k, "the milk"));
    expect(result.proposal).toBeNull();
    expect(result.reply).toBe(NOTHING_TO_CHANGE_REPLY);
  });

  it("place words: English and Vietnamese, and not 'leftovers'", () => {
    for (const t of ["in the fridge", "put it in the Freezer", "pantry", "I froze it", "freezing", "thawed", "để trong tủ lạnh"]) expect(PLACE_WORDS.test(t), t).toBe(true);
    for (const t of ["I bought rice", "I made pho", "leftovers", "the milk"]) expect(PLACE_WORDS.test(t), t).toBe(false);
  });
});

describe("the prompt (interpret-2026-10-16.6)", () => {
  it("asks for the usual place on adds instead of leaving it unknown", () => {
    expect(PROMPT_VERSION).toBe("interpret-2026-10-16.6");
    expect(SYSTEM_PROMPT).toContain("# Places (location)");
    expect(SYSTEM_PROMPT).not.toContain("Don't guess where groceries go");
    expect(SYSTEM_PROMPT).toContain('"onions go in the pantry"');
  });
});

describe("Counter (0030; 0057 KOS3-a): counter food is guessed there, a said place wins", () => {
  it("the prompt names Counter as a place and asks for it on counter food", () => {
    expect(SYSTEM_PROMPT).toContain("Places are fridge, freezer, pantry and counter.");
    expect(SYSTEM_PROMPT).toContain("- Counter: fruit that ripens at room temperature");
    expect(SYSTEM_PROMPT).not.toContain("never guess counter");
  });

  it("'the bananas are on the counter' keeps the said Counter", async () => {
    const k = kitchen();
    const text = "I bought bananas, they're on the counter";
    await interpretAndApply(k, text, [op({ action: "add", name: name("bananas"), location: told("counter"), evidence: text })]);
    expect(placeOf(k, "bananas")).toEqual(told("counter"));
  });

  it("the model's usual-place Counter is kept, as inferred", async () => {
    const k = kitchen();
    const text = "I bought avocados";
    await interpretAndApply(k, text, [op({ action: "add", name: name("avocados"), location: usual("counter"), evidence: text })]);
    expect(placeOf(k, "avocados")).toEqual(usual("counter"));
    expect(k.kitchen.locationPrefs).toEqual({});
  });

  it("bananas said to be in the fridge stay in the fridge", async () => {
    const k = kitchen();
    const text = "I bought bananas, they're in the fridge";
    await interpretAndApply(k, text, [op({ action: "add", name: name("bananas"), location: told("fridge"), evidence: text })]);
    expect(placeOf(k, "bananas")).toEqual(told("fridge"));
  });
});

describe("the fake interpreter (0041)", () => {
  const fake = createFakeInterpreter();

  it("'onions go in the pantry' is a said place, remembered", async () => {
    const k = kitchen();
    const r = await fake.interpret(requestFor(k, "onions go in the pantry"));
    expect(r.reply).toBe("Done: I'll put the onions in the pantry from now on.");
    const plan = k.say("onions go in the pantry", ProposedChange.parse(r.proposal).operations, { actor: "ana" });
    expect(plan.applied.map((a) => a.summary.code)).toEqual(["PLACE_REMEMBERED"]);
  });

  it("'I bought bananas' lands on the Counter; 'tomatoes go on the counter' is a said place (0057 KOS3-a)", async () => {
    const k = kitchen();
    const bought = await fake.interpret(requestFor(k, "I bought bananas"));
    k.say("I bought bananas", ProposedChange.parse(bought.proposal).operations, { actor: "ana" });
    expect(placeOf(k, "bananas")).toEqual(usual("counter"));
    const habit = await fake.interpret(requestFor(k, "tomatoes go on the counter"));
    const plan = k.say("tomatoes go on the counter", ProposedChange.parse(habit.proposal).operations, { actor: "ana" });
    expect(plan.applied.map((a) => a.summary.code)).toEqual(["PLACE_REMEMBERED"]);
    expect(k.kitchen.locationPrefs["tomato"]).toMatchObject({ location: "counter" });
  });

  it("'I froze the chicken' is implied (high), not remembered; adds get their place from the backend", async () => {
    const k = kitchen();
    const bought = await fake.interpret(requestFor(k, "I bought chicken thighs"));
    k.say("I bought chicken thighs", ProposedChange.parse(bought.proposal).operations, { actor: "ana" });
    expect(placeOf(k, "chicken thighs")).toEqual(usual("fridge"));
    const froze = await fake.interpret(requestFor(k, "I froze the chicken"));
    k.say("I froze the chicken", ProposedChange.parse(froze.proposal).operations, { actor: "ana" });
    expect(placeOf(k, "chicken thighs")).toEqual(implied("freezer"));
    expect(k.kitchen.locationPrefs).toEqual({});
  });
});
