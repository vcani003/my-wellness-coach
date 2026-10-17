/**
 * Meals end to end on an embedded Postgres (0005 steps 5–7, 0009, 0013, 0019): the FAKE
 * interpreter and the FAKE meal AI → the real turn follow-ups → the real validate → apply path.
 * ask → ideas → "the second one" → recipe → plan → cooking → "I made it" → Update your kitchen
 * (low / out / note) → Undo. Plus allergens (Levi's seafood) and the turn's safety nets.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mealIdeas, meals as mealsTable } from "@/db/schema";
import { StreamEvent } from "@/contracts/stream";
import { getInterpreter, handleChatTurn, handleChooseMeal } from "@/ai";
import type { Interpreter } from "@/ai/interpreter";
import type { MealAI } from "@/ai/meals";
import { createFakeMealAI } from "@/ai/fake/meals";
import {
  addRecipeNeedsToShoppingList,
  queueAfterCooking,
  recordMealIdeas,
  resolveReview,
  tickIngredient,
  undo,
  updateKitchenAfterCooking,
} from "@/domains/kitchen/commands";
import { getKitchenState, getLatestIdeaSet, getMealProfileContext, getRecipe } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { newKitchen, ok, openLocalDb } from "../support/db";
import { said } from "../support/memory-kitchen";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

/**
 * The fake meal AI, with each idea also using the NEXT kitchen item, so a recipe has two
 * in-kitchen ingredients and "Update your kitchen" can show both Running low and Out.
 */
function pairedMeals(): MealAI {
  const fake = createFakeMealAI();
  return {
    ...fake,
    async *streamMealIdeas(input) {
      const ids = input.state.items.map((i) => i.id);
      for await (const ev of fake.streamMealIdeas(input)) {
        if (ev.type !== "idea") {
          yield ev;
          continue;
        }
        const next = ids[(ids.indexOf(ev.idea.uses[0]) + 1) % ids.length];
        yield { type: "idea", idea: { ...ev.idea, uses: [...new Set([...ev.idea.uses, next])] } };
      }
    },
  };
}

let n = 0;
async function turn(scope: KitchenScope, text: string, opts: { id?: string; interpreter?: Interpreter; meals?: MealAI } = {}) {
  const events: StreamEvent[] = [];
  const deps = { db, scope, interpreter: opts.interpreter ?? getInterpreter({ db, scope }), meals: opts.meals ?? pairedMeals() };
  for await (const e of handleChatTurn(deps, { clientMessageId: opts.id ?? `meal-${++n}`, text })) {
    StreamEvent.parse(e); // every event matches the shared contract
    events.push(e);
  }
  const applied = events.find((e) => e.type === "applied");
  return {
    events,
    types: events.map((e) => e.type),
    result: applied?.type === "applied" ? applied.result : null,
    reply: events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join(""),
    ideas: events.flatMap((e) => (e.type === "idea" ? [e.idea] : [])),
  };
}

const of = <T extends StreamEvent["type"]>(events: StreamEvent[], type: T) =>
  events.filter((e): e is Extract<StreamEvent, { type: T }> => e.type === type);

