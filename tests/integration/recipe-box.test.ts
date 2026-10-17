/**
 * Recipe box (0040) on an embedded Postgres with the real migrations:
 * A2 Done meals keep their recipe, A1 "Cooked before" (grouped, searched, kitchen-wide, flagged
 * from today's allergies), B1's title lookup, and C "Make again" (copy, provenance, Undo, the
 * source untouched). Fictional people: Ana and Ben.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { meals } from "@/db/schema";
import { applyProposedChange, makeMealAgain, rebuildProjections, undo } from "@/domains/kitchen/commands";
import { findPastMealsByTitle, getKitchenState, getKitchenVersion, getRecipe, listPastMeals } from "@/domains/kitchen/queries";
import { loadKitchenEntities } from "@/domains/kitchen/store";
import type { RecipeIngredient } from "@/contracts/operations";
import { PastMeal } from "@/contracts/past-meals";
import type { KitchenScope } from "@/shared/membership";
import { said, type OpInput } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb, send } from "../support/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

let taps = 0;
/** A button tap at a fixed time, asserting it saved. */
async function tapAt(scope: KitchenScope, ops: OpInput[], at: string) {
  const id = `tap-${++taps}`;
  const out = await applyProposedChange(
    db,
    scope,
    {
      proposalId: id,
      kitchenId: scope.kitchenId,
      basedOnVersion: await getKitchenVersion(db, scope),
      source: { via: "button", action: "test" },
      operations: ops.map((op, i) => ({ opId: `op-${i + 1}`, ...op })),
    },
    { now: new Date(at) },
  );
  if (!out.ok) throw new Error(out.error.reason.text);
  return out.result;
}

const ing = (name: string, extra: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ name, ...extra });

/** Choose a dish by name, save its recipe, cook it and mark it Done at `at`. Returns the meal ID. */
async function cook(scope: KitchenScope, title: string, ingredients: RecipeIngredient[], at: string, opts: { recipe?: boolean } = {}) {
  const chose = await tapAt(scope, [{ type: "meal.choose", target: { title } }], at);
  const mealId = chose.applied[0].refs[0].id;
  await tapAt(
    scope,
    [
      ...(opts.recipe === false
        ? []
        : [
            {
              type: "recipe.save" as const,
              target: { mealId },
              source: "ai" as const,
              text: `${title}, the way we like it`,
              ingredients,
              steps: ["Prep", "Cook"],
              basicsAssumed: ["salt"],
            },
          ]),
      { type: "meal.transition", target: { mealId }, to: "cooking" },
      { type: "meal.transition", target: { mealId }, to: "done" },
    ],
    at,
  );
  return mealId;
}

const codes = (r: { rejected: { reason: { code: string } }[] }) => r.rejected.map((x) => x.reason.code);

describe("A2: a Done meal keeps its recipe as cooked", () => {
  it("refuses a new recipe version on a done or cancelled meal (RECIPE_LOCKED); the cooked version stays", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    const mealId = await cook(ana, "Chicken curry", [ing("chicken thighs"), ing("coconut milk")], "2026-10-10T18:00:00Z");
    const before = await getRecipe(db, ana, mealId);
    expect(before?.version).toBe(1);

    const out = await send(db, ana, [
      { type: "recipe.save", target: { mealId }, source: "user", text: "with peanuts", ingredients: [ing("peanuts")], steps: [], basicsAssumed: [] },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(codes(out.result)).toEqual(["RECIPE_LOCKED"]);
    expect(out.result.rejected[0].reason.params).toMatchObject({ title: "Chicken curry", status: "done" });
    expect(out.result.applied).toEqual([]);
    expect(await getRecipe(db, ana, mealId)).toEqual(before);

    // Cancelled meals are finished too.
    const chose = await ok(db, ana, [{ type: "meal.choose", target: { title: "Soup" } }]);
    const soupId = chose.applied[0].refs[0].id;
    await ok(db, ana, [{ type: "meal.transition", target: { mealId: soupId }, to: "cancelled" }]);
    const soup = await ok(db, ana, [
      { type: "recipe.save", target: { mealId: soupId }, source: "ai", text: "", ingredients: [], steps: [], basicsAssumed: [] },
    ]);
    expect(codes(soup)).toEqual(["RECIPE_LOCKED"]);
  });

  it("a live meal still takes new versions", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    const mealId = (await ok(db, ana, [{ type: "meal.choose", target: { title: "Omelette" } }])).applied[0].refs[0].id;
    for (const v of [1, 2]) {
      const r = await ok(db, ana, [
        { type: "recipe.save", target: { mealId }, source: "ai", text: `v${v}`, ingredients: [ing("eggs")], steps: [], basicsAssumed: [] },
      ]);
      // 0052: a new version of a recipe the meal had says "Updated the … recipe".
      expect(r.applied[0].summary).toMatchObject({ code: v === 1 ? "RECIPE_SAVED" : "RECIPE_UPDATED", params: { version: v } });
    }
  });
});

