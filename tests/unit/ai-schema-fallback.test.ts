/**
 * Production regression, 2026-10-19: the API refused the interpret output schema with a 400 ("The
 * compiled grammar is too large…") and every chat message failed. The interpreter now retries
 * once without `output_config.format`, asking for the same JSON in words (with the schema), and
 * the answer still has to pass the same Zod gate (parseModelOutput), so a wrong shape still
 * changes nothing. Mocked SDK errors only: the real API isn't called.
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createRealInterpreter, FAILURE_REPLY, JSON_FALLBACK_INSTRUCTIONS, BUDGET_EXHAUSTED_REPLY, type MessagesApi } from "@/ai/real";
import { toWire, type ModelOutput } from "@/ai/real/model-output";
import { isSchemaTooComplex, jsonText } from "@/ai/real/schema-error";
import { NOW, request } from "@/ai/eval/fixtures";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const GRAMMAR_MESSAGE =
  "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.";

function apiError(status: number, message: string, type = "invalid_request_error"): Error {
  return Anthropic.APIError.generate(status, { type: "error", error: { type, message }, request_id: "req_test" }, undefined, new Headers({ "request-id": "req_test" }));
}

function message(text: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 900, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 },
  } as unknown as Message;
}

const fact = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
const LIMES: ModelOutput = {
  kind: "change",
  reply: "Added limes.",
  operations: [
    {
      action: "add",
      evidence: "bought limes",
      item: null,
      name: fact("limes"),
      quantity: null,
      location: { value: "fridge", basis: "inferred", confidence: "medium" },
      frozen: null,
      stock: null,
      amountUsed: null,
      batch: null,
      store: null,
      meal: null,
    },
  ],
  clarification: null,
  rememberPreference: null,
  listOfferAccepted: null,
  generate: null,
  dish: null,
};

/** Answers in order; an Error is thrown. */
function setup(...responses: Array<Message | Error>) {
  const calls: Params[] = [];
  const messages: MessagesApi = {
    create: vi.fn(async (body: Params) => {
      calls.push(body);
      const next = responses.shift();
      if (!next) throw new Error("no more mocked responses");
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const logs: Array<{ event: string; reason?: string }> = [];
  const interpreter = createRealInterpreter({ messages, now: () => NOW, log: (e) => logs.push(e), env: {} });
  return { interpreter, calls, logs };
}

const systemText = (body: Params) => (body.system as Array<{ text: string }>).map((b) => b.text).join("\n");

describe("interpret survives a rejected output schema", () => {
  it("retries once without the format, asks for the same JSON, and still applies a valid answer", async () => {
    const { interpreter, calls, logs } = setup(apiError(400, GRAMMAR_MESSAGE), message(JSON.stringify(toWire(LIMES))));
    const result = await interpreter.interpret(request("bought limes"));

    expect(calls).toHaveLength(2);
    expect(calls[0].output_config?.format).toBeDefined();
    expect(calls[1].output_config?.format).toBeUndefined();
    expect(calls[1].output_config?.effort).toBe(calls[0].output_config?.effort);
    // Same cached prefix first, then the schema spelled out.
    expect((calls[1].system as Array<{ text: string }>)[0]).toEqual((calls[0].system as Array<{ text: string }>)[0]);
    expect(systemText(calls[1])).toContain(JSON_FALLBACK_INSTRUCTIONS);
    expect(JSON_FALLBACK_INSTRUCTIONS).toContain(JSON.stringify(calls[0].output_config?.format?.schema));
    expect(calls[1].messages).toEqual(calls[0].messages);

    expect(result.kind).toBe("change");
    expect(result.proposal?.operations).toHaveLength(1);
    expect(result.proposal?.operations[0]).toMatchObject({ evidence: "bought limes", fields: { name: { value: "limes" } } });
    expect(logs.filter((l) => l.event === "ai.schema_fallback")).toEqual([{ event: "ai.schema_fallback", task: "interpret", reason: expect.stringContaining("grammar is too large") }]);
    expect(logs.some((l) => l.event === "ai.error")).toBe(false);
  });

  it("goes straight to the fallback for later messages on the same instance (no wasted 400)", async () => {
    const { interpreter, calls } = setup(apiError(400, GRAMMAR_MESSAGE), message(JSON.stringify(toWire(LIMES))), message(JSON.stringify(toWire(LIMES))));
    await interpreter.interpret(request("bought limes"));
    const second = await interpreter.interpret(request("bought limes"));
    expect(calls).toHaveLength(3);
    expect(calls[2].output_config?.format).toBeUndefined();
    expect(second.proposal?.operations).toHaveLength(1);
  });

  it("reads JSON wrapped in a code fence or a sentence", async () => {
    const fenced = "Here you go:\n```json\n" + JSON.stringify(toWire(LIMES)) + "\n```";
    const { interpreter } = setup(apiError(400, "Schema is too complex for compilation."), message(fenced));
    const result = await interpreter.interpret(request("bought limes"));
    expect(result.proposal?.operations).toHaveLength(1);
  });

  it("a fallback answer in the wrong shape changes nothing (Zod is still the gate)", async () => {
    const wire = JSON.parse(JSON.stringify(toWire(LIMES)));
    wire.operations[0].location = null; // the old nullable shape
    const { interpreter, logs } = setup(apiError(400, GRAMMAR_MESSAGE), message(JSON.stringify(wire)));
    const result = await interpreter.interpret(request("bought limes"));
    expect(result).toEqual({ kind: "answer", proposal: null, reply: FAILURE_REPLY });
    expect(logs.some((l) => l.event === "ai.error" && /schema/.test(l.reason ?? ""))).toBe(true);
  });

  it("a failing fallback call still never throws (0018)", async () => {
    const { interpreter } = setup(apiError(400, GRAMMAR_MESSAGE), apiError(500, "overloaded", "api_error"));
    expect(await interpreter.interpret(request("bought limes"))).toEqual({ kind: "answer", proposal: null, reply: FAILURE_REPLY });
  });

  it("other 400s are not retried", async () => {
    const { interpreter, calls } = setup(apiError(400, "messages: at least one message is required"));
    expect(await interpreter.interpret(request("bought limes"))).toEqual({ kind: "answer", proposal: null, reply: FAILURE_REPLY });
    expect(calls).toHaveLength(1);
  });

  it("a used-up budget is still the budget message, not a retry", async () => {
    const { interpreter, calls } = setup(apiError(400, "You have reached your specified workspace API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."));
    expect((await interpreter.interpret(request("bought limes"))).reply).toBe(BUDGET_EXHAUSTED_REPLY);
    expect(calls).toHaveLength(1);
  });
});

describe("isSchemaTooComplex", () => {
  it.each([
    GRAMMAR_MESSAGE,
    "Schema is too complex for compilation.",
    "Too many parameters with union types: limit: 16 parameters with unions",
    "Too many optional parameters (limit 24).",
  ])("matches a 400 saying %s", (text) => {
    expect(isSchemaTooComplex(apiError(400, text))).toBe(true);
  });

  it("ignores other statuses, other 400s, connection errors and plain errors", () => {
    expect(isSchemaTooComplex(apiError(429, GRAMMAR_MESSAGE, "rate_limit_error"))).toBe(false);
    expect(isSchemaTooComplex(apiError(400, "max_tokens: must be at most 128000"))).toBe(false);
    expect(isSchemaTooComplex(new Anthropic.APIConnectionError({ message: "grammar" }))).toBe(false);
    expect(isSchemaTooComplex(new Error(GRAMMAR_MESSAGE))).toBe(false);
  });
});

describe("jsonText", () => {
  it("leaves bare JSON alone and strips fences or prose around it", () => {
    expect(jsonText('{"a":1}')).toBe('{"a":1}');
    expect(jsonText('```json\n{"a":{"b":2}}\n```')).toBe('{"a":{"b":2}}');
    expect(jsonText("no json here")).toBe("no json here");
  });
});