describe("the meal journey (0005 steps 5–7)", () => {
  it("ask → ideas → the second one → recipe → plan → cooking → I made it → Update your kitchen → Undo", async () => {
    const k = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs, spinach and limes");
    const items = Object.fromEntries((await getKitchenState(db, vero)).items.map((i) => [i.name.value, i.id]));

    // 5. "What can I make tonight?" → ideas, streamed after the reply's first line and stored in card order.
    const ask = await turn(vero, "What can I make tonight?");
    expect(ask.types).toEqual(["ack", "status", "status", "text", "status", "idea", "idea", "idea", "notes", "text", "done"]);
    // The fake suggests one bowl per item, in kitchen order (eggs, limes, spinach).
    expect(ask.ideas.map((i) => i.name)).toEqual(["Eggs rice bowl", "Limes rice bowl", "Spinach rice bowl"]);
    expect(ask.ideas[1].uses).toEqual([items.limes, items.spinach]);
    expect(of(ask.events, "notes")[0].notes[0].code).toBe("BASICS_ASSUMED");
    expect(ask.reply).toBe("Let me look at what you have.\n\nHere are some ideas from your kitchen.");
    const shown = await getLatestIdeaSet(db, vero);
    expect(shown?.ideas.map((i) => i.ideaId)).toEqual(ask.ideas.map((i) => i.ideaId));

    // "The second one" → that card is chosen, then its recipe is written, streamed and saved.
    const chose = await turn(vero, "the second one");
    expect(chose.result?.applied.map((a) => a.summary.text)).toEqual(["Chose Limes rice bowl"]);
    const mealId = chose.result!.applied[0].refs.find((r) => r.kind === "meal")!.id;
    expect(chose.types.slice(0, 7)).toEqual(["ack", "status", "status", "applied", "status", "text", "status"]);
    expect(of(chose.events, "recipe").map((e) => e.part)).toEqual(["meta", "ingredient", "ingredient", "ingredient", "ingredient", "step", "step", "step", "step", "step", "basics"]);
    const saved = of(chose.events, "recipe.saved")[0];
    expect(saved).toMatchObject({ mealId, version: 1 });
    expect(chose.types.at(-1)).toBe("done");
    const recipe = await getRecipe(db, vero, mealId);
    expect(recipe?.ingredients.map((i) => [i.name, i.amount ?? null, i.item && "name" in i.item ? i.item.name : null])).toEqual([
      // The stand-in gives every non-basic an amount (0059 PF1).
      ["limes", "1", "limes"],
      ["spinach", "a handful", "spinach"],
      ["salt", "a pinch", null],
      ["cooking oil", "1 tbsp", null],
    ]);
    expect((await getKitchenState(db, vero)).version).toBe(saved.newVersion);

    // 6. "Add that to my meal plan" → "start cooking"; ticks are shared (M6).
    const planned = await turn(vero, "add that to my meal plan");
    expect(planned.result?.applied[0].summary.code).toBe("MEAL_PLANNED");
    const cooking = await turn(vero, "start cooking");
    expect(cooking.result?.applied[0].summary.text).toBe("Limes rice bowl: cooking");
    const ticked = await tickIngredient(db, vero, { tapId: "tick-1", basedOnVersion: cooking.result!.newVersion, mealId, ingredient: "limes", ticked: true });
    expect(ticked.ok && ticked.result.rejected).toEqual([]);
    const levisView = await getKitchenState(db, await k.scope("Levi"));
    expect(levisView.ticks.map((t) => [t.ingredient, "name" in t.createdBy ? t.createdBy.name : null])).toEqual([["limes", "Vero"]]);

    // 7. "I made it" → done (in-kitchen ingredients recorded as used), then "Update your kitchen".
    const made = await turn(vero, "I made it!");
    expect(made.result?.applied[0].summary.text).toBe("Limes rice bowl: done");
    const sheet = of(made.events, "update-kitchen")[0];
    expect(sheet).toEqual({
      type: "update-kitchen",
      mealId,
      title: "Limes rice bowl",
      items: [
        { itemId: items.limes, name: "limes" },
        { itemId: items.spinach, name: "spinach" },
      ],
    });

    // Update your kitchen: limes running low, spinach out, plus a note. One change set.
    const update = await updateKitchenAfterCooking(db, vero, {
      tapId: "update-1",
      basedOnVersion: made.result!.newVersion,
      mealId,
      items: [
        { itemId: items.limes, stock: "low" },
        { itemId: items.spinach, stock: "out" },
      ],
      note: "Used half the limes",
    });
    if (!update.ok) throw new Error(update.error.reason.text);
    expect(update.result.rejected).toEqual([]);
    expect(update.result.applied.map((a) => a.summary.text)).toEqual(["Saved a note on Limes rice bowl", "limes: running low", "spinach: out"]);
    const after = await getKitchenState(db, vero);
    expect(after.items.map((i) => [i.name.value, i.stock?.value ?? null])).toEqual([["eggs", null], ["limes", "low"]]);
    const note = async () => (await db.select({ note: mealsTable.note }).from(mealsTable).where(eq(mealsTable.id, mealId)))[0]?.note;
    expect(await note()).toBe("Used half the limes");

    // Undo puts all three back.
    const undone = await undo(db, vero, { changeSetId: update.result.changeSetId, tapId: "undo-1", basedOnVersion: update.result.newVersion });
    expect(undone.ok && undone.result.rejected).toEqual([]);
    const restored = await getKitchenState(db, vero);
    expect(restored.items.map((i) => [i.name.value, i.stock?.value ?? null])).toEqual([["eggs", null], ["limes", null], ["spinach", null]]);
    expect(await note()).toBeNull();
  });

  it("'plan the omelette' while it's only a card: choose and plan in ONE change set (one receipt, one Undo)", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs");
    await turn(vero, "what can I make?");
    const [card] = (await getLatestIdeaSet(db, vero))!.ideas;
    const planIt: Interpreter = {
      async interpret(req) {
        return {
          kind: "change",
          reply: "Added it to your plan.",
          proposal: {
            proposalId: req.message.id,
            kitchenId: req.kitchenId,
            basedOnVersion: req.version,
            source: { via: "chat", messageId: req.message.id },
            operations: [{ opId: "c1", type: "meal.choose", target: { ideaId: card.ideaId }, evidence: "plan the eggs one" }],
          },
          followUps: [
            { kind: "recipe", meal: { chooseOpId: "c1" } },
            { kind: "meal-step", meal: { chooseOpId: "c1" }, to: "planned" },
          ],
        };
      },
    };
    const out = await turn(vero, "plan the eggs one", { interpreter: planIt });
    expect(out.result?.rejected).toEqual([]);
    expect(out.result?.applied.map((a) => a.summary.code)).toEqual(["MEAL_CHOSEN", "MEAL_PLANNED"]);
    expect(of(out.events, "applied")).toHaveLength(1);
    expect(of(out.events, "recipe.saved")).toHaveLength(1);
    const state = await getKitchenState(db, vero);
    expect(state.meals.map((m) => [m.title, m.status, Boolean(m.recipe)])).toEqual([["Eggs rice bowl", "planned", true]]);
  });

  it("Do later → To review → Skip closes the card and changes nothing else (M8 Rec)", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs and rice");
    await turn(vero, "what can I make?");
    await turn(vero, "the first one");
    await turn(vero, "start cooking");
    const made = await turn(vero, "I made it");
    const sheet = of(made.events, "update-kitchen")[0];
    const later = await queueAfterCooking(db, vero, { tapId: "later", basedOnVersion: made.result!.newVersion, mealId: sheet.mealId, items: sheet.items });
    if (!later.ok) throw new Error("queue failed");
    const card = later.result.state.toReview[0];
    expect(card).toMatchObject({ kind: "after-cooking", items: sheet.items.map((i) => ({ itemId: i.itemId, name: i.name })) });
    const before = (await getKitchenState(db, vero)).items;
    const skipped = await resolveReview(db, vero, { tapId: "skip", basedOnVersion: later.result.newVersion, reviewId: card.id, outcome: "skipped" });
    expect(skipped.ok && skipped.result.state.toReview).toEqual([]);
    expect((await getKitchenState(db, vero)).items).toEqual(before);
  });

  it("Update your kitchen from a To review card: the card closes in the same change set", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs and rice");
    await turn(vero, "what can I make?");
    await turn(vero, "the first one");
    await turn(vero, "start cooking");
    const made = await turn(vero, "I made it");
    const sheet = of(made.events, "update-kitchen")[0];
    const later = await queueAfterCooking(db, vero, { tapId: "later2", basedOnVersion: made.result!.newVersion, mealId: sheet.mealId, items: sheet.items });
    if (!later.ok) throw new Error("queue failed");
    const reviewId = later.result.state.toReview[0].id;
    const done = await updateKitchenAfterCooking(db, vero, {
      tapId: "done2",
      basedOnVersion: later.result.newVersion,
      mealId: sheet.mealId,
      items: [{ itemId: sheet.items[0].itemId, stock: "out" }],
      reviewId,
    });
    if (!done.ok) throw new Error("update failed");
    expect(done.result.applied.map((a) => a.summary.code)).toEqual(["ITEM_OUT", "REVIEW_RESOLVED"]);
    expect(done.result.state.toReview).toEqual([]);
  });
});

