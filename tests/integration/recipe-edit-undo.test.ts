/**
 * 0052: a chat edit of a saved recipe shows a "What changed" receipt with Undo; the receipt's Undo
 * button brings the previous version back, and the idea card follows it. End to end on an
 * embedded Postgres with the FAKE interpreter and FAKE meal AI → `handleChatTurn` /
 * `handleChooseMeal` / `undoWithFollow` (what the `undoChange` server action runs) → the real stores.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mealIdeas } from "@/db/schema";
import type { ApplyResult } from "@/contracts/apply-result";
import { StreamEvent } from "@/contracts/stream";
import { createFakeInterpreter } from "@/ai/fake";
import { createFakeMealAI } from "@/ai/fake/meals";
import { handleChatTurn, handleChooseMeal, undoWithFollow } from "@/ai/turn";
import { listChatHistory } from "@/domains/chat/queries";
import { getChangesSince, getKitchenState, getRecipe } from "@/domains/kitchen/queries";
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
async function collect(gen: AsyncGenerator<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const e of gen) {
    StreamEvent.parse(e);
    events.push(e);
  }
  return {
    events,
    types: events.map((e) => e.type),
    receipts: events.flatMap((e) => (e.type === "applied" ? [e.result] : [])),
    ideas: events.flatMap((e) => (e.type === "idea" ? [e.idea] : [])),
    reply: events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join(""),
  };
}
const deps = (scope: KitchenScope) => ({
  db,
  scope,
  interpreter: createFakeInterpreter(async (req) => {
    const recent = await getChangesSince(db, scope, Math.max(0, req.version - 30));
    return recent.filter((c) => !("missing" in c.actor) && c.actor.id === req.userId).reverse();
  }),
  meals: createFakeMealAI(),
});
const turn = (scope: KitchenScope, text: string, id = `edit-${++n}`) => collect(handleChatTurn(deps(scope), { clientMessageId: id, text }));
const choose = (scope: KitchenScope, ideaId: string) =>
  collect(handleChooseMeal({ db, scope, meals: createFakeMealAI() }, { clientMessageId: `tap-${++n}`, target: { ideaId } }));
const undoTap = async (scope: KitchenScope, changeSetId: string) =>
  undoWithFollow({ db, scope }, { changeSetId, tapId: `undo-${++n}`, basedOnVersion: (await getKitchenState(db, scope)).version });

/** Ana's kitchen with a chosen Chicken curry from an idea card, and its first recipe (v1). */
async function anaWithCurryRecipe() {
  const k = await newKitchen(db, ["Ana", "Ben"]);
  const ana = await k.scope("Ana");
  await turn(ana, "I bought chicken thighs, potatoes and greek yogurt");
  const asked = await turn(ana, "what can I make? a chicken curry with potatoes, greek yogurt and lemongrass");
  const curry = asked.ideas[0];
  const chosen = await choose(ana, curry.ideaId);
  const mealId = (await getKitchenState(db, ana)).meals[0].id;
  const names = async (ids: string[]) => {
    const state = await getKitchenState(db, ana);
    return ids.map((id) => state.items.find((i) => i.id === id)?.name.value);
  };
  return { k, ana, curry, chosen, mealId, names };
}
const codes = (r: ApplyResult) => r.applied.map((a) => a.summary.code);

