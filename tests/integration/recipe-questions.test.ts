/**
 * The 2026-10-17 preview flow (0059 PF1, PF2), end to end on an embedded Postgres with the
 * scripted test double for the model (tests/support/scripted-ai; the app's stand-in declines these,
 * PF10): a named dish with notes gets a recipe with amounts and real steps; questions about
 * it are answered in chat and change nothing (no kitchen change, no new recipe version). Also the
 * turn's code guard: a question never removes kitchen items, whatever the interpreter proposed.
 * People are fictional (Ana).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { StreamEvent } from "@/contracts/stream";
import type { ProposedChange } from "@/contracts/proposed-change";
import { createScriptedInterpreter } from "../support/scripted-ai/interpreter";
import { createScriptedMealAI } from "../support/scripted-ai/meals";
import type { Interpreter } from "@/ai/interpreter";
import { QUESTION_KEPT_REPLY } from "@/ai/question-guard";
import { handleChatTurn } from "@/ai/turn";
import { getKitchenState, getRecipe } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { newKitchen, openLocalDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

let n = 0;
async function turn(scope: KitchenScope, text: string, interpreter: Interpreter = createScriptedInterpreter()) {
  const events: StreamEvent[] = [];
  for await (const e of handleChatTurn({ db, scope, interpreter, meals: createScriptedMealAI() }, { clientMessageId: `pf-${++n}`, text })) {
    StreamEvent.parse(e);
    events.push(e);
  }
  const applied = events.find((e) => e.type === "applied");
  return {
    events,
    types: events.map((e) => e.type),
    result: applied?.type === "applied" ? applied.result : null,
    reply: events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join(""),
  };
}

const openItems = async (scope: KitchenScope) =>
  (await getKitchenState(db, scope)).items.filter((i) => i.stock?.value !== "out").map((i) => i.name.value);

describe("the preview flow: a Japanese rolled omelette, then questions about it (0059)", () => {
  it("amounts and real steps; 'how much…', 'what are the measurements?', 'no measurements for the eggs?' change nothing", async () => {
    const k = await newKitchen(db, ["Ana"]);
    const ana = await k.scope("Ana");
    await turn(ana, "I bought eggs and spinach");

    const dish = await turn(ana, "I want to make japanese rolled omelette. Season it with only hondashi. I like it a little sweet");
    expect(dish.result?.rejected).toEqual([]);
    const meals = (await getKitchenState(db, ana)).meals;
    expect(meals.map((m) => m.title)).toEqual(["Japanese rolled omelette"]);
    const mealId = meals[0].id;
    const v1 = (await getRecipe(db, ana, mealId))!;
    expect(v1.version).toBe(1);
    expect(v1.ingredients.map((i) => [i.amount, i.name])).toEqual([
      ["4", "eggs"],
      ["1 tsp", "hondashi"],
      ["1 tsp", "sugar"],
      ["1 tbsp", "cooking oil"],
    ]);
    expect(v1.steps.length).toBeGreaterThanOrEqual(4);
    for (const i of v1.ingredients) expect(i.name).not.toMatch(/season it|i like/i);

    const before = await openItems(ana);
    const version = (await getKitchenState(db, ana)).version;
    for (const [text, reply] of [
      ["how much eggs do I need?", "For 2 servings: 4 eggs."],
      ["what are the measurements?", "For 2 servings: 4 eggs, 1 tsp hondashi, 1 tsp sugar, 1 tbsp cooking oil."],
      ["no measurements for the eggs?", "For 2 servings: 4 eggs."],
      ["I want to make it, how much eggs do I need?", "For 2 servings: 4 eggs."],
    ] as const) {
      const t = await turn(ana, text);
      expect(t.reply, text).toBe(reply);
      expect(t.types, text).not.toContain("applied");
      expect(t.types, text).not.toContain("recipe.saved");
      expect(t.types.at(-1), text).toBe("done");
    }
    const after = await getKitchenState(db, ana);
    expect(after.version).toBe(version);
    expect(await openItems(ana)).toEqual(before);
    expect(after.meals.map((m) => m.title)).toEqual(["Japanese rolled omelette"]); // no meal called "It"
    expect((await getRecipe(db, ana, mealId))!.version).toBe(1);
  });
});

describe("code guard in the turn: a question never removes (0059 PF2)", () => {
  const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
  /** A stand-in for a model that wrongly reads the question as a use. */
  const wrong: Interpreter = {
    async interpret(req) {
      const proposal: ProposedChange = {
        proposalId: req.message.id,
        kitchenId: req.kitchenId,
        basedOnVersion: req.version,
        source: { via: "chat", messageId: req.message.id },
        operations: [{ opId: "1", type: "item.use", evidence: req.message.text.replace(/\?$/, ""), target: { name: "eggs" }, fields: { stock: said("out" as const) } }],
      };
      return { kind: "change", reply: "Got it: marked the eggs as used up.", proposal };
    },
  };

  it("drops the use, saves nothing and says so", async () => {
    const k = await newKitchen(db, ["Ana"]);
    const ana = await k.scope("Ana");
    await turn(ana, "I bought eggs");
    const t = await turn(ana, "no measurements for the eggs?", wrong);
    expect(t.types).not.toContain("applied");
    expect(t.reply).toBe(QUESTION_KEPT_REPLY);
    expect(await openItems(ana)).toEqual(["eggs"]);
  });

  it("a told use still saves", async () => {
    const k = await newKitchen(db, ["Ana"]);
    const ana = await k.scope("Ana");
    await turn(ana, "I bought eggs");
    const t = await turn(ana, "I used the rest of the eggs", wrong);
    expect(t.result?.applied).toHaveLength(1);
    expect(await openItems(ana)).toEqual([]);
  });
});