describe("allergens (0019, AI6): Levi's seafood allergy", () => {
  async function shrimpKitchen() {
    const k = await newKitchen(db, ["Vero", "Levi"]);
    const levi = await k.scope("Levi");
    await ok(
      db,
      levi,
      [{ type: "profile.restriction.add", evidence: "allergic to seafood", fields: { kind: "allergy", subject: said("seafood"), note: said("can eat shrimp if my medicine is on hand") } }],
      { text: "I'm allergic to seafood but can eat shrimp if my medicine is on hand" },
    );
    const vero = await k.scope("Vero");
    await turn(vero, "I bought shrimp, eggs and spinach");
    return { k, vero, levi };
  }

  it("every member's allergies, with their notes, are in the meal context whoever asks", async () => {
    const { k, vero } = await shrimpKitchen();
    const ctx = await getMealProfileContext(db, vero);
    expect(ctx.members.map((m) => m.name)).toEqual(["Vero", "Levi"]);
    expect(ctx.restrictions.map((r) => [r.userId, r.kind, r.subject.value, r.note?.value])).toEqual([
      [k.userIds.Levi, "allergy", "seafood", "can eat shrimp if my medicine is on hand"],
    ]);
  });

  it("unprompted ideas leave out shrimp dishes; asked for, they're shown and flagged with Levi's note", async () => {
    const { k, vero } = await shrimpKitchen();
    const plain = await turn(vero, "What can I make tonight?", { meals: createFakeMealAI() });
    expect(plain.ideas.map((i) => i.name)).toEqual(["Eggs rice bowl", "Spinach rice bowl"]);
    expect(plain.ideas.flatMap((i) => i.allergenFlags)).toEqual([]);

    const asked = await turn(vero, "What can I make? Shrimp tacos?", { meals: createFakeMealAI() });
    const shrimpy = asked.ideas.filter((i) => /shrimp/i.test(i.name));
    expect(shrimpy.length).toBeGreaterThan(0);
    for (const idea of shrimpy) {
      expect(idea.allergenFlags).toContainEqual(
        expect.objectContaining({ userId: k.userIds.Levi, subject: "seafood", note: "can eat shrimp if my medicine is on hand" }),
      );
    }
  });

  it("regression: an idea USING the kitchen's shrimp is flagged even when its name doesn't say so", async () => {
    const { k, vero } = await shrimpKitchen();
    const shrimp = (await getKitchenState(db, vero)).items.find((i) => i.name.value === "shrimp")!;
    const { ideas } = await recordMealIdeas(db, vero, { basedOnVersion: 1, ideas: [{ name: "Fried rice", why: "", uses: [shrimp.id], missing: [] }] });
    expect(ideas[0].allergenFlags).toEqual([{ ingredient: "shrimp", userId: k.userIds.Levi, subject: "seafood", note: "can eat shrimp if my medicine is on hand" }]);
    // And the same when the set is read back for "the second one".
    expect((await getLatestIdeaSet(db, vero))?.ideas[0].allergenFlags).toHaveLength(1);
  });
});