describe("A1: Cooked before", () => {
  it("one row per dish, newest first, with times cooked, last date, who cooked it, and the cooked recipe", async () => {
    const t = await newKitchen(db, ["Ana", "Ben"]);
    const ana = await t.scope("Ana");
    const ben = await t.scope("Ben");
    await cook(ana, "Chicken curry", [ing("chicken"), ing("coconut milk")], "2026-10-01T18:00:00Z");
    await cook(ana, "Phở bò", [ing("beef"), ing("nước mắm"), ing("rice noodles")], "2026-10-05T18:00:00Z");
    const latestCurry = await cook(ben, "chicken  Curry!", [ing("chicken"), ing("lemongrass")], "2026-10-12T18:00:00Z");
    // Not Done: never listed (RB1).
    await ok(db, ana, [{ type: "meal.choose", target: { title: "Tacos" } }]);

    const list = await listPastMeals(db, ana, {});
    for (const row of list) PastMeal.parse(row);
    expect(list.map((m) => [m.title, m.timesCooked, m.lastCookedAt])).toEqual([
      ["chicken  Curry!", 2, "2026-10-12T18:00:00.000Z"],
      ["Phở bò", 1, "2026-10-05T18:00:00.000Z"],
    ]);
    expect(list[0].mealId).toBe(latestCurry);
    expect(list[0].lastCookedBy).toEqual({ id: t.userIds.Ben, name: "Ben" });
    expect(list[1].lastCookedBy).toEqual({ id: t.userIds.Ana, name: "Ana" });
    expect(list[0].recipe).toMatchObject({ version: 1, source: "ai" });

    // Kitchen-wide (RB5): Ben sees the same list.
    expect(await listPastMeals(db, ben, {})).toEqual(list);
    // limit
    expect((await listPastMeals(db, ana, { limit: 1 })).map((m) => m.title)).toEqual(["chicken  Curry!"]);
  });

  it("q matches the name or any ingredient, ignoring case and accents (RB9, 0032)", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    await cook(ana, "Chicken curry", [ing("chicken"), ing("coconut milk")], "2026-10-01T18:00:00Z");
    await cook(ana, "Phở bò", [ing("beef"), ing("nước mắm")], "2026-10-05T18:00:00Z");
    await cook(ana, "Green salad", [ing("Lettuce"), ing("Crème fraîche")], "2026-10-06T18:00:00Z");
    const titles = async (q: string) => (await listPastMeals(db, ana, { q })).map((m) => m.title);
    expect(await titles("pho")).toEqual(["Phở bò"]);
    expect(await titles("nuoc mam")).toEqual(["Phở bò"]);
    expect(await titles("fish sauce")).toEqual(["Phở bò"]); // through 0032's English gloss
    expect(await titles("COCONUT")).toEqual(["Chicken curry"]);
    expect(await titles("creme")).toEqual(["Green salad"]);
    expect(await titles("chicken coconut")).toEqual(["Chicken curry"]); // name + ingredient
    expect(await titles("lasagne")).toEqual([]);
    expect(await titles("   ")).toHaveLength(3);
  });

  it("flags a past recipe against today's allergies, added after it was cooked (RB8, 0019)", async () => {
    const t = await newKitchen(db, ["Ana", "Ben"]);
    const ana = await t.scope("Ana");
    const ben = await t.scope("Ben");
    await cook(ana, "Pad thai", [ing("rice noodles"), ing("peanuts"), ing("shrimp")], "2026-10-01T18:00:00Z");
    expect((await listPastMeals(db, ana, {}))[0].allergenFlags).toEqual([]);

    await ok(db, ben, [{ type: "profile.restriction.add", evidence: "allergic to peanuts", fields: { kind: "allergy", subject: said("peanuts") } }], {
      text: "I'm allergic to peanuts",
    });
    const [row] = await listPastMeals(db, ana, {});
    expect(row.title).toBe("Pad thai"); // still listed, always flagged
    expect(row.allergenFlags).toEqual([{ ingredient: "peanuts", userId: t.userIds.Ben, subject: "peanuts" }]);
  });

  it("lists a Done meal cooked without a recipe, with no recipe summary", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    await cook(ana, "Toast", [], "2026-10-01T08:00:00Z", { recipe: false });
    const [row] = await listPastMeals(db, ana, {});
    expect(row.title).toBe("Toast");
    expect(row.recipe).toBeUndefined();
  });

  it("only this kitchen's meals", async () => {
    const mine = await newKitchen(db, ["Ana"]);
    const other = await newKitchen(db, ["Ben"]);
    await cook(await other.scope("Ben"), "Secret stew", [ing("beef")], "2026-10-01T18:00:00Z");
    expect(await listPastMeals(db, await mine.scope("Ana"), {})).toEqual([]);
  });

  it("an older Done row with no cooked_by reads its last updater (migration 0011 fallback)", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    const mealId = await cook(ana, "Rice", [ing("rice")], "2026-10-01T18:00:00Z");
    await db.update(meals).set({ cookedBy: null }).where(and(eq(meals.kitchenId, t.kitchenId), eq(meals.id, mealId)));
    expect((await listPastMeals(db, ana, {}))[0].lastCookedBy).toEqual({ id: t.userIds.Ana, name: "Ana" });
  });
});

