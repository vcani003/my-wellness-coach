/**
 * Tap an item to edit it (0045 KOS3; the item actions of 0030 / 0036) on Postgres (PGlite, real
 * migrations): each command is one change set with Undo, projections match a replay, a double tap
 * is harmless, a stale edit is refused whole, anyone in the kitchen may edit any item (0017), and
 * the Staple switch reads from and writes to the kitchen's staples (0054).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import type { ApplyOutcome } from "@/domains/kitchen/commands";
import { editItem, rebuildProjections, removeItem, setItemStaple, setStockLevel, undo } from "@/domains/kitchen/commands";
import { getItemBatches, getKitchenState, getKitchenVersion } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { said } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

const tapId = () => `tap-${randomUUID().slice(0, 12)}`;

function result(out: ApplyOutcome) {
  if (!out.ok) throw new Error(out.error.reason.text);
  return out.result;
}

/** Vero adds fish sauce (fridge, 1 bottle) in a kitchen shared with Levi. */
async function fishSauce() {
  const t = await newKitchen(db, ["Vero", "Levi"]);
  const vero = await t.scope("Vero");
  const added = await ok(db, vero, [{ type: "item.add", fields: { name: said("fish sauce"), location: said("fridge"), quantity: said({ asSaid: "1 bottle", amount: 1, unit: "bottle" }) } }], { text: "fish sauce" });
  return { t, vero, itemId: added.applied[0].refs[0].id, version: added.newVersion };
}

const itemOf = async (scope: KitchenScope, id: string) => (await getKitchenState(db, scope)).items.find((i) => i.id === id);

async function sameAsReplay(scope: KitchenScope) {
  const before = await getKitchenState(db, scope);
  await rebuildProjections(db, scope);
  expect(await getKitchenState(db, scope)).toEqual(before);
}

