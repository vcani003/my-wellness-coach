/**
 * Integration tests on an embedded Postgres (PGlite) with the real migrations:
 * idempotent retry, cross-kitchen denial, Undo, two writers, defensive reads, projections.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { changeSets, checklistTicks, events, items, kitchens, meals, users } from "@/db/schema";
import { applyProposedChange, rebuildProjections, recordMealIdeas, undo } from "@/domains/kitchen/commands";
import { getChangesSince, getKitchenState, getKitchenVersion, getRecipe } from "@/domains/kitchen/queries";
import { addMember, createUser } from "@/shared/identity";
import { NotAMemberError, requireMember } from "@/shared/membership";
import { afterCooking, primaryJourney } from "../support/fixtures";
import { said } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb, send } from "../support/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

/** The fixture ideas without fixed IDs, so each test stores its own. */
const freshIdeas = () => primaryJourney.ideas.map(({ name, why, uses, missing }) => ({ name, why, uses, missing }));
const rejectedCodes = (r: { rejected: { reason: { code: string } }[] }) => r.rejected.map((x) => x.reason.code);

describe("the primary journey on Postgres", () => {
  it("saves events and projections that match", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    await ok(db, vero, primaryJourney.bought.ops, { text: primaryJourney.bought.text });
    const froze = await ok(db, vero, primaryJourney.froze.ops, { text: primaryJourney.froze.text });
    expect(froze.rejected).toEqual([]);
    const { ideas } = await recordMealIdeas(db, vero, { basedOnVersion: 2, ideas: freshIdeas() });
    const chose = await ok(db, vero, primaryJourney.choose(ideas[0].ideaId));
    const mealId = chose.applied[0].refs[0].id;
    const planned = await ok(db, vero, primaryJourney.addToPlan.ops(mealId), { text: primaryJourney.addToPlan.text });

    expect(planned.newVersion).toBe(4);
    expect(planned.state.plan).toEqual([mealId]);
    expect(planned.state.items.find((i) => i.name.value === "chicken thighs")?.location?.value).toBe("freezer");
    expect(planned.state.items[0].createdBy).toEqual({ id: t.userIds.Vero, name: "Vero" });

    // The projection equals a full replay of the log.
    const before = await getKitchenState(db, vero);
    await rebuildProjections(db, vero);
    expect(await getKitchenState(db, vero)).toEqual(before);
    expect(before).toEqual(planned.state);
  });

  it("after cooking: recipe, cooking, done with stock levels and a note", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    const bought = await ok(db, vero, primaryJourney.bought.ops, { text: primaryJourney.bought.text });
    const chickenId = bought.applied[1].refs[0].id;
    const spinachId = bought.applied[2].refs[0].id;
    const { ideas } = await recordMealIdeas(db, vero, { basedOnVersion: 1, ideas: freshIdeas().slice(0, 1) });
    const mealId = (await ok(db, vero, primaryJourney.choose(ideas[0].ideaId))).applied[0].refs[0].id;
    await ok(db, vero, afterCooking.recipe(mealId, chickenId));
    await ok(db, vero, afterCooking.startCooking(mealId));
    const done = await ok(db, vero, afterCooking.finish(mealId, chickenId, spinachId));
    expect(done.rejected).toEqual([]);
    expect(done.state.items.map((i) => i.name.value).sort()).toEqual(["eggs", "spinach", "yogurt"]);
    expect(done.state.items.find((i) => i.id === spinachId)?.stock?.value).toBe("low");
    const recipe = await getRecipe(db, vero, mealId);
    expect(recipe?.ingredients.find((i) => i.name === "chicken thighs")?.item).toEqual({ id: chickenId, name: "chicken thighs" });
  });
});

describe("idempotent retry", () => {
  it("the same proposalId applies once and replays the stored result", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    const first = await ok(db, vero, [{ type: "item.add", fields: { name: said("eggs") } }], { text: "eggs", proposalId: "msg-1" });
    const retry = await ok(db, vero, [{ type: "item.add", fields: { name: said("eggs") } }], {
      text: "eggs",
      proposalId: "msg-1",
      basedOnVersion: 0,
    });
    expect(retry.changeSetId).toBe(first.changeSetId);
    expect(retry.newVersion).toBe(1);
    expect(retry.state.items).toHaveLength(1);
    expect(await getKitchenVersion(db, vero)).toBe(1);
    const rows = await db.select().from(events).where(eq(events.stream, `kitchen:${t.kitchenId}`));
    expect(rows).toHaveLength(1);
  });
});

