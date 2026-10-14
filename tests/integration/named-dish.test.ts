/**
 * A dish named in chat (MI1 Rec, 0013 M1) end to end on an embedded Postgres: the FAKE
 * interpreter and FAKE meal AI → `handleChatTurn` → the real validate → apply path → the recipe
 * follow-up. Vero's real message: her kitchen adds and the chosen dish are one change set, and
 * the recipe's In your kitchen / Need come from the kitchen including what she just added.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { StreamEvent } from "@/contracts/stream";
import { createFakeInterpreter } from "@/ai/fake";
import { createFakeMealAI } from "@/ai/fake/meals";
import { handleChatTurn } from "@/ai/turn";
import { addRecipeNeedsToShoppingList } from "@/domains/kitchen/commands";
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

const VERO = "i was thinking a chicken curry, with coconutt milk, lemon grass, kaffir. I have a curry base seasoning packet. i also have potatoes";

let n = 0;
async function turn(scope: KitchenScope, text: string) {
  const events: StreamEvent[] = [];
  const deps = { db, scope, interpreter: createFakeInterpreter(), meals: createFakeMealAI() };
  for await (const e of handleChatTurn(deps, { clientMessageId: `dish-${++n}`, text })) {
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

describe("a named dish through handleChatTurn (MI1)", () => {
  it("adds what she has, chooses the dish, then streams and saves its recipe; no idea cards", async () => {
    const k = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought chicken thighs");

    const t = await turn(vero, VERO);
    expect(t.types).not.toContain("idea");
    expect(t.result?.rejected).toEqual([]);
    expect(t.result?.applied.map((a) => a.summary.code)).toEqual(["ITEM_ADDED", "ITEM_ADDED", "MEAL_CHOSEN"]);
    expect(t.result?.applied[2].summary.text).toBe("Chose Chicken curry");
    expect(t.reply.startsWith("Chicken curry it is. I added curry base seasoning packet and potatoes.")).toBe(true);

    const mealId = t.result!.applied[2].refs.find((r) => r.kind === "meal")!.id;
    const saved = t.events.find((e) => e.type === "recipe.saved");
    expect(saved).toMatchObject({ mealId, version: 1 });
    expect(t.types.at(-1)).toBe("done");

    const state = await getKitchenState(db, vero);
    expect(state.meals.find((m) => m.id === mealId)).toMatchObject({ title: "Chicken curry", status: "chosen" });
    const recipe = await getRecipe(db, vero, mealId);
    const inKitchen = recipe!.ingredients.filter((i) => i.item && !("missing" in i.item)).map((i) => i.name);
    const need = recipe!.ingredients.filter((i) => !(i.item && !("missing" in i.item)) && !i.basic).map((i) => i.name);
    expect(inKitchen).toEqual(["chicken thighs", "curry base seasoning packet", "potatoes"]);
    expect(need).toEqual(["coconutt milk", "lemon grass", "kaffir"]); // the stand-in keeps her words as typed

    // "Add Need items to shopping list" (0027) works on it as on any recipe.
    const listed = await addRecipeNeedsToShoppingList(db, vero, { tapId: "tap-needs", basedOnVersion: state.version, mealId });
    expect(listed.ok).toBe(true);
    const list = (await getKitchenState(db, vero)).shoppingList.map((s) => s.name.value);
    expect(list).toEqual(["coconutt milk", "lemon grass", "kaffir"]);
  });

  it("'or something else?' gets idea cards, not a chosen dish", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought chicken thighs");
    const t = await turn(vero, "i was thinking a chicken curry, or something else?");
    expect(t.result).toBeNull();
    expect(t.types).toContain("idea");
    expect((await getKitchenState(db, vero)).meals).toEqual([]);
  });
});
