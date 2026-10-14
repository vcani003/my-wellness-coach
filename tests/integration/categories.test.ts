/**
 * Item categories (CAT1 Rec) on Postgres (PGlite, the real migrations): migration 0010 is
 * additive and existing items are sorted on read (never rewritten, 0028), projection == replay,
 * a said correction is stored and remembered in `item_category_prefs`, and Undo forgets it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER, type Db } from "@/db/client";
import { itemCategoryPrefs, items, kitchens } from "@/db/schema";
import { rebuildProjections, undo } from "@/domains/kitchen/commands";
import { getKitchenState } from "@/domains/kitchen/queries";
import { replay } from "@/domains/kitchen/state";
import { appendEvents } from "@/shared/events/store";
import type { EventEnvelope } from "@/shared/events/types";
import { createKitchen } from "@/shared/identity";
import { requireMember } from "@/shared/membership";
import { searchItems } from "@/shared/item-search";
import { inferred, said } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb } from "../support/db";

const medium = <T>(value: T) => ({ value, basis: "inferred" as const, confidence: "medium" as const });

describe("migration 0010: existing items get a category on read (additive, 0028)", () => {
  it("sorts live data by keyword without rewriting it, and equals a replay of the old events", async () => {
    // A database as the last build left it: migrations 0000–0009 only.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-0009-"));
    fs.mkdirSync(path.join(dir, "meta"));
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 9);
    fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries as { tag: string }[]) fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
    const { db, close } = await openLocalDb({ migrationsFolder: dir });
    try {
      await db.execute(sql`insert into users (id, display_name) values ('vero', 'Vero')`);
      await createKitchen(db, { id: "home", name: "Home", memberIds: ["vero"] });

      // Old-build events (no category) and the projection rows the old build wrote.
      const at = (d: number) => new Date(Date.UTC(2026, 9, d, 15)).toISOString();
      const ev = (n: number, payload: Record<string, unknown>): EventEnvelope => ({
        id: `legacy-${n}`, stream: "kitchen:home", seq: 0, type: "item.added", v: 1, actor: "vero", via: "chat",
        recordedAt: at(n), occurredAt: null, changeSetId: `legacy-cs-${n}`, sourceMessageId: null,
        reverses: null, corrects: null, payload: { batchId: `b-${n}`, ...payload },
      });
      const legacy = [
        ev(1, { itemId: "it-nuoc-mam", name: said("nước mắm"), standardName: "nước mắm", location: said("pantry") }),
        ev(2, { itemId: "it-pho", name: said("bánh phở"), standardName: "bánh phở" }),
        ev(3, { itemId: "it-left", name: said("pho leftovers"), standardName: "pho leftover" }),
        ev(4, { itemId: "it-rice", name: said("jasmine rice"), standardName: "jasmine rice" }),
        ev(5, { itemId: "it-odd", name: said("zzz"), standardName: "zzz" }),
      ];
      await appendEvents(db, legacy);
      const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
      for (const i of Object.values(replay(legacy).items)) {
        await db.execute(sql`
          insert into items (id, kitchen_id, name, standard_name, location, added_at, created_at, created_by, updated_at, updated_by)
          values (${i.id}, 'home', ${j(i.name)}::jsonb, ${i.standardName}, ${j(i.location)}::jsonb, ${i.addedAt}::timestamptz,
            ${i.createdAt}::timestamptz, ${i.createdBy}, ${i.updatedAt}::timestamptz, ${i.updatedBy})`);
        const b = i.batches[0];
        await db.execute(sql`
          insert into item_batches (id, kitchen_id, item_id, position, added_at, location, created_at, created_by, updated_at, updated_by)
          values (${b.id}, 'home', ${i.id}, 0, ${b.addedAt}::timestamptz, ${j(b.location)}::jsonb,
            ${b.createdAt}::timestamptz, ${b.createdBy}, ${b.updatedAt}::timestamptz, ${b.updatedBy})`);
      }
      await db.update(kitchens).set({ version: 5 }).where(eq(kitchens.id, "home"));
      const rawItems = async () =>
        ((await db.execute(sql`select * from items order by id`)) as unknown as { rows: Record<string, unknown>[] }).rows;
      const withoutCategory = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "category"));
      const oldRows = await rawItems();

      // Deploy: the real migrations, including 0010.
      await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });

      // Additive: one new nullable column, left null (nothing is rewritten), and a new empty table.
      const newRows = await rawItems();
      expect(newRows.map((r) => r.category)).toEqual(oldRows.map(() => null));
      expect(newRows.map(withoutCategory)).toEqual(oldRows);
      expect(await db.select().from(itemCategoryPrefs)).toEqual([]);

      // Read: each existing item has the keyword guess; anything unmatched is Other, low.
      const vero = await requireMember(db, "vero", "home");
      const state = await getKitchenState(db, vero);
      expect(Object.fromEntries(state.items.map((i) => [i.name.value, i.category]))).toEqual({
        "nước mắm": medium("sauces_condiments"),
        "bánh phở": medium("rice_noodles_grains"),
        "pho leftovers": medium("leftovers"),
        "jasmine rice": medium("rice_noodles_grains"),
        zzz: { value: "other", basis: "inferred", confidence: "low" },
      });
      // Search from KitchenState alone, without accents.
      expect(searchItems(state.items, "nuoc mam").map((i) => i.id)).toEqual(["it-nuoc-mam"]);

      // Reading again is the same (idempotent), and so is a full replay of the old events.
      expect(await getKitchenState(db, vero)).toEqual(state);
      await rebuildProjections(db, vero);
      expect(await getKitchenState(db, vero)).toEqual(state);

      // Live data keeps working: correcting an old item stores it, as said.
      await ok(db, vero, [{ type: "item.update", target: { name: "zzz" }, fields: { category: said("snacks_sweets") } }], { text: "zzz goes under snacks" });
      const [zzz] = await db.select().from(items).where(eq(items.id, "it-odd"));
      expect(zzz.category).toEqual(said("snacks_sweets"));
    } finally {
      await close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("categories on Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openLocalDb());
  });
  afterAll(async () => {
    await close();
  });

  const prefs = (kitchenId: string) =>
    db.select({ standardName: itemCategoryPrefs.standardName, category: itemCategoryPrefs.category }).from(itemCategoryPrefs).where(eq(itemCategoryPrefs.kitchenId, kitchenId));

  it("stores a guess, overrides it with what the user says, remembers that, and Undo forgets it", async () => {
    const t = await newKitchen(db, ["Vero"]);
    const vero = await t.scope("Vero");
    await ok(db, vero, [{ type: "item.add", fields: { name: said("fish sauce"), category: inferred("sauces_condiments") } }], { text: "bought fish sauce" });
    const item = (await getKitchenState(db, vero)).items[0];
    expect(item.category).toEqual(inferred("sauces_condiments"));
    const [stored] = await db.select().from(items).where(and(eq(items.kitchenId, t.kitchenId), eq(items.id, item.id)));
    expect(stored.category).toEqual(inferred("sauces_condiments"));

    const fix = await ok(
      db,
      vero,
      [{ type: "item.update", target: { name: "fish sauce" }, fields: { category: said("canned_jarred") } }],
      { text: "fish sauce goes under canned" },
    );
    expect(fix.applied[0].summary.code).toBe("ITEM_CATEGORY");
    expect((await getKitchenState(db, vero)).items[0].category).toEqual(said("canned_jarred"));
    expect(await prefs(t.kitchenId)).toEqual([{ standardName: "fish sauce", category: "canned_jarred" }]);

    // A guess doesn't undo what was said.
    const guess = await ok(db, vero, [{ type: "item.update", target: { name: "fish sauce" }, fields: { category: inferred("other") } }], { text: "fish sauce is other" });
    expect(guess.applied[0].summary.code).toBe("NO_CHANGE");

    // Projections == replay, preferences included.
    const before = await getKitchenState(db, vero);
    await rebuildProjections(db, vero);
    expect(await getKitchenState(db, vero)).toEqual(before);
    expect(await prefs(t.kitchenId)).toEqual([{ standardName: "fish sauce", category: "canned_jarred" }]);

    // The next fish sauce defaults to it.
    await ok(db, vero, [{ type: "item.remove", target: { name: "fish sauce" } }], { text: "threw out the fish sauce" });
    await ok(db, vero, [{ type: "item.add", fields: { name: said("fish sauce") } }], { text: "bought fish sauce" });
    expect((await getKitchenState(db, vero)).items[0].category).toEqual({ value: "canned_jarred", basis: "inferred", confidence: "high" });
  });

  it("Undo of a correction restores the guess and removes the remembered row", async () => {
    const t = await newKitchen(db, ["Vero"]);
    const vero = await t.scope("Vero");
    await ok(db, vero, [{ type: "item.add", fields: { name: said("nước mắm") } }], { text: "bought nước mắm" });
    const fix = await ok(
      db,
      vero,
      [{ type: "item.update", target: { name: "nước mắm" }, fields: { category: said("other") } }],
      { text: "nước mắm goes under other" },
    );
    expect(await prefs(t.kitchenId)).toHaveLength(1);
    const undone = await undo(db, vero, { changeSetId: fix.changeSetId, tapId: `tap-${randomUUID()}`, basedOnVersion: fix.newVersion });
    expect(undone.ok).toBe(true);
    expect((await getKitchenState(db, vero)).items[0].category).toEqual(medium("sauces_condiments"));
    expect(await prefs(t.kitchenId)).toEqual([]);
  });
});