describe("B1: finding a past dish by what it was called", () => {
  it("matches titles only, newest first, with dates; filler words don't count", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    await cook(ana, "Chicken curry", [ing("chicken")], "2026-10-01T18:00:00Z");
    await cook(ana, "Thai green curry", [ing("chicken"), ing("coconut milk")], "2026-10-08T18:00:00Z");
    await cook(ana, "Chicken soup", [ing("chicken")], "2026-10-09T18:00:00Z");
    const find = async (said: string) => (await findPastMealsByTitle(db, ana, said)).map((m) => [m.title, m.lastCookedAt.slice(0, 10)]);
    expect(await find("that curry")).toEqual([
      ["Thai green curry", "2026-10-08"],
      ["Chicken curry", "2026-10-01"],
    ]);
    expect(await find("the chicken curry")).toEqual([["Chicken curry", "2026-10-01"]]);
    expect(await find("coconut")).toEqual([]); // an ingredient isn't a name
    expect(await find("the")).toEqual([]);
    expect(await find("lasagne")).toEqual([]);
  });
});

describe("C: Make again", () => {
  it("copies the cooked version into a new chosen meal; the source is untouched; one Undo removes it", async () => {
    const t = await newKitchen(db, ["Ana", "Ben"]);
    const ana = await t.scope("Ana");
    const ben = await t.scope("Ben");
    const bought = await ok(db, ana, [{ type: "item.add", fields: { name: said("chicken thighs") } }], { text: "bought chicken thighs" });
    const chickenId = bought.applied[0].refs[0].id;
    const sourceId = await cook(
      ana,
      "Chicken curry",
      [ing("chicken thighs", { itemId: chickenId, amount: "500 g" }), ing("coconut milk", { amount: "1 can" }), ing("salt", { basic: true })],
      "2026-10-10T18:00:00Z",
    );
    const sourceRecipe = await getRecipe(db, ana, sourceId);
    const entitiesBefore = await loadKitchenEntities(db, t.kitchenId);

    // Ben makes it again (RB5: kitchen-wide).
    const out = await makeMealAgain(db, ben, { tapId: "again-1", basedOnVersion: await getKitchenVersion(db, ben), fromMealId: sourceId });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;
    expect(r.rejected).toEqual([]);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].summary).toEqual({ code: "MEAL_MADE_AGAIN", params: { title: "Chicken curry" }, text: "Making Chicken curry again" });
    expect(r.undoable).toBe(true);
    const newMealId = r.applied[0].refs.find((x) => x.kind === "meal")!.id;
    expect(r.applied[0].refs.map((x) => [x.kind, x.change])).toEqual([
      ["meal", "added"],
      ["recipe", "added"],
    ]);
    expect(newMealId).not.toBe(sourceId);
    expect(r.state.meals.find((m) => m.id === newMealId)).toMatchObject({ title: "Chicken curry", status: "chosen", recipe: { version: 1, source: "ai" } });

    const copy = await getRecipe(db, ben, newMealId);
    expect(copy).toMatchObject({
      version: 1,
      source: "ai",
      text: sourceRecipe!.text,
      steps: sourceRecipe!.steps,
      basicsAssumed: sourceRecipe!.basicsAssumed,
    });
    // Amounts and basics kept; the item link is matched again against today's kitchen.
    expect(copy!.ingredients).toEqual(sourceRecipe!.ingredients);

    // Provenance is stored; the source meal and its recipe are exactly as they were.
    const entities = await loadKitchenEntities(db, t.kitchenId);
    expect(entities.recipes[copy!.id].copiedFromRecipeId).toBe(sourceRecipe!.id);
    expect(entities.recipes[copy!.id].ingredients.some((i) => i.itemId)).toBe(false);
    expect(entities.meals[sourceId]).toEqual(entitiesBefore.meals[sourceId]);
    expect(entities.recipes[sourceRecipe!.id]).toEqual(entitiesBefore.recipes[sourceRecipe!.id]);

    // Refining the copy works as usual (it's a live meal) and makes v2.
    const v2 = await ok(db, ben, [
      { type: "recipe.save", target: { mealId: newMealId }, source: "user", text: "less spicy", ingredients: [ing("chicken thighs")], steps: [], basicsAssumed: [] },
    ]);
    expect(v2.applied[0].summary.params).toMatchObject({ version: 2 });
    await undo(db, ben, { changeSetId: v2.changeSetId, tapId: "undo-v2", basedOnVersion: v2.newVersion });

    // RBX1: while the copy is live, Cooked before points at it and Make again won't make another.
    const [row] = await listPastMeals(db, ana, {});
    expect(row).toMatchObject({ mealId: sourceId, activeCopyMealId: newMealId });
    const twice = await makeMealAgain(db, ana, { tapId: "again-2", basedOnVersion: await getKitchenVersion(db, ana), fromMealId: sourceId });
    expect(twice.ok && twice.result.rejected.map((x) => [x.reason.code, x.reason.params.mealId])).toEqual([["ALREADY_MAKING", newMealId]]);
    expect(twice.ok && twice.result.applied).toEqual([]);

    // Projections == replay, with the new columns.
    const settled = await loadKitchenEntities(db, t.kitchenId);
    expect(settled.meals[newMealId].madeAgainFromMealId).toBe(sourceId);
    await rebuildProjections(db, ana);
    expect(await loadKitchenEntities(db, t.kitchenId)).toEqual(settled);

    // One Undo removes the new meal and its recipe; the source is still in Cooked before.
    const undone = await undo(db, ben, { changeSetId: r.changeSetId, tapId: "undo-again", basedOnVersion: await getKitchenVersion(db, ben) });
    expect(undone.ok && undone.result.rejected).toEqual([]);
    const after = await loadKitchenEntities(db, t.kitchenId);
    expect(after.meals[newMealId]).toBeUndefined();
    expect(after.recipes[copy!.id]).toBeUndefined();
    expect(after.meals[sourceId]).toEqual(entitiesBefore.meals[sourceId]);
    expect((await listPastMeals(db, ana, {})).map((m) => [m.mealId, m.timesCooked, m.activeCopyMealId])).toEqual([[sourceId, 1, undefined]]);
  });

  it("RBX1: once the copy is cooked (or cancelled) it's no longer active, and the dish reads made 2×", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    const sourceId = await cook(ana, "Green curry", [ing("coconut milk")], "2026-10-01T18:00:00Z");
    const again = async (tapId: string) => {
      const out = await makeMealAgain(db, ana, { tapId, basedOnVersion: await getKitchenVersion(db, ana), fromMealId: sourceId });
      if (!out.ok) throw new Error(out.error.reason.text);
      return out.result.applied[0].refs[0].id;
    };
    const copyId = await again("g1");
    await tapAt(ana, [{ type: "meal.transition", target: { mealId: copyId }, to: "cancelled" }], "2026-10-02T18:00:00Z");
    expect((await listPastMeals(db, ana, {}))[0].activeCopyMealId).toBeUndefined();

    const copy2 = await again("g2");
    await tapAt(
      ana,
      [
        { type: "meal.transition", target: { mealId: copy2 }, to: "cooking" },
        { type: "meal.transition", target: { mealId: copy2 }, to: "done" },
      ],
      "2026-10-03T18:00:00Z",
    );
    const [row] = await listPastMeals(db, ana, {});
    expect(row).toMatchObject({ mealId: copy2, timesCooked: 2 });
    expect(row.activeCopyMealId).toBeUndefined();
    // Make again from the newest cook works again.
    const out = await makeMealAgain(db, ana, { tapId: "g3", basedOnVersion: await getKitchenVersion(db, ana), fromMealId: copy2 });
    expect(out.ok && out.result.rejected).toEqual([]);
  });

  it("RBX3: the after-cooking note and who wrote it, on Cooked before and the recipe", async () => {
    const t = await newKitchen(db, ["Ana", "Ben"]);
    const ana = await t.scope("Ana");
    const ben = await t.scope("Ben");
    const mealId = await cook(ana, "Green curry", [ing("coconut milk")], "2026-10-01T18:00:00Z");
    expect((await listPastMeals(db, ana, {}))[0].note).toBeUndefined();
    expect((await getRecipe(db, ana, mealId))?.note).toBeUndefined();

    // Ben adds it later from To review ("Do later"): meal.noted.
    await ok(db, ben, [{ type: "meal.transition", target: { mealId }, to: "done", note: "used half the coconut milk" }]);
    const note = { text: "used half the coconut milk", by: { id: t.userIds.Ben, name: "Ben" } };
    const [row] = await listPastMeals(db, ana, {});
    expect(row.note).toEqual(note);
    expect(row.lastCookedBy).toEqual({ id: t.userIds.Ana, name: "Ana" }); // the note doesn't change who cooked
    expect((await getRecipe(db, ana, mealId))?.note).toEqual(note);

    // A note written before migration 0011 reads as the cook's.
    await db.update(meals).set({ noteBy: null }).where(and(eq(meals.kitchenId, t.kitchenId), eq(meals.id, mealId)));
    expect((await listPastMeals(db, ana, {}))[0].note?.by).toEqual({ id: t.userIds.Ana, name: "Ana" });
  });

  it("the copy is flagged against today's allergies (computed on read)", async () => {
    const t = await newKitchen(db, ["Ana", "Ben"]);
    const ana = await t.scope("Ana");
    const ben = await t.scope("Ben");
    const sourceId = await cook(ana, "Satay", [ing("chicken"), ing("peanut butter")], "2026-10-02T18:00:00Z");
    await ok(db, ben, [{ type: "profile.restriction.add", evidence: "allergic to peanuts", fields: { kind: "allergy", subject: said("peanuts"), note: said("hives, not severe") } }], {
      text: "I'm allergic to peanuts",
    });
    const out = await makeMealAgain(db, ana, { tapId: "again-satay", basedOnVersion: await getKitchenVersion(db, ana), fromMealId: sourceId });
    if (!out.ok) throw new Error(out.error.reason.text);
    const newMealId = out.result.applied[0].refs[0].id;
    const flag = { ingredient: "peanut butter", userId: t.userIds.Ben, subject: "peanuts", note: "hives, not severe" };
    expect((await getRecipe(db, ana, newMealId))?.allergenFlags).toEqual([flag]);
    expect((await getKitchenState(db, ana)).meals.find((m) => m.id === newMealId)?.allergenFlags).toEqual([flag]);
  });

  it("a Done meal without a recipe makes a new meal with no recipe", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    const sourceId = await cook(ana, "Toast", [], "2026-10-01T08:00:00Z", { recipe: false });
    const out = await makeMealAgain(db, ana, { tapId: "again-toast", basedOnVersion: await getKitchenVersion(db, ana), fromMealId: sourceId });
    if (!out.ok) throw new Error(out.error.reason.text);
    expect(out.result.applied[0].refs.map((x) => x.kind)).toEqual(["meal"]);
    expect(await getRecipe(db, ana, out.result.applied[0].refs[0].id)).toBeNull();
  });

  it("refuses a meal that isn't Done, one from another kitchen, and an unknown ID; a double tap applies once", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    const live = (await ok(db, ana, [{ type: "meal.choose", target: { title: "Tacos" } }])).applied[0].refs[0].id;
    const other = await newKitchen(db, ["Ben"]);
    const theirs = await cook(await other.scope("Ben"), "Stew", [ing("beef")], "2026-10-01T18:00:00Z");
    const tryAgain = async (fromMealId: string, tapId: string) => {
      const out = await makeMealAgain(db, ana, { tapId, basedOnVersion: await getKitchenVersion(db, ana), fromMealId });
      if (!out.ok) throw new Error(out.error.reason.text);
      return out.result;
    };
    expect(codes(await tryAgain(live, "a1"))).toEqual(["INVALID_OPERATION"]);
    expect(codes(await tryAgain(theirs, "a2"))).toEqual(["UNKNOWN_TARGET"]);
    expect(codes(await tryAgain("no-such-meal", "a3"))).toEqual(["UNKNOWN_TARGET"]);

    const done = await cook(ana, "Rice bowl", [ing("rice")], "2026-10-03T18:00:00Z");
    const first = await tryAgain(done, "dbl");
    const second = await tryAgain(done, "dbl");
    expect(second.changeSetId).toBe(first.changeSetId);
    expect((await getKitchenState(db, ana)).meals.filter((m) => m.title === "Rice bowl")).toHaveLength(1);
  });

  it("works from chat with evidence, like any operation", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    const sourceId = await cook(ana, "Chicken curry", [ing("chicken")], "2026-10-01T18:00:00Z");
    const r = await ok(db, ana, [{ type: "meal.makeAgain", fromMealId: sourceId }], { text: "make the chicken curry again" });
    expect(r.applied[0].summary.text).toBe("Making Chicken curry again");
  });
});
