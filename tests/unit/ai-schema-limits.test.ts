/**
 * Guard for the structured-outputs complexity limits (ai.md §1). Production regression,
 * 2026-10-14: the interpret schema reached 21 parameters with union types and every chat
 * message was rejected with a 400 ("limit: 16 parameters with unions"). Mocked tests never hit
 * the real validator, so this test captures the exact request body each task sends and counts
 * by the API's rules (claude-api skill → structured-outputs docs, "Schema complexity limits"):
 *  - parameters with union types: any schema node using `anyOf` (or `oneOf`) or a type array
 *    such as ["string", "null"]. Limit 16 across all strict schemas in one request.
 *  - optional parameters: any property not listed in its object's `required`. Limit 24.
 * We fail earlier than the API (unions > 14, optionals > 20) to keep headroom for growth.
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { ApplyResult } from "@/contracts/apply-result";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { createRealMealAI, type StreamingMessagesApi } from "@/ai/real/meals";
import { fromWire, parseModelOutput, toWire, type ModelOutput } from "@/ai/real/model-output";
import { ideasInput, LEVI_SEAFOOD, mealContext, NOW, request, SHRIMP_KITCHEN } from "@/ai/eval/fixtures";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Body = Record<string, unknown>;

const UNION_HEADROOM = 14;
const OPTIONAL_HEADROOM = 20;

const blank = { content: [{ type: "text", text: "{}", citations: null }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
const msg = blank as unknown as Message;

/** Counts parameters that use anyOf / oneOf / a type array, anywhere in the schema. */
export function countUnions(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + countUnions(x), 0);
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  const self = Array.isArray(o.type) || Array.isArray(o.anyOf) || Array.isArray(o.oneOf) ? 1 : 0;
  return self + Object.values(o).reduce((n: number, v) => n + countUnions(v), 0);
}

/** Counts properties not listed in their object's `required`, anywhere in the schema. */
export function countOptionals(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + countOptionals(x), 0);
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  let self = 0;
  if (o.properties && typeof o.properties === "object") {
    const required = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
    self = Object.keys(o.properties).filter((k) => !required.has(k)).length;
  }
  return self + Object.values(o).reduce((n: number, v) => n + countOptionals(v), 0);
}

/** Every strict schema in one request body: the output format plus any strict tools. */
function strictSchemas(body: Body): unknown[] {
  const format = (body.output_config as { format?: { schema?: unknown } } | undefined)?.format?.schema;
  const tools = ((body.tools as Array<{ strict?: boolean; input_schema?: unknown }> | undefined) ?? []).filter((t) => t.strict);
  return [...(format ? [format] : []), ...tools.map((t) => t.input_schema)];
}

/** Runs every AI task against capturing clients and returns the request bodies, by task. */
async function bodiesByTask(): Promise<Record<string, Body>> {
  const out: Record<string, Body> = {};
  let task = "";
  const messages: MessagesApi = { create: vi.fn(async (body) => ((out[task] = body as unknown as Body), msg)) };
  const streaming: StreamingMessagesApi = {
    stream: vi.fn((body) => {
      // The first call per task (a refinement that can't be read falls back to a second call).
      out[task] ??= body as unknown as Body;
      return { async *textDeltas() {}, finalMessage: async () => msg };
    }),
  };
  const interpreter = createRealInterpreter({ messages, now: () => NOW, log: () => {}, env: {} });
  const meals = createRealMealAI({ messages: streaming, now: () => NOW, log: () => {}, env: {} });
  const recipe = {
    ...mealContext(SHRIMP_KITCHEN, { restrictions: [LEVI_SEAFOOD] }),
    meal: { mealId: "meal-1", title: "Spinach omelette", idea: { name: "Spinach omelette", why: "Quick", uses: [], missing: [] } },
  };
  const applied = {
    changeSetId: "cs1",
    newVersion: 4,
    undoable: true,
    applied: [],
    rejected: [{ opId: "b", reason: { code: "ALREADY_OUT", params: {}, text: "Eggs were already out" } }],
    state: request("x").state,
  } satisfies ApplyResult;

  task = "interpret";
  await interpreter.interpret(request("bought limes"));
  task = "reword";
  await interpreter.reword!(request("bought limes"), { kind: "change", proposal: null, reply: "Done." }, applied);
  task = "ideas";
  await meals.generateMealIdeas(ideasInput(SHRIMP_KITCHEN, null));
  task = "recipe";
  await meals.generateRecipe(recipe);
  task = "recipe-refine";
  await meals.generateRecipe({
    ...recipe,
    refine: { messageId: "m", text: "no garlic", current: { title: "Spinach omelette", ingredients: [], steps: ["Cook."], servings: "2" } },
  });
  task = "recipe-paste";
  await meals.readPastedRecipe({ ...recipe, messageId: "m", text: "Omelette: 2 eggs. Whisk and cook." });
  task = "idea-refine";
  await meals.refineIdea({
    ...recipe,
    idea: { ideaId: "idea-1", name: "Spinach omelette", why: "Quick", uses: [], missing: [] },
    request: { messageId: "m", text: "no spinach" },
  });
  return out;
}