describe("editItem: the edit sheet (KOS3)", () => {
  it("rename, amount, place and type in one change set with one Undo; projections match a replay", async () => {
    const { vero, itemId, version } = await fishSauce();
    const r = result(
      await editItem(db, vero, { tapId: tapId(), basedOnVersion: version, itemId, edit: { name: "nước mắm", amount: "2 bottles", place: "counter", category: "spices_seasonings" } }),
    );
    expect(r.rejected).toEqual([]);
    expect(r.undoable).toBe(true);
    expect(r.newVersion).toBe(version + 1);
    expect(r.applied.map((a) => a.summary.code)).toEqual(["ITEM_RENAMED", "ITEM_UPDATED", "ITEM_MOVED", "ITEM_CATEGORY"]);
    const item = await itemOf(vero, itemId);
    expect(item?.name.value).toBe("nước mắm");
    expect(item?.quantity?.value).toEqual({ asSaid: "2 bottles", amount: 2, unit: "bottles" });
    expect(item?.location).toEqual(said("counter"));
    expect(item?.category).toEqual(said("spices_seasonings"));
    await sameAsReplay(vero);

    const back = result(await undo(db, vero, { changeSetId: r.changeSetId, tapId: tapId(), basedOnVersion: r.newVersion }));
    expect(back.rejected).toEqual([]);
    const restored = await itemOf(vero, itemId);
    expect([restored?.name.value, restored?.quantity?.value.asSaid, restored?.location?.value]).toEqual(["fish sauce", "1 bottle", "fridge"]);
  });

  it("clears the amount to unknown; an unchanged sheet saves nothing", async () => {
    const { vero, itemId, version } = await fishSauce();
    const cleared = result(await editItem(db, vero, { tapId: tapId(), basedOnVersion: version, itemId, edit: { amount: "" } }));
    expect((await itemOf(vero, itemId))?.quantity).toBeUndefined();
    const same = result(await editItem(db, vero, { tapId: tapId(), basedOnVersion: cleared.newVersion, itemId, edit: { name: "fish sauce", place: "fridge" } }));
    expect(same.applied).toEqual([]);
    expect(same.newVersion).toBe(cleared.newVersion);
  });

  it("one batch's place and amount (0036, KOS4-e); a moved-out-of-Freezer batch is defrosted (IA5)", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    await ok(db, vero, [{ type: "item.add", fields: { name: said("chicken"), location: said("freezer"), frozen: said(true), occurredAt: said("2026-10-02T12:00:00.000Z") } }], { text: "chicken" });
    const second = await ok(db, vero, [{ type: "item.add", fields: { name: said("chicken"), location: said("freezer"), frozen: said(true) } }], { text: "chicken" });
    const itemId = second.applied[0].refs[0].id;
    const [older, newer] = (await getItemBatches(db, vero, itemId))!;
    const r = result(await editItem(db, vero, { tapId: tapId(), basedOnVersion: second.newVersion, itemId, batchId: older.id, edit: { place: "fridge", amount: "1 lb" } }));
    expect(r.rejected).toEqual([]);
    expect(r.applied.map((a) => a.summary.code)).toEqual(["ITEM_UPDATED", "ITEM_DEFROSTED"]);
    const now = (await getItemBatches(db, vero, itemId))!;
    const o = now.find((b) => b.id === older.id)!;
    const n = now.find((b) => b.id === newer.id)!;
    expect([o.location, o.frozen?.value, o.quantity?.value.asSaid, Boolean(o.defrostedOn)]).toEqual([said("fridge"), false, "1 lb", true]);
    expect([n.location?.value, n.frozen?.value, n.quantity]).toEqual(["freezer", true, undefined]);
    await sameAsReplay(vero);
  });

  it("anyone in the kitchen may edit an item someone else added (0017); Undo stays theirs", async () => {
    const { t, vero, itemId, version } = await fishSauce();
    const levi = await t.scope("Levi");
    const r = result(await editItem(db, levi, { tapId: tapId(), basedOnVersion: version, itemId, edit: { name: "Red Boat fish sauce" } }));
    expect(r.rejected).toEqual([]);
    const item = await itemOf(vero, itemId);
    expect(item?.updatedBy).toMatchObject({ id: t.userIds.Levi });
    expect(item?.createdBy).toMatchObject({ id: t.userIds.Vero });
    const notMine = result(await undo(db, vero, { changeSetId: r.changeSetId, tapId: tapId(), basedOnVersion: r.newVersion }));
    expect(notMine.rejected.map((x) => x.reason.code)).toEqual(["NOT_ALLOWED"]);
  });

  it("refuses the whole sheet when someone changed the item since it opened (STALE_TARGET, nothing saved)", async () => {
    const { t, vero, itemId, version } = await fishSauce();
    const levi = await t.scope("Levi");
    result(await setStockLevel(db, levi, { tapId: tapId(), basedOnVersion: version, itemId, level: "low" }));
    const late = result(await editItem(db, vero, { tapId: tapId(), basedOnVersion: version, itemId, edit: { name: "nước mắm", place: "pantry" } }));
    expect(late.applied).toEqual([]);
    expect(new Set(late.rejected.map((x) => x.reason.code))).toEqual(new Set(["STALE_TARGET"]));
    const item = await itemOf(vero, itemId);
    expect([item?.name.value, item?.location?.value]).toEqual(["fish sauce", "fridge"]);
  });

  it("a double tap (same tapId) is applied once", async () => {
    const { vero, itemId, version } = await fishSauce();
    const args = { tapId: tapId(), basedOnVersion: version, itemId, edit: { place: "pantry" as const } };
    const first = result(await editItem(db, vero, args));
    const second = result(await editItem(db, vero, args));
    expect(second.changeSetId).toBe(first.changeSetId);
    expect(await getKitchenVersion(db, vero)).toBe(version + 1);
  });

  it("an item that's gone is refused, not recorded: removed → UNKNOWN_ITEM, Out → ALREADY_OUT", async () => {
    const a = await fishSauce();
    const removed = result(await removeItem(db, a.vero, { tapId: tapId(), basedOnVersion: a.version, itemId: a.itemId }));
    const r1 = result(await editItem(db, a.vero, { tapId: tapId(), basedOnVersion: removed.newVersion, itemId: a.itemId, edit: { name: "x" } }));
    expect([r1.applied, r1.rejected.map((x) => x.reason.code)]).toEqual([[], ["UNKNOWN_ITEM"]]);

    const b = await fishSauce();
    const out = result(await setStockLevel(db, b.vero, { tapId: tapId(), basedOnVersion: b.version, itemId: b.itemId, level: "out" }));
    const r2 = result(await editItem(db, b.vero, { tapId: tapId(), basedOnVersion: out.newVersion, itemId: b.itemId, edit: { place: "pantry" } }));
    expect([r2.applied, r2.rejected.map((x) => x.reason.code)]).toEqual([[], ["ALREADY_OUT"]]);
    expect(r2.newVersion).toBe(out.newVersion);
  });

  it("another kitchen's item is unknown here", async () => {
    const { itemId } = await fishSauce();
    const other = await newKitchen(db);
    const stranger = await other.scope("Vero");
    const r = result(await editItem(db, stranger, { tapId: tapId(), basedOnVersion: 0, itemId, edit: { name: "mine now" } }));
    expect(r.rejected.map((x) => x.reason.code)).toEqual(["UNKNOWN_ITEM"]);
  });
});

describe("removeItem: Remove (added by mistake)", () => {
  it("leaves the list in one change set; Undo brings it back", async () => {
    const { vero, itemId, version } = await fishSauce();
    const r = result(await removeItem(db, vero, { tapId: tapId(), basedOnVersion: version, itemId }));
    expect(r.applied[0].summary.code).toBe("ITEM_REMOVED");
    expect(await itemOf(vero, itemId)).toBeUndefined();
    await sameAsReplay(vero);
    result(await undo(db, vero, { changeSetId: r.changeSetId, tapId: tapId(), basedOnVersion: r.newVersion }));
    expect((await itemOf(vero, itemId))?.name.value).toBe("fish sauce");
  });
});

