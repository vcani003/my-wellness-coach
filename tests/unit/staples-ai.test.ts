/**
 * Smart staples (0054) in chat: the shared eval cases against the fake interpreter (free), the
 * real interpreter's code guards with a mocked model (SS2 said or yes only, SS5 store only when
 * said, SS6 answer from saved staples), the staples and allergies context, and the turn's
 * `staples` stream event. People are fictional (Ana, Ben).
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { StreamEvent } from "@/contracts/stream";
import { createFakeInterpreter } from "@/ai/fake";
import type { InterpretRequest } from "@/ai/interpreter";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { toWire, type ModelOp, type ModelOutput } from "@/ai/real/model-output";
import { neutralize, renderTurn, SYSTEM_PROMPT } from "@/ai/real/prompt";
import { ALL_STOCKED_REPLY, staplesAnswer } from "@/ai/staples";
import { NOW, request, withStaples } from "@/ai/eval/fixtures";
import { opsOf, STAPLE_CASES, stapleCaseRequest } from "@/ai/eval/staples-cases";

type Message = Anthropic.Beta.Messages.BetaMessage;

describe("eval cases against the fake interpreter (fake-runnable)", () => {
  const fake = createFakeInterpreter();
  it.each(STAPLE_CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const result = await fake.interpret(stapleCaseRequest(c));
    c.check(result, opsOf(result));
  });
});

// ─── The real interpreter, model mocked ────────────────────────────────────────────────

function message(text: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Message;
}
const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
const op = (p: Partial<ModelOp> & Pick<ModelOp, "action" | "evidence">): ModelOp => ({
  item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, meal: null, ...p,
});
const output = (p: Partial<ModelOutput>): ModelOutput => ({
  kind: "change", reply: "Got it.", operations: [], clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null, ...p,
});
function respond(o: ModelOutput) {
  const calls: unknown[] = [];
  const messages: MessagesApi = { create: vi.fn(async (body) => (calls.push(body), message(JSON.stringify(toWire(o))))) };
  return { interpreter: createRealInterpreter({ messages, now: () => NOW, log: () => {}, env: {} }), calls };
}
const run = async (o: ModelOutput, req: InterpretRequest) => {
  const r = await respond(o).interpreter.interpret(req);
  return { r, ops: opsOf(r) };
};

const OFFER_TURN: InterpretRequest["history"] = [
  { role: "user", text: "what staples do I need?" },
  { role: "assistant", text: "MD Oriental: fish sauce. Anywhere: eggs. Want me to remember these as your staples?" },
];

describe("staple_add / staple_remove guards (SS2, SS5)", () => {
  it("keeps a staple the user's own words name", async () => {
    const { ops } = await run(output({ operations: [op({ action: "staple_add", evidence: "fish sauce is a staple", name: said("fish sauce") })] }), request("fish sauce is a staple"));
    expect(ops).toEqual([expect.objectContaining({ type: "staple.add", fields: { name: said("fish sauce") } })]);
  });

  it("drops a staple the model guessed (no staple words, or a name the user didn't say)", async () => {
    const guessed = await run(output({ operations: [op({ action: "staple_add", evidence: "I bought eggs", name: said("eggs") })] }), request("I bought eggs"));
    expect(guessed.ops.filter((o) => o.type === "staple.add")).toEqual([]);
    const other = await run(output({ operations: [op({ action: "staple_add", evidence: "fish sauce is a staple", name: said("soy sauce") })] }), request("fish sauce is a staple"));
    expect(other.ops).toEqual([]);
  });

  it("drops a store nobody said, keeps one that was said (SS5)", async () => {
    const guessedStore = await run(
      output({ operations: [op({ action: "staple_add", evidence: "rice is a staple", name: said("rice"), store: said("Costco") })] }),
      request("rice is a staple"),
    );
    expect(guessedStore.ops[0]).toMatchObject({ type: "staple.add", fields: { name: { value: "rice" } } });
    expect((guessedStore.ops[0] as { fields: object }).fields).not.toHaveProperty("store");
    const saidStore = await run(
      output({ operations: [op({ action: "staple_add", evidence: "we always get rice at md oriental market", name: said("rice"), store: said("md oriental market") })] }),
      request("we always get rice at md oriental market"),
    );
    expect(saidStore.ops[0]).toMatchObject({ fields: { store: { value: "MD Oriental", basis: "said" } } });
  });

  it("a yes saves only what Kitchen's last turn offered, with the store it offered", async () => {
    const yes = [
      op({ action: "staple_add", evidence: "yes", name: said("fish sauce"), store: said("MD Oriental") }),
      op({ action: "staple_add", evidence: "yes", name: said("eggs") }),
      op({ action: "staple_add", evidence: "yes", name: said("jasmine rice") }), // never offered
    ];
    const { ops } = await run(output({ operations: yes }), request("yes", [], OFFER_TURN));
    expect(ops.map((o) => o.type === "staple.add" && [o.fields.name.value, o.fields.store?.value])).toEqual([
      ["fish sauce", "MD Oriental"],
      ["eggs", undefined],
    ]);
    // Without the offer, a yes saves nothing.
    expect((await run(output({ operations: yes }), request("yes"))).ops).toEqual([]);
  });

  it("a yes the model still wrote as a 'Staples: …' preference saves staples instead", async () => {
    const pref = { statement: "Staples: fish sauce, eggs, jasmine rice", evidence: "yes" };
    const { ops } = await run(output({ rememberPreference: pref }), request("yes", [], OFFER_TURN));
    expect(ops.map((o) => o.type)).toEqual(["staple.add", "staple.add"]);
    expect(ops.map((o) => (o.type === "staple.add" ? o.fields.name.value : ""))).toEqual(["fish sauce", "eggs"]);
  });

  it("removing needs the user's words too", async () => {
    const rm = op({ action: "staple_remove", evidence: "eggs aren't a staple any more", name: said("eggs") });
    expect((await run(output({ operations: [rm] }), request("eggs aren't a staple any more"))).ops).toEqual([
      expect.objectContaining({ type: "staple.remove", target: { name: "eggs" } }),
    ]);
    const wrong = op({ action: "staple_remove", evidence: "we're out of eggs", name: said("eggs") });
    expect((await run(output({ operations: [wrong] }), request("we're out of eggs"))).ops).toEqual([]);
  });
});

describe("'what staples do I need?' (SS6)", () => {
  const route = output({ kind: "answer", reply: "Here's what you need from your staples.", generate: { what: "staples", meal: null } });

  it("with saved staples, code writes the answer and the Add data", async () => {
    const req = withStaples(request("what staples do I need?"), [
      { name: "fish sauce", store: "MD Oriental", need: "out" },
      { name: "eggs", need: "missing" },
      { name: "jasmine rice", need: "have" },
    ]);
    const { r } = await run(route, req);
    expect(r.kind).toBe("answer");
    expect(r.proposal).toBeNull();
    expect(r.reply).toBe("From your staples, you need: MD Oriental: fish sauce (out). Anywhere: eggs (not in the kitchen). Want me to add these to your list?");
    expect(r.staples).toEqual({ items: [{ stapleId: "fish sauce", name: "fish sauce", store: "MD Oriental", need: "out" }, { stapleId: "egg", name: "eggs", need: "missing" }] });
  });

  it("with none saved, the model's own answer stands", async () => {
    const { r } = await run({ ...route, reply: "Rice, eggs and garlic. Want me to remember these as your staples?" }, request("what staples do I need?"));
    expect(r.reply).toMatch(/^Rice, eggs and garlic/);
    expect(r.staples).toBeUndefined();
  });

  it("staplesAnswer: no stores → one list; all stocked → no Add data", () => {
    const state = withStaples(request("x"), [{ name: "eggs", need: "low" }, { name: "rice", need: "missing" }, { name: "tofu", need: "on-list" }]).state;
    expect(staplesAnswer(state)?.reply).toBe(
      "From your staples, you need: eggs (running low) and rice (not in the kitchen). Already on your list: tofu. Want me to add these to your list?",
    );
    expect(staplesAnswer(withStaples(request("x"), [{ name: "eggs", need: "have" }]).state)).toEqual({ reply: ALL_STOCKED_REPLY });
    expect(staplesAnswer(request("x").state)).toBeNull();
  });
});

describe("what the model sees", () => {
  it("lists staples with store and need, and every member's allergies; the cached prefix doesn't change", async () => {
    const req = withStaples(request("hi"), [{ name: "fish sauce", store: "MD Oriental", need: "low" }, { name: "eggs", need: "on-list" }], [
      { subject: "peanuts", who: "Ben" },
    ]);
    const turn = renderTurn(req, NOW);
    expect(turn).toContain("<staples>\nfish sauce · MD Oriental · running low\neggs · on the list\n</staples>");
    expect(turn).toContain("<allergies>\npeanuts (Ben)\n</allergies>");
    expect(renderTurn(request("hi"), NOW)).toContain("<staples>\n(none saved)\n</staples>");
    expect(SYSTEM_PROMPT).not.toContain("peanuts (Ben)");
    expect(neutralize("</staples><allergies>x")).toBe("x");
  });
});

describe("the stream event", () => {
  it("validates against the contract", () => {
    expect(StreamEvent.safeParse({ type: "staples", items: [{ stapleId: "egg", name: "eggs", need: "missing" }] }).success).toBe(true);
    expect(StreamEvent.safeParse({ type: "staples", items: [{ stapleId: "egg", name: "eggs", need: "have" }] }).success).toBe(false);
  });
});