describe("structured-output schema limits (every task, the exact body sent)", () => {
  it("counts a nullable field and a type array as unions, and missing `required` as optional", () => {
    expect(countUnions({ type: "object", properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] }, b: { type: ["string", "null"] } } })).toBe(2);
    expect(countOptionals({ type: "object", properties: { a: {}, b: {} }, required: ["a"] })).toBe(1);
  });

  it("calls every task", async () => {
    expect(Object.keys(await bodiesByTask()).sort()).toEqual(["idea-refine", "ideas", "interpret", "recipe", "recipe-paste", "recipe-refine", "reword"]);
  });

  it.each(["interpret", "reword", "ideas", "idea-refine", "recipe", "recipe-refine", "recipe-paste"])("%s stays well under the union and optional limits", async (task) => {
    const schemas = strictSchemas((await bodiesByTask())[task]);
    const unions = schemas.reduce((n: number, s) => n + countUnions(s), 0);
    const optionals = schemas.reduce((n: number, s) => n + countOptionals(s), 0);
    expect(unions, `${task}: ${unions} parameters with union types (API limit 16)`).toBeLessThanOrEqual(UNION_HEADROOM);
    expect(optionals, `${task}: ${optionals} optional parameters (API limit 24)`).toBeLessThanOrEqual(OPTIONAL_HEADROOM);
  });

  it("interpret sends a strict output format (the schema the guard counts is really used)", async () => {
    expect(strictSchemas((await bodiesByTask()).interpret)).toHaveLength(1);
  });
});

describe("wire shape ↔ ModelOutput (the mapping keeps behaviour unchanged)", () => {
  const fact = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
  const empty = { clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null };
  const op = { item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, meal: null };

  it("decodes the sentinels the prompt documents back to null", () => {
    const wire = {
      kind: "change",
      reply: "Got it.",
      operations: [
        {
          action: "add",
          evidence: "a bunch of rau răm",
          item: "",
          name: fact("rau răm"),
          quantity: { asSaid: "a bunch", amount: null, unit: "", basis: "said", confidence: "high" },
          location: null,
          frozen: null,
          stock: null,
          amountUsed: null,
          batch: "unspecified",
          store: null,
          meal: "",
          category: { value: "none", basis: "inferred", confidence: "low" },
          when: "",
        },
      ],
      clarification: { question: "", options: [] },
      rememberPreference: { statement: "", evidence: "" },
      listOfferAccepted: "none",
      generate: { what: "none", meal: "" },
      dish: { title: "", notes: "", evidence: "" },
    };
    const parsed = parseModelOutput(wire);
    expect(parsed.success && parsed.data).toEqual({
      kind: "change",
      reply: "Got it.",
      ...empty,
      operations: [
        {
          ...op,
          action: "add",
          evidence: "a bunch of rau răm",
          name: fact("rau răm"),
          quantity: { asSaid: "a bunch", amount: null, unit: null, basis: "said", confidence: "high" },
        },
      ],
    });
  });

  it("rejects the old nullable shape (the API now always sends every sentinel)", () => {
    expect(parseModelOutput({ kind: "answer", reply: "x", operations: [], ...empty }).success).toBe(false);
  });

  it.each<[string, ModelOutput]>([
    ["empty answer", { kind: "answer", reply: "Hi.", operations: [], ...empty }],
    [
      "every op field set",
      {
        kind: "change",
        reply: "Done.",
        ...empty,
        listOfferAccepted: "stock-offer",
        operations: [
          {
            action: "use",
            evidence: "used 3 of the new eggs",
            item: "i7",
            name: fact("eggs"),
            quantity: { asSaid: "2 lbs", amount: 2, unit: "lb", basis: "said", confidence: "high" },
            location: fact("fridge" as const),
            frozen: fact(false),
            stock: fact("low" as const),
            amountUsed: { asSaid: "3", amount: 3, unit: null, basis: "said", confidence: "high" },
            batch: "newest",
            store: fact("Publix"),
            meal: null,
          },
          {
            ...op,
            action: "add",
            evidence: "nước mắm",
            name: fact("nước mắm (fish sauce)"),
            category: { value: "sauces_condiments", basis: "inferred", confidence: "high" },
          },
          { ...op, action: "meal_plan", evidence: "plan that", meal: "last_chosen" },
        ],
      },
    ],
    ["clarify", { kind: "clarify", reply: "Which one?", operations: [], ...empty, clarification: { question: "Which chicken?", options: [{ label: "Thighs", reply: "the thighs" }] } }],
    ["remember", { kind: "change", reply: "Saved.", operations: [], ...empty, rememberPreference: { statement: "Staples: rice", evidence: "yes" } }],
    ["ideas", { kind: "answer", reply: "Let me look.", operations: [], ...empty, generate: { what: "ideas", meal: null } }],
    ["recipe change", { kind: "answer", reply: "Sure.", operations: [], ...empty, generate: { what: "recipe_change", meal: "m1" } }],
    ["dish without notes", { kind: "change", reply: "Curry it is.", operations: [], ...empty, dish: { title: "Chicken curry", notes: null, evidence: "a chicken curry" } }],
    ["dish with notes", { kind: "change", reply: "Curry it is.", operations: [], ...empty, dish: { title: "Chicken curry", notes: "with coconut milk", evidence: "a chicken curry" } }],
  ])("%s survives toWire → schema → fromWire unchanged", (_name, out) => {
    const parsed = parseModelOutput(JSON.parse(JSON.stringify(toWire(out))));
    expect(parsed.success && parsed.data).toEqual(out);
    expect(fromWire(toWire(out))).toEqual(out);
  });
});