describe("cross-kitchen denial", () => {
  it("a member of one kitchen can't reach another", async () => {
    const a = await newKitchen(db);
    const b = await newKitchen(db);
    await expect(requireMember(db, a.userIds.Vero, b.kitchenId)).rejects.toBeInstanceOf(NotAMemberError);
    await expect(requireMember(db, a.userIds.Vero, "no-such-kitchen")).rejects.toBeInstanceOf(NotAMemberError);

    // A proposal for kitchen B through A's scope is refused, and B is unchanged.
    const scopeA = await a.scope("Vero");
    const out = await applyProposedChange(db, scopeA, {
      proposalId: "x",
      kitchenId: b.kitchenId,
      basedOnVersion: 0,
      source: { via: "button", action: "test" },
      operations: [{ opId: "1", type: "item.add", fields: { name: said("eggs") } }],
    });
    expect(out).toEqual({ ok: false, error: { reason: expect.objectContaining({ code: "NOT_ALLOWED" }), retryable: false } });
    expect((await getKitchenState(db, await b.scope("Vero"))).items).toEqual([]);
  });

  it("a tester account can't join a real kitchen (database trigger and requireMember)", async () => {
    const real = await newKitchen(db);
    await createUser(db, { id: `tester-${real.kitchenId}`, displayName: "Tester", isTest: true });
    await expect(addMember(db, real.kitchenId, `tester-${real.kitchenId}`)).rejects.toThrow();
    await expect(requireMember(db, `tester-${real.kitchenId}`, real.kitchenId)).rejects.toBeInstanceOf(NotAMemberError);
  });

  it("a malformed proposal is refused without saving", async () => {
    const t = await newKitchen(db);
    const out = await applyProposedChange(db, await t.scope("Vero"), { proposalId: "x", operations: "nope" });
    expect(out.ok).toBe(false);
  });
});