describe("0052: a chat edit of a saved recipe gets a receipt with Undo", () => {
  it("'no potatoes' → one receipt, before any text: 'Updated the Chicken curry recipe: removed potatoes', undoable", async () => {
    const { ana } = await anaWithCurryRecipe();
    const t = await turn(ana, "no potatoes");
    expect(t.receipts).toHaveLength(1);
    const [r] = t.receipts;
    expect(codes(r)).toEqual(["RECIPE_UPDATED"]);
    expect(r.applied[0].summary.text).toBe("Updated the Chicken curry recipe: removed potatoes");
    expect(r.applied[0].summary.params).toMatchObject({ title: "Chicken curry", what: "removed", removed: "potatoes", added: "" });
    expect(r.undoable).toBe(true);
    // The stream's order holds: `applied` before any `text`, and before its `recipe.saved`.
    const applied = t.types.indexOf("applied");
    expect(applied).toBeLessThan(t.types.indexOf("text"));
    expect(applied).toBeLessThan(t.types.indexOf("recipe.saved"));
    expect(t.reply).not.toBe("");
  });

  it("the receipt is saved with the reply, so it comes back with the chat", async () => {
    const { ana } = await anaWithCurryRecipe();
    const t = await turn(ana, "no potatoes", "edit-saved");
    const page = await listChatHistory(db, ana);
    const reply = page.messages.find((m) => m.clientMessageId === "edit-saved" && m.role === "assistant");
    expect(reply?.receipt?.changeSetId).toBe(t.receipts[0].changeSetId);
    expect(reply?.receipt?.applied.map((a) => a.summary.code)).toEqual(["RECIPE_UPDATED"]);
  });

  it("a first-time recipe gets no recipe receipt: choosing shows only 'Chose', and 'make … without yogurt' only its choose", async () => {
    const { chosen } = await anaWithCurryRecipe();
    expect(chosen.receipts.flatMap(codes)).toEqual(["MEAL_CHOSEN"]);

    const k = await newKitchen(db, ["Ana"]);
    const ana = await k.scope("Ana");
    await turn(ana, "I bought chicken thighs, potatoes and greek yogurt");
    await turn(ana, "what can I make? a chicken curry with potatoes, greek yogurt and lemongrass");
    const t = await turn(ana, "make the chicken curry without yogurt");
    expect(t.types).toContain("recipe.saved");
    expect(t.receipts).toHaveLength(1);
    expect(codes(t.receipts[0])).not.toContain("RECIPE_UPDATED");
    expect(codes(t.receipts[0])).not.toContain("RECIPE_SAVED");
  });
});

describe("0052: the receipt's Undo button (undoChange → undoWithFollow)", () => {
  it("brings back the previous version, shows it, and the idea card follows it", async () => {
    const { ana, curry, mealId, names } = await anaWithCurryRecipe();
    const t = await turn(ana, "no potatoes");
    expect((await getRecipe(db, ana, mealId))?.version).toBe(2);
    const [row0] = await db.select().from(mealIdeas).where(eq(mealIdeas.id, curry.ideaId));
    expect(await names(row0.uses)).toEqual(["chicken thighs", "greek yogurt"]);

    const { outcome, events } = await undoTap(ana, t.receipts[0].changeSetId);
    expect(outcome.ok && outcome.result.rejected).toEqual([]);
    const recipe = await getRecipe(db, ana, mealId);
    expect(recipe?.version).toBe(1);
    expect(recipe?.ingredients.map((i) => i.name)).toContain("potatoes");
    expect((await getKitchenState(db, ana)).meals[0].recipe?.version).toBe(1);

    // What the UI applies: the restored recipe (parts, then recipe.saved v1), then the card.
    for (const e of events) StreamEvent.parse(e);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("recipe");
    expect(events.find((e) => e.type === "recipe.saved")).toMatchObject({ mealId, version: 1 });
    const ingredients = events.flatMap((e) => (e.type === "recipe" && e.part === "ingredient" ? [(e.data as { name: string }).name] : []));
    expect(ingredients).toContain("potatoes");
    const cards = events.flatMap((e) => (e.type === "idea.updated" ? [e.idea] : []));
    expect(cards.map((c) => c.ideaId)).toEqual([curry.ideaId]);
    expect(await names(cards[0].uses)).toEqual(["chicken thighs", "potatoes", "greek yogurt"]);
    const [row] = await db.select().from(mealIdeas).where(eq(mealIdeas.id, curry.ideaId));
    expect(row.uses).toEqual(cards[0].uses);
  });

  it("an Undo that doesn't touch a recipe sends no recipe events", async () => {
    const k = await newKitchen(db, ["Ana"]);
    const ana = await k.scope("Ana");
    const t = await turn(ana, "I bought milk");
    const { outcome, events } = await undoTap(ana, t.receipts[0].changeSetId);
    expect(outcome.ok).toBe(true);
    expect(events).toEqual([]);
  });

  it("is refused for another member's change (H3, 0017): Ben can't undo Ana's recipe edit", async () => {
    const { k, ana, mealId } = await anaWithCurryRecipe();
    const t = await turn(ana, "no potatoes");
    const ben = await k.scope("Ben");
    const { outcome, events } = await undoTap(ben, t.receipts[0].changeSetId);
    const refused = !outcome.ok || outcome.result.applied.length === 0;
    expect(refused).toBe(true);
    if (outcome.ok) expect(outcome.result.rejected.map((r) => r.reason.code)).toEqual(["NOT_ALLOWED"]);
    expect(events).toEqual([]);
    expect((await getRecipe(db, ana, mealId))?.version).toBe(2);
  });
});
