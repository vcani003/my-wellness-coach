/**
 * Kitchen infers where things go (0041) on Postgres (PGlite, the real migrations):
 * - a said place is stored in `item_location_prefs`, used for the next add, and Undo forgets it;
 *   projections == replay;
 * - "Not sure where" is sorted once per kitchen: one change set (events logged), a chat message
 *   with the receipt and Undo for the person it ran for, nothing for anyone else, never again
 *   (not even after Undo), never touching a place that's set, and safe when two loads race.
 * People are fictional (Ana, Ben).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import { changeSets, events, itemLocationPrefs } from "@/db/schema";
import { listChatHistory } from "@/domains/chat/queries";
import { rebuildProjections, undo } from "@/domains/kitchen/commands";
import { getKitchenState } from "@/domains/kitchen/queries";
import { placesSortProposalId } from "@/domains/kitchen/sort-places";
import { sortUnplacedOnce } from "@/server/places-sort";
import type { KitchenScope } from "@/shared/membership";
import { said } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb } from "../support/db";
import { journalTags, migrationsUpTo, publicTables } from "../support/migrations";

const medium = (value: string) => ({ value, basis: "inferred", confidence: "medium" });

describe("migration 0012 (0041): additive, on top of a database already at 0011", () => {
  it("applies after 0011 and adds only the empty item_location_prefs table", async () => {
    const tags = journalTags();
    expect(tags.indexOf("0012_item_location_prefs")).toBe(tags.indexOf("0011_recipe_box") + 1);
    const at0011 = migrationsUpTo("0011_recipe_box");
    const at0012 = migrationsUpTo("0012_item_location_prefs");
    const { db: old, close: closeOld } = await openLocalDb({ migrationsFolder: at0011.dir });
    try {
      const before = await publicTables(old);
      expect(before).not.toContain("item_location_prefs");
      await migrate(old as unknown as Parameters<typeof migrate>[0], { migrationsFolder: at0012.dir });
      expect(await publicTables(old)).toEqual([...before, "item_location_prefs"].sort());
      expect(await old.select().from(itemLocationPrefs)).toEqual([]);
    } finally {
      await closeOld();
      at0011.cleanup();
      at0012.cleanup();
    }
  });
});

describe("places on Postgres (0041)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openLocalDb());
  });
  afterAll(async () => {
    await close();
  });

  const prefs = (kitchenId: string) =>
    db.select({ standardName: itemLocationPrefs.standardName, location: itemLocationPrefs.location }).from(itemLocationPrefs).where(eq(itemLocationPrefs.kitchenId, kitchenId));
  const places = async (scope: KitchenScope) =>
    Object.fromEntries((await getKitchenState(db, scope)).items.map((i) => [i.name.value, i.location ?? null]));

  /** A kitchen as an older build left it: things with no place, plus one the user placed. */
  async function legacyKitchen() {
    const t = await newKitchen(db, ["Ana", "Ben"]);
    const ana = await t.scope("Ana");
    const ben = await t.scope("Ben");
    await ok(db, ana, ["milk", "jasmine rice", "nước mắm", "sparkling water"].map((n) => ({ type: "item.add" as const, fields: { name: said(n) } })), { text: "bought milk, jasmine rice, nước mắm and sparkling water" });
    await ok(db, ana, [{ type: "item.add", fields: { name: said("eggs"), location: said("pantry") } }], { text: "eggs, in the pantry" });
    // Before 0041 nothing was placed: clear the inferred places to get back to that.
    await ok(db, ana, ["milk", "jasmine rice", "nước mắm"].map((name) => ({ type: "item.update" as const, target: { name }, fields: {}, clear: ["location" as const] })));
    return { t, ana, ben };
  }

  it("adds get the usual place; a said place is remembered, used next time, and Undo forgets it", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    await ok(db, ana, [{ type: "item.add", fields: { name: said("milk") } }], { text: "bought milk" });
    expect(await places(ana)).toEqual({ milk: medium("fridge") });

    const habit = await ok(db, ana, [{ type: "item.update", target: { name: "onions" }, fields: { location: said("pantry") } }], { text: "onions go in the pantry" });
    expect(habit.applied[0].summary.code).toBe("PLACE_REMEMBERED");
    expect(await prefs(t.kitchenId)).toEqual([{ standardName: "onion", location: "pantry" }]);

    const before = await getKitchenState(db, ana);
    await rebuildProjections(db, ana);
    expect(await getKitchenState(db, ana)).toEqual(before);
    expect(await prefs(t.kitchenId)).toEqual([{ standardName: "onion", location: "pantry" }]);

    await ok(db, ana, [{ type: "item.add", fields: { name: said("onions"), location: { value: "fridge", basis: "inferred", confidence: "medium" } } }], { text: "bought onions" });
    expect((await places(ana)).onions).toEqual({ value: "pantry", basis: "inferred", confidence: "high" });

    const undone = await undo(db, ana, { changeSetId: habit.changeSetId, tapId: `tap-${randomUUID()}`, basedOnVersion: (await getKitchenState(db, ana)).version });
    expect(undone.ok).toBe(true);
    expect(await prefs(t.kitchenId)).toEqual([]);
  });

  it("sorts 'Not sure where' once: one change set, a receipt for Ana, nothing for Ben, never again", async () => {
    const { t, ana, ben } = await legacyKitchen();
    expect(await places(ana)).toMatchObject({ milk: null, "jasmine rice": null, "nước mắm": null, "sparkling water": null, eggs: said("pantry") });

    const first = await sortUnplacedOnce(db, ana);
    if (!first.ran) throw new Error("expected the sort to run");
    expect(first.moves.map((m) => [m.name, m.location.value])).toEqual([
      ["jasmine rice", "pantry"],
      ["milk", "fridge"],
      ["nước mắm", "pantry"],
    ]);
    expect(first.unplaced).toBe(1);
    expect(first.messageSaved).toBe(true);
    expect(first.result.undoable).toBe(true);
    expect(await places(ana)).toEqual({
      milk: medium("fridge"),
      "jasmine rice": medium("pantry"),
      "nước mắm": medium("pantry"),
      "sparkling water": null, // genuinely depends: stays "Not sure where"
      eggs: said("pantry"), // a place already set is never touched
    });

    // One change set, by Ana, from a button-like source, with its events logged.
    const [cs] = await db.select().from(changeSets).where(and(eq(changeSets.kitchenId, t.kitchenId), eq(changeSets.proposalId, placesSortProposalId(t.kitchenId))));
    expect(cs).toMatchObject({ actorId: ana.userId, via: "button" });
    const logged = await db.select({ type: events.type }).from(events).where(eq(events.changeSetId, cs.id));
    expect(logged.map((e) => e.type)).toEqual(["item.updated", "item.updated", "item.updated"]);
    expect(await prefs(t.kitchenId)).toEqual([{ standardName: "egg", location: "pantry" }]); // a guess is never remembered

    // Ana's chat has the message and its receipt (with Undo); Ben's has nothing.
    const anaChat = (await listChatHistory(db, ana)).messages;
    expect(anaChat.at(-1)).toMatchObject({
      role: "assistant",
      text: 'I sorted 3 items from "Not sure where" into their usual places: 1 to the Fridge and 2 to the Pantry. One thing stays under "Not sure where". If something\'s in the wrong place, tap Undo or tell me where it goes.',
      receipt: { changeSetId: cs.id, undoable: true, undone: false },
    });
    expect(anaChat.at(-1)!.receipt!.applied.map((a) => a.summary.text)).toEqual(["jasmine rice → pantry", "milk → fridge", "nước mắm → pantry"]);
    expect((await listChatHistory(db, ben)).messages).toEqual([]);

    // Never again: not for Ana, not for Ben.
    expect(await sortUnplacedOnce(db, ana)).toEqual({ ran: false });
    expect(await sortUnplacedOnce(db, ben)).toEqual({ ran: false });

    // Undo puts them back, and they stay back.
    const undone = await undo(db, ana, { changeSetId: cs.id, tapId: `tap-${randomUUID()}`, basedOnVersion: (await getKitchenState(db, ana)).version });
    expect(undone.ok).toBe(true);
    expect(await places(ana)).toMatchObject({ milk: null, "jasmine rice": null, "nước mắm": null, eggs: said("pantry") });
    expect(await sortUnplacedOnce(db, ana)).toEqual({ ran: false });
    expect((await getKitchenState(db, ana)).items.find((i) => i.name.value === "milk")?.location).toBeUndefined();
  });

  it("two loads at once sort once, with one message", async () => {
    const { t, ana } = await legacyKitchen();
    const [a, b] = await Promise.all([sortUnplacedOnce(db, ana), sortUnplacedOnce(db, ana)]);
    expect([a.ran, b.ran].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    const sets = await db.select().from(changeSets).where(and(eq(changeSets.kitchenId, t.kitchenId), eq(changeSets.proposalId, placesSortProposalId(t.kitchenId))));
    expect(sets).toHaveLength(1);
    expect((await listChatHistory(db, ana)).messages.filter((m) => m.text.startsWith("I sorted"))).toHaveLength(1);
  });

  it("a kitchen with nothing unplaced does nothing (no change set, no message)", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    await ok(db, ana, [{ type: "item.add", fields: { name: said("milk") } }], { text: "bought milk" });
    expect(await sortUnplacedOnce(db, ana)).toEqual({ ran: false });
    expect(await db.select().from(changeSets).where(eq(changeSets.proposalId, placesSortProposalId(t.kitchenId)))).toEqual([]);
  });

  it("only ambiguous things unplaced: marks the kitchen done with an empty change set and says nothing", async () => {
    const t = await newKitchen(db, ["Ana"]);
    const ana = await t.scope("Ana");
    await ok(db, ana, [{ type: "item.add", fields: { name: said("sparkling water") } }], { text: "bought sparkling water" });
    const out = await sortUnplacedOnce(db, ana);
    expect(out).toMatchObject({ ran: true, moves: [], messageSaved: false });
    expect(await sortUnplacedOnce(db, ana)).toEqual({ ran: false });
    expect((await listChatHistory(db, ana)).messages).toEqual([]);
  });
});