describe("Undo", () => {
  it("undoes your own change set; a second undo is refused", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    await ok(db, vero, [{ type: "item.add", fields: { name: said("milk") } }], { text: "milk" });
    const bought = await ok(db, vero, primaryJourney.bought.ops, { text: primaryJourney.bought.text });
    const undone = await undo(db, vero, { changeSetId: bought.changeSetId, tapId: "tap-1", basedOnVersion: 2 });
    if (!undone.ok) throw new Error("undo failed");
    expect(undone.result.applied[0].summary.code).toBe("UNDONE");
    expect(undone.result.undoable).toBe(false);
    expect(undone.result.state.items.map((i) => i.name.value)).toEqual(["milk"]);
    expect(undone.result.newVersion).toBe(3);

    const again = await undo(db, vero, { changeSetId: bought.changeSetId, tapId: "tap-2", basedOnVersion: 3 });
    expect(again.ok && rejectedCodes(again.result)).toEqual(["ALREADY_UNDONE"]);

    const feed = await getChangesSince(db, vero, 1);
    expect(feed.map((c) => [c.version, c.undone])).toEqual([
      [2, true],
      [3, false],
    ]);
  });

  it("refused with a reason when a later change touched the same items; allowed after undoing that", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    const add = await ok(db, vero, [{ type: "item.add", fields: { name: said("eggs") } }], { text: "eggs" });
    const use = await ok(db, vero, [{ type: "item.use", target: { name: "eggs" }, fields: { stock: said("low") } }], { text: "eggs" });

    const blocked = await undo(db, vero, { changeSetId: add.changeSetId, tapId: "u1", basedOnVersion: 2 });
    if (!blocked.ok) throw new Error("expected a result");
    expect(rejectedCodes(blocked.result)).toEqual(["UNDO_CONFLICT"]);
    expect(blocked.result.rejected[0].reason.text).toMatch(/Can't undo/);
    expect(blocked.result.newVersion).toBe(2); // nothing changed

    await undo(db, vero, { changeSetId: use.changeSetId, tapId: "u2", basedOnVersion: 2 });
    const now = await undo(db, vero, { changeSetId: add.changeSetId, tapId: "u3", basedOnVersion: 3 });
    expect(now.ok && now.result.state.items).toEqual([]);

    // Replaying the log (including the reverts) still matches the projections.
    const live = await getKitchenState(db, vero);
    await rebuildProjections(db, vero);
    expect(await getKitchenState(db, vero)).toEqual(live);
  });

  it("can't undo someone else's change (H3)", async () => {
    const t = await newKitchen(db, ["Vero", "Sam"]);
    const sam = await t.scope("Sam");
    const vero = await t.scope("Vero");
    const added = await ok(db, sam, [{ type: "item.add", fields: { name: said("bread") } }], { text: "bread" });
    const out = await undo(db, vero, { changeSetId: added.changeSetId, tapId: "u", basedOnVersion: 1 });
    expect(out.ok && rejectedCodes(out.result)).toEqual(["NOT_ALLOWED"]);
  });

  it("undoing an allergy restores the profile", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    const saved = await ok(db, vero, [{ type: "profile.restriction.add", fields: { kind: "allergy", subject: said("peanuts") } }], {
      text: "I'm allergic to peanuts",
    });
    const { ideas } = await recordMealIdeas(db, vero, { basedOnVersion: 1, ideas: [{ name: "Peanut noodles", why: "", uses: [], missing: [] }] });
    expect(ideas[0].allergenFlags).toHaveLength(1);
    await undo(db, vero, { changeSetId: saved.changeSetId, tapId: "u", basedOnVersion: 1 });
    const again = await recordMealIdeas(db, vero, { basedOnVersion: 2, ideas: [{ name: "Peanut noodles", why: "", uses: [], missing: [] }] });
    expect(again.ideas[0].allergenFlags).toEqual([]);
  });
});

