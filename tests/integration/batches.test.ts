/**
 * Batches (0025) on Postgres (PGlite, the real migrations): migration 0008's backfill of existing
 * items, projection == replay, the batch buttons ("Those are gone", "Still have them"), Undo
 * across them, SL5, and the saved receipt's choice only while it still needs asking.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER, type Db } from "@/db/client";
import { itemBatches, items, kitchens } from "@/db/schema";
import { closeBatches, keepBatches, rebuildProjections, undo } from "@/domains/kitchen/commands";
import { getItemBatches, getKitchenState, getUseItUpSignals } from "@/domains/kitchen/queries";
import { getUnansweredBatchIds } from "@/domains/kitchen/public";
import { replay } from "@/domains/kitchen/state";
import { appendEvents } from "@/shared/events/store";
import type { EventEnvelope } from "@/shared/events/types";
import { createKitchen } from "@/shared/identity";
import { requireMember } from "@/shared/membership";
import { said } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb } from "../support/db";

const eggs = (n: number, occurredAt?: string) => ({
  type: "item.add" as const,
  fields: {
    name: said("eggs"),
    quantity: said({ asSaid: `${n} eggs`, amount: n, unit: "eggs" }),
    ...(occurredAt ? { occurredAt: said(occurredAt) } : {}),
  },
});
let taps = 0;
const tapId = () => `tap-${++taps}-${randomUUID().slice(0, 6)}`;

describe("migration 0008: existing items become one batch each (additive, 0028)", () => {
  it("backfills live data so it keeps working, and the backfill equals a replay of the old events", async () => {
    // A database as the last build left it: migrations 0000–0007 only.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-0007-"));
    fs.mkdirSync(path.join(dir, "meta"));
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 7);
    fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries as { tag: string }[]) fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
    const { db, close } = await openLocalDb({ migrationsFolder: dir });
    try {
      // Raw SQL: the old schema has no later columns (e.g. 0009's passphrase_hash), and Drizzle
      // names every column it knows about in an insert.
      await db.execute(sql`insert into users (id, display_name) values ('vero', 'Vero')`);
      await createKitchen(db, { id: "home", name: "Home", memberIds: ["vero"] });

      // Old-build events (no batch IDs) and the projection rows the old build wrote.
      const at = (d: number) => new Date(Date.UTC(2026, 9, d, 15)).toISOString();
      const ev = (n: number, d: number, type: string, payload: unknown): EventEnvelope => ({
        id: `legacy-${n}`, stream: "kitchen:home", seq: 0, type, v: 1, actor: "vero", via: "chat",
        recordedAt: at(d), occurredAt: null, changeSetId: `legacy-cs-${n}`, sourceMessageId: null,
        reverses: null, corrects: null, payload,
      });
      const legacy = [
        ev(1, 2, "item.added", { itemId: "it-eggs", name: said("eggs"), standardName: "egg", location: said("fridge"), quantity: said({ asSaid: "12 eggs", amount: 12, unit: "eggs" }) }),
        ev(2, 3, "item.added", { itemId: "it-ginger", name: said("ginger"), standardName: "ginger" }),
        ev(3, 5, "item.used", { itemId: "it-ginger", stock: said("out") }),
        ev(4, 6, "item.added", { itemId: "it-milk", name: said("milk"), standardName: "milk" }),
        ev(5, 7, "item.used", { itemId: "it-milk", stock: said("low") }),
      ];
      await appendEvents(db, legacy);
      // Raw SQL again: the old `items` table has no later columns (e.g. 0010's category).
      const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
      for (const i of Object.values(replay(legacy).items)) {
        await db.execute(sql`
          insert into items (id, kitchen_id, name, standard_name, quantity, location, frozen, opened, stock,
            occurred_at, added_at, last_used_at, created_at, created_by, updated_at, updated_by)
          values (${i.id}, 'home', ${j(i.name)}::jsonb, ${i.standardName}, ${j(i.quantity)}::jsonb,
            ${j(i.location)}::jsonb, null, null, ${j(i.stock)}::jsonb, null, ${i.addedAt}::timestamptz,
            ${i.lastUsedAt ?? null}::timestamptz, ${i.createdAt}::timestamptz, ${i.createdBy},
            ${i.updatedAt}::timestamptz, ${i.updatedBy})`);
      }
      await db.update(kitchens).set({ version: 5 }).where(eq(kitchens.id, "home"));
      const rawItems = async () =>
        ((await db.execute(sql`select * from items order by id`)) as unknown as { rows: Record<string, unknown>[] }).rows;
      const withoutCategory = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "category"));
      const oldRows = await rawItems();

      // Deploy: the real migrations, including 0008.
      await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });

      // Additive: the items rows are exactly as they were (old code still reads them); later
      // migrations only add columns (0010's category stays null: it's computed on read).
      const newRows = await rawItems();
      expect(newRows.map((r) => r.category)).toEqual(oldRows.map(() => null));
      expect(newRows.map(withoutCategory)).toEqual(oldRows);
      const batches = await db.select().from(itemBatches).orderBy(itemBatches.id);
      expect(batches.map((b) => [b.id, b.itemId, b.closedReason])).toEqual([
        ["it-eggs", "it-eggs", null],
        ["it-ginger", "it-ginger", "used-up"],
        ["it-milk", "it-milk", null],
      ]);

      const vero = await requireMember(db, "vero", "home");
      const state = await getKitchenState(db, vero);
      expect(state.items.map((i) => [i.name.value, i.batches!.map((b) => b.id), i.stock?.value])).toEqual([
        ["eggs", ["it-eggs"], undefined],
        ["milk", ["it-milk"], "low"],
      ]);

      // The backfill equals a full replay of the old events.
      await rebuildProjections(db, vero);
      expect(await getKitchenState(db, vero)).toEqual(state);

      // Live data keeps working: buying eggs again adds a batch to the old item.
      const bought = await ok(db, vero, [eggs(6)], { text: "bought 6 eggs" });
      expect(bought.applied[0].batchOffers![0]).toMatchObject({ itemId: "it-eggs", older: [{ batchId: "it-eggs" }] });
      expect((await getItemBatches(db, vero, "it-eggs"))!.map((b) => b.id)).toEqual(["it-eggs", bought.applied[0].batchOffers![0].newBatchId]);
      // The old reader's columns stay meaningful: the oldest batch's age, the summed quantity.
      const [eggsRow] = await db.select().from(items).where(eq(items.id, "it-eggs"));
      expect(eggsRow.addedAt.toISOString()).toBe(at(2));
      expect(eggsRow.quantity?.value.amount).toBe(18);

      // Running the backfill again is harmless.
      await db.execute(sql.raw(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "0008_item_batches.sql"), "utf8").split("--> statement-breakpoint").at(-1)!));
      expect(await db.select().from(itemBatches).where(eq(itemBatches.itemId, "it-eggs"))).toHaveLength(2);
    } finally {
      await close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("batches on Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openLocalDb());
  });
  afterAll(async () => {
    await close();
  });

  async function twoEggBatches() {
    const t = await newKitchen(db, ["Vero", "Levi"]);
    const vero = await t.scope("Vero");
    await ok(db, vero, [eggs(12, "2026-10-02T12:00:00.000Z")], { text: "12 eggs" });
    const bought = await ok(db, vero, [eggs(6)], { text: "6 eggs" });
    const offer = bought.applied[0].batchOffers![0];
    return { t, vero, bought, offer };
  }

  it("'Those are gone' closes the older batch; Undo brings it back; the projection equals a replay", async () => {
    const { vero, offer } = await twoEggBatches();
    const gone = await closeBatches(db, vero, { tapId: tapId(), basedOnVersion: 0, itemId: offer.itemId, batchIds: offer.older.map((o) => o.batchId) });
    if (!gone.ok) throw new Error(gone.error.reason.text);
    expect(gone.result.rejected).toEqual([]); // an exact batch ID isn't refused as stale
    expect(gone.result.undoable).toBe(true);
    expect(gone.result.state.items[0].batches!.map((b) => b.id)).toEqual([offer.newBatchId]);
    const before = await getKitchenState(db, vero);
    await rebuildProjections(db, vero);
    expect(await getKitchenState(db, vero)).toEqual(before);

    const back = await undo(db, vero, { changeSetId: gone.result.changeSetId, tapId: tapId(), basedOnVersion: gone.result.newVersion });
    if (!back.ok) throw new Error(back.error.reason.text);
    expect(back.result.state.items[0].batches!.map((b) => b.id)).toEqual([offer.older[0].batchId, offer.newBatchId]);
  });

  it("'Still have them' is soft: not undoable, and it never blocks undoing the purchase", async () => {
    const { vero, bought, offer } = await twoEggBatches();
    const kept = await keepBatches(db, vero, { tapId: tapId(), basedOnVersion: bought.newVersion, itemId: offer.itemId, batchIds: [offer.older[0].batchId] });
    if (!kept.ok) throw new Error(kept.error.reason.text);
    expect(kept.result.undoable).toBe(false);
    expect(kept.result.state.items[0].batches![0].keptAt).toBeDefined();
    expect(await getUnansweredBatchIds(db, vero, [offer.older[0].batchId])).toEqual(new Set());

    const undone = await undo(db, vero, { changeSetId: bought.changeSetId, tapId: tapId(), basedOnVersion: kept.result.newVersion });
    if (!undone.ok) throw new Error(undone.error.reason.text);
    expect(undone.result.rejected).toEqual([]);
    expect(undone.result.state.items[0].batches!.map((b) => b.id)).toEqual([offer.older[0].batchId]);
  });

  it("a 4th batch closes the oldest; one Undo reopens it", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    for (const d of ["2026-09-20", "2026-10-01", "2026-10-08"]) await ok(db, vero, [eggs(12, `${d}T12:00:00.000Z`)], { text: "12 eggs" });
    const fourth = await ok(db, vero, [eggs(6)], { text: "6 eggs" });
    expect(fourth.applied[0].batchOffers![0].autoClosed?.addedAt).toBe("2026-09-20T12:00:00.000Z");
    expect(fourth.state.items[0].batches).toHaveLength(3);
    const closedRow = await db
      .select()
      .from(itemBatches)
      .where(and(eq(itemBatches.kitchenId, t.kitchenId), eq(itemBatches.closedReason, "replaced")));
    expect(closedRow).toHaveLength(1);
    const undone = await undo(db, vero, { changeSetId: fourth.changeSetId, tapId: tapId(), basedOnVersion: fourth.newVersion });
    if (!undone.ok) throw new Error(undone.error.reason.text);
    expect(undone.result.state.items[0].batches!.map((b) => b.addedAt.slice(0, 10))).toEqual(["2026-09-20", "2026-10-01", "2026-10-08"]);
  });

  it("SL5: 'I bought eggs' adds a batch and takes eggs off the shopping list", async () => {
    const { vero } = await twoEggBatches();
    await ok(db, vero, [{ type: "shopping.add", fields: { name: said("eggs") } }], { text: "eggs" });
    const bought = await ok(db, vero, [{ type: "item.add", fields: { name: said("eggs") } }], { text: "I bought eggs" });
    expect(bought.applied[0].summary.params).toMatchObject({ fromList: true, batches: 3 });
    expect(bought.state.shoppingList).toEqual([]);
    expect(bought.state.items).toHaveLength(1);
  });

  it("use-it-up signals read the oldest batch and the defrosted date", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    await ok(db, vero, [{ type: "item.add", fields: { name: said("chicken"), location: said("freezer"), frozen: said(true), occurredAt: said("2026-10-01T12:00:00.000Z") } }], { text: "chicken" });
    await ok(db, vero, [{ type: "item.defrost", target: { name: "chicken" }, fields: { defrostedOn: said("2026-10-13T12:00:00.000Z") } }], { text: "defrosted the chicken" });
    const [signal] = await getUseItUpSignals(db, vero, new Date("2026-10-14T18:00:00.000Z"));
    expect(signal).toMatchObject({ name: "chicken", oldestDays: 13, defrostedDays: 1, batchCount: 1, low: false });
  });

  it("defrosting moves it from the freezer to the fridge (inferred), saved and rebuilt the same (DF1 Rec)", async () => {
    const t = await newKitchen(db);
    const vero = await t.scope("Vero");
    await ok(db, vero, [{ type: "item.add", fields: { name: said("chicken"), location: said("freezer"), frozen: said(true) } }], { text: "chicken in the freezer" });
    await ok(db, vero, [{ type: "item.defrost", target: { name: "chicken" } }], { text: "I defrosted the chicken" });
    const fridge = { value: "fridge", basis: "inferred", confidence: "high" };
    const read = async () => (await getKitchenState(db, vero)).items.find((i) => i.name.value === "chicken")!;
    const chicken = await read();
    expect(chicken.location).toEqual(fridge);
    expect(chicken.frozen?.value).toBe(false);
    expect(chicken.defrostedOn).toBeDefined();
    expect(chicken.batches?.[0].location).toEqual(fridge);
    await rebuildProjections(db, vero);
    expect((await read()).location).toEqual(fridge);
  });

  it("refuses a batch of another kitchen's item", async () => {
    const { offer } = await twoEggBatches();
    const other = await newKitchen(db);
    const out = await closeBatches(db, await other.scope("Vero"), { tapId: tapId(), basedOnVersion: 0, itemId: offer.itemId, batchIds: [offer.older[0].batchId] });
    if (!out.ok) throw new Error(out.error.reason.text);
    expect(out.result.rejected.map((r) => r.reason.code)).toEqual(["UNKNOWN_ITEM"]);
  });
});