describe("'the second one' and other safety nets", () => {
  it("resolves against the cards YOU were last shown, in card order; another member's cards never count (H2)", async () => {
    const k = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs, spinach and limes");
    await turn(vero, "what can I make?");
    await turn(vero, "any ideas?"); // a newer set: "the second one" means this one
    const latest = await getLatestIdeaSet(db, vero);
    const levi = await k.scope("Levi");
    const leviTry = await turn(levi, "the second one");
    expect(leviTry.result).toBeNull();
    expect(of(leviTry.events, "clarification")[0].question).toBe("Which one?");

    const chose = await turn(vero, "the second one");
    expect(chose.result?.applied[0].summary.text).toBe(`Chose ${latest!.ideas[1].name}`);
  });

  it("a retried 'what can I make?' shows the stored set again: no new ideas, no second AI call", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs");
    let calls = 0;
    const fake = pairedMeals();
    const counting: MealAI = {
      ...fake,
      streamMealIdeas(input) {
        calls++;
        return fake.streamMealIdeas(input);
      },
    };
    const first = await turn(vero, "what can I make?", { id: "same-ask", meals: counting });
    const again = await turn(vero, "what can I make?", { id: "same-ask", meals: counting });
    expect(calls).toBe(1);
    expect(again.ideas.map((i) => i.ideaId)).toEqual(first.ideas.map((i) => i.ideaId));
    const rows = await db.select().from(mealIdeas).where(eq(mealIdeas.kitchenId, k.kitchenId));
    expect(rows).toHaveLength(first.ideas.length);
  });

  it("a retried 'the second one' chooses the same meal and never saves a second recipe", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs and spinach");
    await turn(vero, "what can I make?");
    const first = await turn(vero, "the second one", { id: "same-choose" });
    const again = await turn(vero, "the second one", { id: "same-choose" });
    const mealId = first.result!.applied[0].refs.find((r) => r.kind === "meal")!.id;
    expect(of(first.events, "recipe.saved")[0]).toMatchObject({ mealId, version: 1 });
    expect(again.result?.applied[0].refs.find((r) => r.kind === "meal")?.id).toBe(mealId);
    expect(of(again.events, "recipe.saved")).toEqual([]);
    expect((await getRecipe(db, vero, mealId))?.version).toBe(1);
  });

  it("ideas that fail part-way are dropped: removed from the database and `ideas.dropped` sent", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs");
    const refusing: MealAI = {
      ...createFakeMealAI(),
      async *streamMealIdeas() {
        yield { type: "idea", idea: { name: "Omelette", why: "", uses: [], missing: [], basics: [], useItUp: [], allergenFlags: [] } };
        yield { type: "done", result: { ok: false, reason: "refusal", reply: "I can't help with that one." } };
      },
    };
    const out = await turn(vero, "what can I make?", { meals: refusing });
    const setId = of(out.events, "idea")[0].setId;
    expect(of(out.events, "ideas.dropped")).toEqual([{ type: "ideas.dropped", setId }]);
    expect(out.reply).toContain("I can't help with that one.");
    expect(out.types.at(-1)).toBe("done");
    expect(await db.select().from(mealIdeas).where(and(eq(mealIdeas.kitchenId, k.kitchenId), eq(mealIdeas.setId, setId)))).toEqual([]);
  });

  it("a meal AI that throws doesn't break the turn: what saved stays saved, and it ends with done (0018)", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs");
    const broken: MealAI = {
      ...createFakeMealAI(),
      async *streamMealIdeas() {
        throw new Error("boom");
      },
    };
    const errors = console.error;
    console.error = () => {};
    const out = await turn(vero, "what can I make?", { meals: broken });
    console.error = errors;
    expect(out.types.at(-1)).toBe("done");
    expect(out.reply).toContain("Sorry, I couldn't finish that just now.");
  });

  it("Choose from a card streams the recipe (POST /api/meals/choose); Choose again reuses it", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs and spinach");
    const ask = await turn(vero, "what can I make?");
    const run = async (id: string) => {
      const events: StreamEvent[] = [];
      for await (const e of handleChooseMeal({ db, scope: vero, meals: pairedMeals() }, { clientMessageId: id, target: { ideaId: ask.ideas[0].ideaId } })) {
        StreamEvent.parse(e);
        events.push(e);
      }
      return events;
    };
    const first = await run("tap-choose-1");
    expect(first.map((e) => e.type).slice(0, 4)).toEqual(["ack", "status", "applied", "status"]);
    expect(of(first, "recipe.saved")).toHaveLength(1);
    expect(first.at(-1)?.type).toBe("done");
    const second = await run("tap-choose-2");
    expect(of(second, "recipe").length).toBeGreaterThan(0);
    expect(of(second, "recipe.saved")).toHaveLength(0); // already had one: shown, not rewritten
  });

  it("'Add Need items to shopping list' adds only the recipe's Need group, source recipe (0027)", async () => {
    const k = await newKitchen(db, ["Vero"]);
    const vero = await k.scope("Vero");
    await turn(vero, "I bought eggs");
    const chose = await turn(vero, "the first one"); // no cards yet: asks
    expect(chose.result).toBeNull();
    await turn(vero, "what can I make? soup?", { meals: createFakeMealAI() });
    const picked = await turn(vero, "the first one", { meals: createFakeMealAI() });
    const mealId = picked.result!.applied[0].refs.find((r) => r.kind === "meal")!.id;
    const recipe = await getRecipe(db, vero, mealId);
    const needs = recipe!.ingredients.filter((i) => !i.item && !i.basic).map((i) => i.name);
    expect(needs.length).toBeGreaterThan(0);
    const out = await addRecipeNeedsToShoppingList(db, vero, { tapId: "needs", basedOnVersion: picked.result!.newVersion, mealId });
    if (!out.ok) throw new Error("needs failed");
    expect(out.result.state.shoppingList.map((s) => [s.name.value, s.source])).toEqual(needs.map((n) => [n, "recipe"]));
  });
});