describe("two writers on one kitchen", () => {
  it("both based on the same version: both apply, seq and version never collide", async () => {
    const t = await newKitchen(db, ["Vero", "Sam"]);
    const vero = await t.scope("Vero");
    const sam = await t.scope("Sam");
    const [a, b] = await Promise.all([
      send(db, vero, [{ type: "item.add", fields: { name: said("apples") } }], { text: "apples", basedOnVersion: 0 }),
      send(db, sam, [{ type: "item.add", fields: { name: said("bananas") } }], { text: "bananas", basedOnVersion: 0 }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const versions = [a, b].map((x) => (x.ok ? x.result.newVersion : -1)).sort();
    expect(versions).toEqual([1, 2]);
    const seqs = (await db.select({ seq: events.seq }).from(events).where(eq(events.stream, `kitchen:${t.kitchenId}`))).map((r) => r.seq).sort();
    expect(seqs).toEqual([1, 2]);
  });

  it("the second writer's stale ID target is rejected; name targets are re-matched", async () => {
    const t = await newKitchen(db, ["Vero", "Sam"]);
    const vero = await t.scope("Vero");
    const sam = await t.scope("Sam");
    const added = await ok(db, vero, [{ type: "item.add", fields: { name: said("eggs") } }], { text: "eggs" });
    const eggsId = added.applied[0].refs[0].id;
    // Both saw version 1. Vero lands first.
    await ok(db, vero, [{ type: "item.use", target: { itemId: eggsId }, fields: { stock: said("low") } }], { text: "eggs", basedOnVersion: 1 });
    const late = await ok(
      db,
      sam,
      [
        { type: "item.update", target: { itemId: eggsId }, fields: { location: said("fridge") } },
        { type: "item.add", fields: { name: said("bread") } },
      ],
      { text: "eggs bread", basedOnVersion: 1 },
    );
    expect(rejectedCodes(late)).toEqual(["STALE_TARGET"]);
    expect(late.applied.map((x) => x.opId)).toEqual(["op-2"]);
  });

  it("a failed write leaves the kitchen unchanged (all or nothing)", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    await ok(db, vero, [{ type: "item.add", fields: { name: said("eggs") } }], { text: "eggs" });
    // Simulate a database failure mid-write: the projection insert raises after the events went in.
    await db.execute(sql`create or replace function fail_items() returns trigger as $$ begin raise exception 'boom'; end; $$ language plpgsql`);
    await db.execute(sql`create trigger fail_items_trg before insert on items for each row execute function fail_items()`);
    try {
      const out = await send(db, vero, [{ type: "item.add", fields: { name: said("bread") } }], { text: "bread" });
      expect(out).toEqual({ ok: false, error: { reason: expect.objectContaining({ code: "SAVE_FAILED" }), retryable: true } });
    } finally {
      await db.execute(sql`drop trigger fail_items_trg on items`);
    }
    expect(await getKitchenVersion(db, vero)).toBe(1);
    expect(await db.select().from(events).where(eq(events.stream, `kitchen:${t.kitchenId}`))).toHaveLength(1);
    expect(await db.select().from(changeSets).where(eq(changeSets.kitchenId, t.kitchenId))).toHaveLength(1);
  });
});

describe("defensive reads (0018)", () => {
  it("missing referenced rows come back as {id, missing: true}; bad rows are dropped", async () => {
    const t = await newKitchen(db, ["Vero", "Sam"]);
    const vero = await t.scope("Vero");
    const sam = await t.scope("Sam");
    const bought = await ok(db, sam, primaryJourney.bought.ops, { text: primaryJourney.bought.text });
    const chickenId = bought.applied[1].refs[0].id;
    const { ideas } = await recordMealIdeas(db, vero, { basedOnVersion: 1, ideas: freshIdeas().slice(0, 1) });
    const mealId = (await ok(db, vero, primaryJourney.choose(ideas[0].ideaId))).applied[0].refs[0].id;
    await ok(db, vero, afterCooking.recipe(mealId, chickenId));
    await ok(db, vero, [
      { type: "checklist.tick", target: { mealId }, ingredient: "onion", ticked: true },
      { type: "review.queue", kind: "add-to-kitchen", mealId, items: [{ name: "onion" }] },
    ]);

    // Break things underneath the read path.
    await db.delete(users).where(eq(users.id, t.userIds.Sam)); // a deleted member
    await db.delete(meals).where(eq(meals.id, mealId)); // a missing meal
    await db.delete(items).where(eq(items.id, chickenId)); // a missing item
    await db.execute(sql`update items set location = '{"value":"garage","basis":"said","confidence":"high"}'::jsonb
      where kitchen_id = ${t.kitchenId} and standard_name = 'egg'`); // a corrupt row
    await db.execute(sql`update item_batches set location = '{"value":"garage","basis":"said","confidence":"high"}'::jsonb
      where kitchen_id = ${t.kitchenId} and item_id in (select id from items where standard_name = 'egg')`); // …and its batch (0025)

    const state = await getKitchenState(db, vero);
    expect(state.items.map((i) => i.name.value).sort()).toEqual(["spinach", "yogurt"]); // eggs dropped, chicken gone
    expect(state.items[0].createdBy).toEqual({ id: t.userIds.Sam, missing: true });
    expect(state.ticks[0].meal).toEqual({ id: mealId, missing: true });
    expect(state.toReview[0].meal).toEqual({ id: mealId, missing: true });

    const recipe = await getRecipe(db, vero, mealId);
    expect(recipe?.meal).toEqual({ id: mealId, missing: true });
    expect(recipe?.ingredients[0].item).toEqual({ id: chickenId, missing: true });

    expect(await getRecipe(db, vero, "no-such-meal")).toBeNull();
    // Writing still works on top of the broken rows.
    expect((await send(db, vero, [{ type: "item.add", fields: { name: said("rice") } }], { text: "rice" })).ok).toBe(true);
    // And rebuilding from the log repairs the projections.
    await rebuildProjections(db, vero);
    const repaired = await getKitchenState(db, vero);
    expect(repaired.items.map((i) => i.name.value).sort()).toEqual(["chicken thighs", "eggs", "rice", "spinach", "yogurt"]);
    expect(repaired.ticks[0].meal).toEqual({ id: mealId, title: "Chicken and spinach curry" });
  });

  it("events are append-only", async () => {
    const t = await newKitchen(db);
    await ok(db, await t.scope("Vero"), [{ type: "item.add", fields: { name: said("eggs") } }], { text: "eggs" });
    await expect(
      db.update(events).set({ type: "hacked" }).where(eq(events.stream, `kitchen:${t.kitchenId}`)),
    ).rejects.toThrow();
  });
});

describe("household kitchen (two members, 0021)", () => {
  it("shared items and ticks, private Undo, every member's allergies", async () => {
    const t = await newKitchen(db, ["Vero", "Sam"]);
    const vero = await t.scope("Vero");
    const sam = await t.scope("Sam");

    // One adds an item and the other sees it, with who added it.
    await ok(db, sam, [{ type: "item.add", fields: { name: said("shrimp"), location: said("freezer") } }], { text: "I bought shrimp" });
    const seen = await getKitchenState(db, vero);
    expect(seen.items.map((i) => [i.name.value, i.createdBy])).toEqual([["shrimp", { id: t.userIds.Sam, name: "Sam" }]]);
    expect(await getChangesSince(db, vero, 0)).toEqual([
      expect.objectContaining({ actor: { id: t.userIds.Sam, name: "Sam" }, summaries: [expect.objectContaining({ text: "Added shrimp" })] }),
    ]);

    // Sam's seafood allergy, with his own note.
    await ok(
      db,
      sam,
      [
        {
          type: "profile.restriction.add",
          evidence: "allergic to seafood",
          fields: { kind: "allergy", subject: said("seafood"), note: said("can eat shellfish if medicine is on hand") },
        },
      ],
      { text: "I'm allergic to seafood but can eat shellfish if medicine is on hand" },
    );

    // Vero chooses shrimp tacos: flagged with Sam's allergy and note.
    const { ideas } = await recordMealIdeas(db, vero, { basedOnVersion: 2, ideas: [{ name: "Shrimp tacos", why: "Uses shrimp", uses: [], missing: [] }] });
    expect(ideas[0].allergenFlags[0]).toMatchObject({ userId: t.userIds.Sam, subject: "seafood" });
    const chose = await ok(db, vero, [{ type: "meal.choose", target: { ideaId: ideas[0].ideaId } }]);
    const meal = chose.state.meals[0];
    expect(meal.allergenFlags).toEqual([
      { ingredient: "Shrimp tacos", userId: t.userIds.Sam, subject: "seafood", note: "can eat shellfish if medicine is on hand" },
    ]);

    // Ticks are shared.
    await ok(db, sam, [{ type: "checklist.tick", target: { mealId: meal.id }, ingredient: "tortillas", ticked: true }]);
    const ticks = (await getKitchenState(db, vero)).ticks;
    expect(ticks).toEqual([expect.objectContaining({ ingredient: "tortillas", updatedBy: { id: t.userIds.Sam, name: "Sam" } })]);
    expect(await db.select().from(checklistTicks).where(and(eq(checklistTicks.kitchenId, t.kitchenId)))).toHaveLength(1);

    // Vero can't remove Sam's allergy; she can add one for him.
    const removal = await ok(
      db,
      vero,
      [{ type: "profile.restriction.remove", forUserId: t.userIds.Sam, fields: { kind: "allergy", subject: said("seafood") } }],
      { text: "remove Sam's seafood allergy" },
    );
    expect(rejectedCodes(removal)).toEqual(["NOT_ALLOWED"]);
    const forSam = await ok(
      db,
      vero,
      [{ type: "profile.restriction.add", evidence: "Sam is allergic to peanuts", forUserId: t.userIds.Sam, fields: { kind: "allergy", subject: said("peanuts") } }],
      { text: "Sam is allergic to peanuts" },
    );
    expect(forSam.rejected).toEqual([]);
    const [kitchenRow] = await db.select().from(kitchens).where(eq(kitchens.id, t.kitchenId));
    expect(kitchenRow.version).toBe(forSam.newVersion);
  });
});
