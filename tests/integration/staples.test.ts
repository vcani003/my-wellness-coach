/**
 * Smart staples (0054) on Postgres (PGlite, the real migrations):
 * - migration 0014 is additive: one new, empty `staples` table on top of a database at 0012;
 * - the button commands are one change set each with Undo, projections == replay, and the list is
 *   shared by the kitchen (SS1), with Undo for your own changes only (0017);
 * - Restock puts the chosen staples on the list in one change set with one Undo, each under its
 *   usual store (SS3, SS5), merging with what's already there;
 * - the old "Staples: …" preference line is offered once and moves only on a tap (SS2);
 * - chat: a said staple saves, "what staples do I need?" answers from them with the `staples`
 *   event (SS6), and a chat Out receipt carries "Add X to my list" without adding it (SS4).
 * People are fictional (Ana, Ben).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import { staples as staplesTable } from "@/db/schema";
import type { StreamEvent } from "@/contracts/stream";
import { getInterpreter, handleChatTurn } from "@/ai";
import { listChatHistory } from "@/domains/chat/queries";
import {
  addStapleItems,
  answerLegacyStaples,
  getLegacyStaplesOffer,
  rebuildProjections,
  removeStapleItem,
  restockFromStaples,
  undo,
  updateStapleStore,
} from "@/domains/kitchen/commands";
import { getKitchenState, getKitchenVersion } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { said } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb } from "../support/db";
import { journalTags, migrationsUpTo, publicTables } from "../support/migrations";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

const tapId = () => `tap-${randomUUID().slice(0, 12)}`;
const version = (scope: KitchenScope) => getKitchenVersion(db, scope);
async function must<T extends { ok: boolean }>(p: Promise<T>) {
  const out = await p;
  if (!out.ok) throw new Error(`failed: ${JSON.stringify(out)}`);
  return (out as unknown as { result: import("@/contracts/apply-result").ApplyResult }).result;
}

async function kitchen() {
  const t = await newKitchen(db, ["Ana", "Ben"]);
  return { t, ana: await t.scope("Ana"), ben: await t.scope("Ben") };
}

describe("migration 0014 (0054): additive, on top of a database at 0012", () => {
  it("adds only the empty staples table", async () => {
    expect(journalTags()).toContain("0014_staples");
    const at0012 = migrationsUpTo("0012_item_location_prefs");
    const { db: old, close: closeOld } = await openLocalDb({ migrationsFolder: at0012.dir });
    try {
      const before = await publicTables(old);
      expect(before).not.toContain("staples");
      const at0014 = migrationsUpTo("0014_staples");
      try {
        await migrate(old as unknown as Parameters<typeof migrate>[0], { migrationsFolder: at0014.dir });
      } finally {
        at0014.cleanup();
      }
      expect(await publicTables(old)).toEqual([...before, "staples"].sort());
      expect(await old.select().from(staplesTable)).toEqual([]);
    } finally {
      await closeOld();
      at0012.cleanup();
    }
  });
});

describe("staple buttons: one shared list with Undo (SS1, SS5)", () => {
  it("add, store, remove: each one change set; Ben sees and edits Ana's list; Undo is your own only", async () => {
    const { ana, ben } = await kitchen();
    const added = await must(addStapleItems(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), items: [{ name: "fish sauce", store: "MD Oriental" }, { name: "eggs" }] }));
    expect(added.undoable).toBe(true);
    expect(added.applied.map((a) => a.summary.code)).toEqual(["STAPLE_ADDED_STORE", "STAPLE_ADDED"]);
    // In the order added; added together, by standard name.
    expect(added.state.staples.map((s) => [s.id, s.store?.value, s.need, "name" in s.createdBy && s.createdBy.name])).toEqual([
      ["egg", undefined, "missing", "Ana"],
      ["fish sauce", "MD Oriental", "missing", "Ana"],
    ]);

    // Ben sees the same list and sets a store on Ana's staple.
    expect((await getKitchenState(db, ben)).staples).toHaveLength(2);
    const store = await must(updateStapleStore(db, ben, { tapId: tapId(), basedOnVersion: await version(ben), stapleId: "egg", store: "Publix" }));
    expect(store.applied[0].summary.code).toBe("STAPLE_STORE");
    // Ana can't undo Ben's change (H3, 0017)...
    const notMine = await must(undo(db, ana, { changeSetId: store.changeSetId, tapId: tapId(), basedOnVersion: store.newVersion }));
    expect(notMine.rejected[0].reason.code).toBe("NOT_ALLOWED");
    // ...Ben can.
    const back = await must(undo(db, ben, { changeSetId: store.changeSetId, tapId: tapId(), basedOnVersion: store.newVersion }));
    expect(back.state.staples.find((s) => s.id === "egg")!.store).toBeUndefined();

    const removed = await must(removeStapleItem(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), stapleId: "fish sauce" }));
    expect(removed.state.staples.map((s) => s.id)).toEqual(["egg"]);
    const again = await must(undo(db, ana, { changeSetId: removed.changeSetId, tapId: tapId(), basedOnVersion: removed.newVersion }));
    expect(again.state.staples.find((s) => s.id === "fish sauce")).toMatchObject({ store: said("MD Oriental"), createdBy: { name: "Ana" } });

    const before = await getKitchenState(db, ana);
    await rebuildProjections(db, ana);
    expect(await getKitchenState(db, ana)).toEqual(before);
  });

  it("a double tap is harmless; clearing the store; an unknown staple is refused", async () => {
    const { ana } = await kitchen();
    const id = tapId();
    const v = await version(ana);
    const first = await must(addStapleItems(db, ana, { tapId: id, basedOnVersion: v, items: [{ name: "rice", store: "Costco" }] }));
    const twice = await must(addStapleItems(db, ana, { tapId: id, basedOnVersion: v, items: [{ name: "rice", store: "Costco" }] }));
    expect(twice.changeSetId).toBe(first.changeSetId);
    const cleared = await must(updateStapleStore(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), stapleId: "rice", store: null }));
    expect(cleared.applied[0].summary.code).toBe("STAPLE_STORE_CLEARED");
    const unknown = await must(removeStapleItem(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), stapleId: "tofu" }));
    expect(unknown.rejected[0].reason.code).toBe("UNKNOWN_TARGET");
  });
});

describe("Restock (SS3): one change set, one Undo", () => {
  it("adds the chosen staples under their usual store, merges with the list, and undoes together", async () => {
    const { ana, ben } = await kitchen();
    await ok(db, ana, [
      { type: "item.add", fields: { name: said("jasmine rice") } },
      { type: "item.add", fields: { name: said("eggs") } },
    ]);
    await ok(db, ana, [{ type: "item.stock.set", target: { name: "jasmine rice" }, fields: { stock: said("low") } }]);
    await ok(db, ben, [{ type: "shopping.add", fields: { name: said("garlic") } }]);
    const s = await must(
      addStapleItems(db, ana, {
        tapId: tapId(),
        basedOnVersion: await version(ana),
        items: [{ name: "fish sauce", store: "MD Oriental" }, { name: "jasmine rice" }, { name: "eggs" }, { name: "garlic" }],
      }),
    );
    expect(Object.fromEntries(s.state.staples.map((x) => [x.id, x.need]))).toEqual({
      "fish sauce": "missing",
      "jasmine rice": "low",
      egg: "have",
      garlic: "on-list",
    });

    const restock = await must(restockFromStaples(db, ana, { tapId: tapId(), basedOnVersion: s.newVersion, stapleIds: ["fish sauce", "jasmine rice", "garlic"] }));
    expect(restock.undoable).toBe(true);
    expect(restock.applied.map((a) => a.summary.code)).toEqual(["SHOPPING_ADDED_STORE", "SHOPPING_ADDED", "SHOPPING_ALREADY"]);
    const list = restock.state.shoppingList.map((e) => [e.name.value, e.store?.value, e.source]);
    expect(list).toEqual([
      ["garlic", undefined, "chat"],
      ["fish sauce", "MD Oriental", "staples"],
      ["jasmine rice", undefined, "staples"],
    ]);
    expect(restock.state.staples.filter((x) => x.need === "on-list").map((x) => x.id).sort()).toEqual(["fish sauce", "garlic", "jasmine rice"]);

    const back = await must(undo(db, ana, { changeSetId: restock.changeSetId, tapId: tapId(), basedOnVersion: restock.newVersion }));
    expect(back.state.shoppingList.map((e) => e.name.value)).toEqual(["garlic"]);
  });

  it("skips staples removed meanwhile; none left → UNKNOWN_TARGET, nothing changed", async () => {
    const { ana } = await kitchen();
    await must(addStapleItems(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), items: [{ name: "eggs" }] }));
    const v = await version(ana);
    const out = await restockFromStaples(db, ana, { tapId: tapId(), basedOnVersion: v, stapleIds: ["tofu"] });
    expect(out.ok).toBe(false);
    expect(await version(ana)).toBe(v);
    const some = await must(restockFromStaples(db, ana, { tapId: tapId(), basedOnVersion: v, stapleIds: ["tofu", "egg"] }));
    expect(some.state.shoppingList.map((e) => e.name.value)).toEqual(["eggs"]);
  });
});

describe("'You told me these before' (SS2): offered once, moves only on a tap", () => {
  async function withOldLine(scope: KitchenScope, statement: string) {
    await ok(db, scope, [{ type: "profile.preference.save", fields: { statement: said(statement) }, confirmedByMessageId: "m-1" }], { text: "yes" });
  }

  it("Add them: the names become staples in one change set; the offer is gone, the old line stays", async () => {
    const { ana, ben } = await kitchen();
    await withOldLine(ana, "Staples: fish sauce, jasmine rice and rice noodles");
    await must(addStapleItems(db, ben, { tapId: tapId(), basedOnVersion: await version(ben), items: [{ name: "rice noodles" }] }));
    expect(await getLegacyStaplesOffer(db, ana)).toEqual({ names: ["fish sauce", "jasmine rice"] });
    expect(await getLegacyStaplesOffer(db, ben)).toBeNull(); // it's Ana's line, not Ben's
    expect((await getKitchenState(db, ana)).staples.map((s) => s.id)).toEqual(["rice noodle"]); // nothing moved yet

    const added = await must(answerLegacyStaples(db, ana, { basedOnVersion: await version(ana), accept: true }));
    expect(added.undoable).toBe(true);
    expect(added.state.staples.map((s) => s.id)).toEqual(["rice noodle", "fish sauce", "jasmine rice"]);
    expect(await getLegacyStaplesOffer(db, ana)).toBeNull();
    // Even after Undo, it isn't offered again (once).
    await must(undo(db, ana, { changeSetId: added.changeSetId, tapId: tapId(), basedOnVersion: added.newVersion }));
    expect(await getLegacyStaplesOffer(db, ana)).toBeNull();
  });

  it("Not now: nothing changes and it isn't offered again", async () => {
    const { ana } = await kitchen();
    await withOldLine(ana, "Staples: eggs, tofu");
    const v = await version(ana);
    const dismissed = await must(answerLegacyStaples(db, ana, { basedOnVersion: v, accept: false }));
    expect(dismissed.applied).toEqual([]);
    expect(await version(ana)).toBe(v);
    expect(await getLegacyStaplesOffer(db, ana)).toBeNull();
    expect((await getKitchenState(db, ana)).staples).toEqual([]);
  });
});

describe("chat (fake interpreter)", () => {
  let n = 0;
  async function turn(scope: KitchenScope, text: string) {
    const events: StreamEvent[] = [];
    for await (const e of handleChatTurn({ db, scope, interpreter: getInterpreter({ db, scope }) }, { clientMessageId: `st-${randomUUID().slice(0, 6)}-${++n}`, text })) {
      events.push(e);
    }
    const applied = events.find((e) => e.type === "applied");
    return {
      types: events.map((e) => e.type),
      result: applied?.type === "applied" ? applied.result : null,
      reply: events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join(""),
      staples: events.find((e) => e.type === "staples"),
    };
  }

  it("a said staple saves; 'what staples do I need?' answers from them with the Add data", async () => {
    const { ana } = await kitchen();
    const saved = await turn(ana, "fish sauce is a staple from MD Oriental");
    expect(saved.result?.applied[0].summary.code).toBe("STAPLE_ADDED_STORE");
    await turn(ana, "I bought eggs");
    await turn(ana, "eggs are staples");

    const asked = await turn(ana, "what staples do I need?");
    expect(asked.types).toEqual(["ack", "status", "status", "text", "staples", "done"]);
    expect(asked.reply).toBe("From your staples, you need: MD Oriental: fish sauce (not in the kitchen). Want me to add these to your list?");
    expect(asked.staples).toEqual({ type: "staples", items: [{ stapleId: "fish sauce", name: "fish sauce", store: "MD Oriental", need: "missing" }] });
    expect((await getKitchenState(db, ana)).shoppingList).toEqual([]); // an answer never adds (SS4)
  });

  it("a chat Out receipt carries 'Add X to my list' (KOS4-d), with the staple's store; nothing is added", async () => {
    const { ana } = await kitchen();
    await turn(ana, "I bought fish sauce");
    await turn(ana, "fish sauce is a staple from MD Oriental");
    const out = await turn(ana, "we're out of fish sauce");
    expect(out.result?.applied[0].listOffers).toEqual([
      { itemId: expect.any(String), name: "fish sauce", standardName: "fish sauce", level: "out", stapleId: "fish sauce", store: "MD Oriental" },
    ]);
    expect((await getKitchenState(db, ana)).shoppingList).toEqual([]);
    // Saved with the reply, so a reloaded receipt still has it.
    const last = (await listChatHistory(db, ana)).messages.at(-1)!;
    expect(last.receipt?.applied[0].listOffers?.[0]).toMatchObject({ name: "fish sauce", stapleId: "fish sauce" });
  });
});
