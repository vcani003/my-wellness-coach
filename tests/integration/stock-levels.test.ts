/**
 * Stock levels (0045 KOS4) on Postgres (PGlite, real migrations): the level button command is one
 * change set with Undo, projections match a replay, a double tap is harmless, a stale tap is
 * refused, and another kitchen's item can't be touched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { rebuildProjections, setStockLevel, undo } from "@/domains/kitchen/commands";
import { getItemBatches, getKitchenState, getKitchenVersion } from "@/domains/kitchen/queries";
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

async function riceAndEggs() {
  const t = await newKitchen(db, ["Vero", "Levi"]);
  const vero = await t.scope("Vero");
  await ok(db, vero, [{ type: "item.add", fields: { name: said("rice"), location: said("pantry") } }], { text: "rice" });
  await ok(db, vero, [{ type: "item.add", fields: { name: said("eggs"), occurredAt: said("2026-10-02T12:00:00.000Z") } }], { text: "eggs" });
  const done = await ok(db, vero, [{ type: "item.add", fields: { name: said("eggs") } }], { text: "eggs" });
  const id = (name: string) => done.state.items.find((i) => i.name.value === name)!.id;
  return { t, vero, riceId: id("rice"), eggsId: id("eggs"), version: done.newVersion };
}

describe("setStockLevel: the level buttons (KOS4)", () => {
  it("sets the whole item in one change set with Undo; projections match a replay", async () => {
    const { vero, eggsId, version } = await riceAndEggs();
    const out = await setStockLevel(db, vero, { tapId: tapId(), basedOnVersion: version, itemId: eggsId, level: "plenty" });
    if (!out.ok) throw new Error(out.error.reason.text);
    expect(out.result.rejected).toEqual([]);
    expect(out.result.undoable).toBe(true);
    expect(out.result.newVersion).toBe(version + 1);
    expect(out.result.applied[0].summary.code).toBe("ITEM_PLENTY");
    const eggs = out.result.state.items.find((i) => i.id === eggsId)!;
    expect(eggs.stock).toEqual(said("plenty"));
    expect((await getItemBatches(db, vero, eggsId))!.map((b) => b.stock?.value)).toEqual(["plenty", "plenty"]);

    const before = await getKitchenState(db, vero);
    await rebuildProjections(db, vero);
    expect(await getKitchenState(db, vero)).toEqual(before);

    const back = await undo(db, vero, { changeSetId: out.result.changeSetId, tapId: tapId(), basedOnVersion: out.result.newVersion });
    if (!back.ok) throw new Error(back.error.reason.text);
    expect(back.result.state.items.find((i) => i.id === eggsId)!.stock).toBeUndefined();
  });

  it("one batch only, by its ID", async () => {
    const { vero, eggsId, version } = await riceAndEggs();
    const [older, newer] = (await getItemBatches(db, vero, eggsId))!;
    const out = await setStockLevel(db, vero, { tapId: tapId(), basedOnVersion: version, itemId: eggsId, batchId: newer.id, level: "some" });
    if (!out.ok) throw new Error(out.error.reason.text);
    expect(out.result.applied[0].refs[0]).toMatchObject({ id: eggsId, batchId: newer.id });
    const batches = (await getItemBatches(db, vero, eggsId))!;
    expect(batches.find((b) => b.id === older.id)!.stock).toBeUndefined();
    expect(batches.find((b) => b.id === newer.id)!.stock?.value).toBe("some");
    // The row stays unknown until every open batch has a level.
    expect(out.result.state.items.find((i) => i.id === eggsId)!.stock).toBeUndefined();
  });

  it("Out drops the item off the list; Undo brings it back with its level", async () => {
    const { vero, riceId, version } = await riceAndEggs();
    const some = await setStockLevel(db, vero, { tapId: tapId(), basedOnVersion: version, itemId: riceId, level: "some" });
    if (!some.ok) throw new Error(some.error.reason.text);
    const out = await setStockLevel(db, vero, { tapId: tapId(), basedOnVersion: some.result.newVersion, itemId: riceId, level: "out" });
    if (!out.ok) throw new Error(out.error.reason.text);
    expect(out.result.applied[0].summary.code).toBe("ITEM_OUT");
    expect(out.result.state.items.some((i) => i.id === riceId)).toBe(false);
    const back = await undo(db, vero, { changeSetId: out.result.changeSetId, tapId: tapId(), basedOnVersion: out.result.newVersion });
    if (!back.ok) throw new Error(back.error.reason.text);
    expect(back.result.state.items.find((i) => i.id === riceId)!.stock?.value).toBe("some");
  });

  it("a double tap (same tapId) is applied once", async () => {
    const { vero, riceId, version } = await riceAndEggs();
    const args = { tapId: tapId(), basedOnVersion: version, itemId: riceId, level: "low" as const };
    const first = await setStockLevel(db, vero, args);
    const second = await setStockLevel(db, vero, args);
    if (!first.ok || !second.ok) throw new Error("apply failed");
    expect(second.result.changeSetId).toBe(first.result.changeSetId);
    expect(await getKitchenVersion(db, vero)).toBe(version + 1);
  });

  it("a tap on an item someone changed since is refused as stale; nothing changes", async () => {
    const { t, vero, riceId, version } = await riceAndEggs();
    const levi = await t.scope("Levi");
    const leviTap = await setStockLevel(db, levi, { tapId: tapId(), basedOnVersion: version, itemId: riceId, level: "plenty" });
    if (!leviTap.ok) throw new Error(leviTap.error.reason.text);
    const late = await setStockLevel(db, vero, { tapId: tapId(), basedOnVersion: version, itemId: riceId, level: "low" });
    if (!late.ok) throw new Error(late.error.reason.text);
    expect(late.result.rejected.map((r) => r.reason.code)).toEqual(["STALE_TARGET"]);
    expect(late.result.state.items.find((i) => i.id === riceId)!.stock?.value).toBe("plenty");
    // Undo covers only your own changes (0017): Vero can't undo Levi's level.
    const notMine = await undo(db, vero, { changeSetId: leviTap.result.changeSetId, tapId: tapId(), basedOnVersion: leviTap.result.newVersion });
    if (!notMine.ok) throw new Error(notMine.error.reason.text);
    expect(notMine.result.rejected.map((r) => r.reason.code)).toEqual(["NOT_ALLOWED"]);
  });

  it("another kitchen's item is unknown here", async () => {
    const { riceId } = await riceAndEggs();
    const other = await newKitchen(db);
    const vero2 = await other.scope("Vero");
    const out = await setStockLevel(db, vero2, { tapId: tapId(), basedOnVersion: 0, itemId: riceId, level: "plenty" });
    if (!out.ok) throw new Error(out.error.reason.text);
    expect(out.result.rejected.map((r) => r.reason.code)).toEqual(["UNKNOWN_ITEM"]);
  });
});
