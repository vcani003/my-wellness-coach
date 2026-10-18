/**
 * The dated week plan in chat (0045 KOS1, KOS12): the shared eval cases against the fake (free),
 * and the real interpreter's code with a mocked model: relative days resolved by code from the
 * message's own day (never the model), "Which day?" for a vague one, the week answer, and the
 * week-needs routing. People are fictional.
 */
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createFakeInterpreter } from "@/ai/fake";
import { createRealInterpreter, type MessagesApi } from "@/ai/real";
import { toWire, type ModelOp, type ModelOutput, parseModelOutput } from "@/ai/real/model-output";
import { renderTurn, SYSTEM_PROMPT } from "@/ai/real/prompt";
import { NOW } from "@/ai/eval/fixtures";
import { opsOf, WEEK_PLAN_CASES, weekPlanCaseRequest, WEEK_TODAY } from "@/ai/eval/week-plan-cases";
import { weekNeedsAddedReply, weekNeedsAnswer, weekPlanAnswer } from "@/ai/week-plan";
import type { WeekNeeds } from "@/contracts/week-plan";
import type { ApplyResult } from "@/contracts/apply-result";

type Message = Anthropic.Beta.Messages.BetaMessage;

describe("eval cases against the fake interpreter (fake-runnable)", () => {
  const fake = createFakeInterpreter();
  it.each(WEEK_PLAN_CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const result = await fake.interpret(weekPlanCaseRequest(c));
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
const op = (p: Partial<ModelOp> & Pick<ModelOp, "action" | "evidence">): ModelOp => ({
  item: null, name: null, quantity: null, location: null, frozen: null, stock: null, amountUsed: null, batch: null, store: null, meal: null, ...p,
});
const output = (p: Partial<ModelOutput>): ModelOutput => ({
  kind: "change", reply: "Done.", operations: [], clarification: null, rememberPreference: null, listOfferAccepted: null, generate: null, dish: null, ...p,
});
function respond(o: ModelOutput) {
  const calls: Array<{ messages: Array<{ content: string }>; system: Array<{ text: string }> }> = [];
  const messages: MessagesApi = { create: vi.fn(async (body) => (calls.push(body as never), message(JSON.stringify(toWire(o))))) };
  return { interpreter: createRealInterpreter({ messages, now: () => NOW, log: () => {}, env: {} }), calls };
}
const base = (text: string, today = WEEK_TODAY) =>
  weekPlanCaseRequest({
    name: "",
    text,
    today,
    meals: [
      { id: "meal-curry", title: "Chicken curry", status: "chosen" },
      { id: "meal-pasta", title: "Pasta", status: "planned", plannedFor: "2026-10-15" },
    ],
    check: () => {},
  });

describe("relative days are resolved by code from the message's own day", () => {
  it("the model passes the words; code turns 'Tuesday' into a date", async () => {
    const o = output({ operations: [op({ action: "meal_plan", evidence: "plan the curry for Tuesday", meal: "m1", when: "Tuesday" })] });
    const r = await respond(o).interpreter.interpret(base("plan the curry for Tuesday"));
    expect(opsOf(r)).toEqual([expect.objectContaining({ type: "meal.plan", target: { mealId: "meal-curry" }, date: "2026-10-20" })]);
  });

  it("the same words a day later (the person's today) give the same Tuesday until it passes", async () => {
    const o = output({ operations: [op({ action: "meal_plan", evidence: "plan the curry for Tuesday", meal: "m1", when: "Tuesday" })] });
    const tue = await respond(o).interpreter.interpret(base("plan the curry for Tuesday", "2026-10-20"));
    expect(opsOf(tue)[0]).toMatchObject({ date: "2026-10-20" });
    const wed = await respond(o).interpreter.interpret(base("plan the curry for Tuesday", "2026-10-21"));
    expect(opsOf(wed)[0]).toMatchObject({ date: "2026-10-27" });
  });

  it("meal_date and meal_clear_date on a planned meal", async () => {
    const move = output({ operations: [op({ action: "meal_date", evidence: "move the pasta to Friday", meal: "m2", when: "Friday" })] });
    expect(opsOf(await respond(move).interpreter.interpret(base("move the pasta to Friday")))).toEqual([
      expect.objectContaining({ type: "meal.date", target: { mealId: "meal-pasta" }, date: "2026-10-16" }),
    ]);
    const clear = output({ operations: [op({ action: "meal_clear_date", evidence: "take the day off the pasta", meal: "m2" })] });
    expect(opsOf(await respond(clear).interpreter.interpret(base("take the day off the pasta")))).toEqual([
      expect.objectContaining({ type: "meal.date", target: { mealId: "meal-pasta" }, date: null }),
    ]);
  });

  it("a day code can't pin down → 'Which day?' with full one-tap replies; nothing planned", async () => {
    const o = output({ operations: [op({ action: "meal_date", evidence: "move the pasta to next week", meal: "m2", when: "next week" })] });
    const r = await respond(o).interpreter.interpret(base("move the pasta to next week"));
    expect(r.kind).toBe("clarify");
    expect(r.proposal?.operations).toEqual([]);
    expect(r.proposal?.clarification).toEqual({
      question: "Which day?",
      options: [
        { label: "Today", reply: "Move Pasta to today" },
        { label: "Tomorrow", reply: "Move Pasta to tomorrow" },
        { label: "Friday", reply: "Move Pasta to Friday" },
        { label: "Saturday", reply: "Move Pasta to Saturday" },
      ],
    });
  });

  it("meal_plan with no day stays undated (as before KOS1)", async () => {
    const o = output({ operations: [op({ action: "meal_plan", evidence: "add the curry to my plan", meal: "m1" })] });
    const [plan] = opsOf(await respond(o).interpreter.interpret(base("add the curry to my plan")));
    expect(plan).toMatchObject({ type: "meal.plan", target: { mealId: "meal-curry" } });
    expect(plan).not.toHaveProperty("date");
  });

  it("an idea card planned for a day: choose now, the dated plan follows in the same change set", async () => {
    const req = { ...base("plan the omelette for Friday"), ideas: [{ ideaId: "idea-1", name: "Spinach omelette" }] };
    const o = output({ operations: [op({ action: "meal_plan", evidence: "plan the omelette for Friday", meal: "d1", when: "Friday" })] });
    const r = await respond(o).interpreter.interpret(req);
    expect(r.followUps).toContainEqual({ kind: "meal-step", meal: { chooseOpId: "msg-1:meal1" }, to: "planned", date: "2026-10-16" });
  });

  it("a meal named by its dish instead of a label still resolves", async () => {
    const o = output({ operations: [op({ action: "meal_date", evidence: "move the pasta to Friday", meal: "the pasta", when: "Friday" })] });
    expect(opsOf(await respond(o).interpreter.interpret(base("move the pasta to Friday")))[0]).toMatchObject({ target: { mealId: "meal-pasta" } });
  });
});

describe("the week, by code", () => {
  it("'what are we eating this week?' is written from the plan", async () => {
    const o = output({ kind: "answer", reply: "Here's your week.", generate: { what: "week_plan", meal: null } });
    const r = await respond(o).interpreter.interpret(base("what are we eating this week?"));
    expect(r).toMatchObject({ kind: "answer", proposal: null, reply: "This week: Tomorrow: Pasta." });
  });

  it("week_needs routes to the turn; 'add' only when the words ask to add", async () => {
    const o = output({ kind: "answer", reply: "Let me check this week's meals.", generate: { what: "week_needs", meal: null } });
    expect((await respond(o).interpreter.interpret(base("add what we need for this week's meals"))).weekNeeds).toEqual({ add: true });
    expect((await respond(o).interpreter.interpret(base("what do we need this week?"))).weekNeeds).toEqual({ add: false });
  });

  it("a yes to the week's offer is tagged week-plan", async () => {
    const req = {
      ...base("yes"),
      history: [
        { role: "user" as const, text: "what do we need this week?" },
        { role: "assistant" as const, text: "For this week's meals you need: coconut milk and lemongrass. Want me to add these to your list?" },
      ],
    };
    const said = { value: "coconut milk", basis: "said" as const, confidence: "high" as const };
    const o = output({ listOfferAccepted: "week-plan", operations: [op({ action: "list_add", evidence: "yes", name: said })] });
    expect(opsOf(await respond(o).interpreter.interpret(req))).toEqual([expect.objectContaining({ type: "shopping.add", source: "week-plan" })]);
  });

  it("weekPlanAnswer, weekNeedsAnswer and weekNeedsAddedReply", () => {
    expect(weekPlanAnswer({ meals: [], plan: [] }, WEEK_TODAY)).toBe("Nothing's planned for this week yet.");
    const needs: WeekNeeds = {
      from: WEEK_TODAY,
      to: "2026-10-20",
      includeUndated: true,
      meals: [
        { mealId: "a", title: "Chicken curry", plannedFor: "2026-10-15", hasRecipe: true },
        { mealId: "b", title: "Tacos", hasRecipe: false },
      ],
      items: [
        { name: "coconut milk", standardName: "coconut milk", meals: [{ mealId: "a", title: "Chicken curry" }], onList: false },
        { name: "lemongrass", standardName: "lemongrass", meals: [{ mealId: "a", title: "Chicken curry" }], onList: true },
      ],
    };
    expect(weekNeedsAnswer(needs)).toBe(
      "For this week's meals you need: coconut milk. Already on your list: lemongrass. Tacos doesn't have a recipe yet, so I can't tell what it needs. Want me to add these to your list?",
    );
    const result = { applied: [{ opId: "x", summary: { code: "SHOPPING_ADDED", params: { name: "coconut milk" }, text: "" }, refs: [] }] } as unknown as ApplyResult;
    expect(weekNeedsAddedReply(needs, result)).toBe(
      "Added 1 thing for this week's meals: coconut milk. Already on your list: lemongrass. Tacos doesn't have a recipe yet, so I can't tell what it needs.",
    );
    expect(weekNeedsAnswer({ ...needs, meals: [] })).toBe("There are no planned meals this week, so there's nothing to add yet.");
  });
});

describe("what the model sees", () => {
  it("today with its weekday, and each planned meal's day; the cached prefix stays fixed", async () => {
    const { interpreter, calls } = respond(output({ kind: "answer", reply: "Hi." }));
    await interpreter.interpret(base("hi", "2026-10-16"));
    const user = calls[0].messages[0].content;
    expect(user).toContain("<today>2026-10-16 (Friday)</today>");
    expect(user).toContain("m1: Chicken curry · chosen · has recipe");
    expect(user).toContain("m2: Pasta · planned · for Thu 2026-10-15 · has recipe");
    expect(calls[0].system[0].text).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).not.toContain("2026-10-16");
    expect(renderTurn(base("hi"), NOW)).toContain("<today>2026-10-14 (Wednesday)</today>");
  });

  it("the wire carries `when` as a plain string ('' = none) and maps back", () => {
    const o = output({ operations: [op({ action: "meal_plan", evidence: "x", meal: "m1", when: "Tuesday" }), op({ action: "meal_plan", evidence: "y", meal: "m1" })] });
    const wire = toWire(o);
    expect(wire.operations.map((w) => w.when)).toEqual(["Tuesday", ""]);
    const back = parseModelOutput(wire);
    expect(back.success && back.data.operations.map((x) => x.when ?? null)).toEqual(["Tuesday", null]);
  });
});