describe("setItemStaple: the item's Staple switch (0054 plan)", () => {
  it("on adds the item's name as a staple and the row says so; off removes it; each has Undo", async () => {
    const { vero, itemId, version } = await fishSauce();
    expect((await itemOf(vero, itemId))?.stapleId).toBeUndefined();
    const on = result(await setItemStaple(db, vero, { tapId: tapId(), basedOnVersion: version, itemId, staple: true }));
    expect(on.applied[0].summary.code).toBe("STAPLE_ADDED");
    expect(on.undoable).toBe(true);
    expect(on.state.items.find((i) => i.id === itemId)?.stapleId).toBe("fish sauce");
    expect(on.state.staples.map((s) => s.id)).toEqual(["fish sauce"]);

    const again = result(await setItemStaple(db, vero, { tapId: tapId(), basedOnVersion: on.newVersion, itemId, staple: true }));
    expect(again.applied[0].summary.code).toBe("STAPLE_ALREADY");
    expect(again.newVersion).toBe(on.newVersion);

    const off = result(await setItemStaple(db, vero, { tapId: tapId(), basedOnVersion: on.newVersion, itemId, staple: false }));
    expect(off.applied.map((a) => a.summary.code)).toEqual(["STAPLE_REMOVED"]);
    expect(off.state.items.find((i) => i.id === itemId)?.stapleId).toBeUndefined();
    expect(off.state.staples).toEqual([]);
    await sameAsReplay(vero);

    const back = result(await undo(db, vero, { changeSetId: off.changeSetId, tapId: tapId(), basedOnVersion: off.newVersion }));
    expect(back.state.items.find((i) => i.id === itemId)?.stapleId).toBe("fish sauce");
  });

  it("off removes only exact-name staples ('nước mắm (fish sauce)' is the staple 'fish sauce'; 'rice' isn't 'jasmine rice')", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    await ok(db, vero, [
      { type: "staple.add", fields: { name: said("fish sauce") } },
      { type: "staple.add", fields: { name: said("rice") } },
    ]);
    const added = await ok(
      db,
      vero,
      [
        { type: "item.add", fields: { name: said("nước mắm (fish sauce)") } },
        { type: "item.add", fields: { name: said("jasmine rice") } },
      ],
      { text: "nước mắm (fish sauce) and jasmine rice" },
    );
    const [sauceId, riceId] = added.applied.map((a) => a.refs[0].id);
    const state = await getKitchenState(db, vero);
    expect(state.items.find((i) => i.id === sauceId)?.stapleId).toBe("fish sauce");
    expect(state.items.find((i) => i.id === riceId)?.stapleId).toBeUndefined();

    const riceOff = result(await setItemStaple(db, vero, { tapId: tapId(), basedOnVersion: added.newVersion, itemId: riceId, staple: false }));
    expect(riceOff.applied).toEqual([]);
    expect(riceOff.state.staples.map((s) => s.id).sort()).toEqual(["fish sauce", "rice"]);

    const sauceOff = result(await setItemStaple(db, vero, { tapId: tapId(), basedOnVersion: riceOff.newVersion, itemId: sauceId, staple: false }));
    expect(sauceOff.state.staples.map((s) => s.id)).toEqual(["rice"]);
  });

  it("renaming the item renames its staple, store kept, and one Undo reverts both (0057 KOS3-b)", async () => {
    const { vero, itemId } = await fishSauce();
    const staple = await ok(db, vero, [{ type: "staple.add", fields: { name: said("fish sauce"), store: said("MD Oriental") } }]);
    const r = result(await editItem(db, vero, { tapId: tapId(), basedOnVersion: staple.newVersion, itemId, edit: { name: "nước mắm" } }));
    expect(r.rejected).toEqual([]);
    expect(r.state.staples.map((s) => [s.id, s.name.value, s.store?.value])).toEqual([["nước mắm", "nước mắm", "MD Oriental"]]);
    expect(r.state.items.find((i) => i.id === itemId)?.stapleId).toBe("nước mắm");
    await sameAsReplay(vero);

    const back = result(await undo(db, vero, { changeSetId: r.changeSetId, tapId: tapId(), basedOnVersion: r.newVersion }));
    expect(back.rejected).toEqual([]);
    expect(back.state.items.find((i) => i.id === itemId)?.name.value).toBe("fish sauce");
    expect(back.state.staples.map((s) => [s.id, s.store?.value])).toEqual([["fish sauce", "MD Oriental"]]);
    await sameAsReplay(vero);
  });

  it("an item that's gone is refused", async () => {
    const { vero, itemId, version } = await fishSauce();
    const removed = result(await removeItem(db, vero, { tapId: tapId(), basedOnVersion: version, itemId }));
    const r = result(await setItemStaple(db, vero, { tapId: tapId(), basedOnVersion: removed.newVersion, itemId, staple: true }));
    expect(r.rejected.map((x) => x.reason.code)).toEqual(["UNKNOWN_ITEM"]);
    expect(r.state.staples).toEqual([]);
  });
});
