/**
 * Migration 0011 (recipe box, 0040) on PGlite: additive only (0028). On a database as the last
 * build left it, Done meals get `cooked_by` and saved notes get `note_by` backfilled from their
 * events, equal to what replaying those events gives; nothing else is rewritten.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "@/db/client";
import { kitchens } from "@/db/schema";
import { getRecipe, listPastMeals } from "@/domains/kitchen/queries";
import { replay } from "@/domains/kitchen/state";
import { loadKitchenEntities } from "@/domains/kitchen/store";
import { appendEvents } from "@/shared/events/store";
import type { EventEnvelope } from "@/shared/events/types";
import { createKitchen } from "@/shared/identity";
import { requireMember } from "@/shared/membership";
import { openLocalDb } from "../support/db";

describe("migration 0011: who cooked and who wrote the note, from the events", () => {
  it("backfills cooked_by / note_by to match a replay, and leaves other rows alone", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-0010-"));
    fs.mkdirSync(path.join(dir, "meta"));
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 10);
    fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries as { tag: string }[]) fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
    const { db, close } = await openLocalDb({ migrationsFolder: dir });
    try {
      await db.execute(sql`insert into users (id, display_name) values ('ana', 'Ana'), ('ben', 'Ben')`);
      await createKitchen(db, { id: "home", name: "Home", memberIds: ["ana", "ben"] });

      let n = 0;
      const ev = (actor: string, type: string, payload: Record<string, unknown>): EventEnvelope => {
        n += 1;
        return {
          id: `legacy-${n}`, stream: "kitchen:home", seq: 0, type, v: 1, actor, via: "button",
          recordedAt: new Date(Date.UTC(2026, 9, n, 18)).toISOString(), occurredAt: null, changeSetId: `cs-${n}`,
          sourceMessageId: null, reverses: null, corrects: null, payload,
        };
      };
      const legacy = [
        ev("ana", "meal.chosen", { mealId: "curry", title: "Chicken curry", isNew: true }),
        ev("ana", "recipe.saved", { recipeId: "r1", mealId: "curry", version: 1, source: "ai", text: "t", ingredients: [{ name: "chicken" }], steps: [], basicsAssumed: [] }),
        ev("ana", "meal.transitioned", { mealId: "curry", from: "chosen", to: "cooking", planPosition: 1 }),
        ev("ana", "meal.transitioned", { mealId: "curry", from: "cooking", to: "done", planPosition: null }),
        ev("ben", "meal.noted", { mealId: "curry", note: "used half the coconut milk" }),
        ev("ben", "meal.chosen", { mealId: "soup", title: "Soup", isNew: true }),
        ev("ben", "meal.transitioned", { mealId: "soup", from: "chosen", to: "cooking", planPosition: 1 }),
        ev("ben", "meal.transitioned", { mealId: "soup", from: "cooking", to: "done", planPosition: null, note: "too salty" }),
        ev("ana", "meal.chosen", { mealId: "tacos", title: "Tacos", isNew: true }),
      ];
      await appendEvents(db, legacy);
      const state = replay(legacy);
      for (const m of Object.values(state.meals)) {
        await db.execute(sql`
          insert into meals (id, kitchen_id, title, status, chosen_at, recipe_id, note, cooked_at, created_at, created_by, updated_at, updated_by)
          values (${m.id}, 'home', ${m.title}, ${m.status}, ${m.chosenAt}::timestamptz, ${m.recipeId ?? null}, ${m.note ?? null},
            ${m.cookedAt ?? null}::timestamptz, ${m.createdAt}::timestamptz, ${m.createdBy}, ${m.updatedAt}::timestamptz, ${m.updatedBy})`);
      }
      for (const r of Object.values(state.recipes)) {
        await db.execute(sql`
          insert into recipes (id, kitchen_id, meal_id, version, source, text, ingredients, steps, basics_assumed, created_at, created_by, updated_at, updated_by)
          values (${r.id}, 'home', ${r.mealId}, ${r.version}, ${r.source}, ${r.text}, ${JSON.stringify(r.ingredients)}::jsonb, '[]'::jsonb, '[]'::jsonb,
            ${r.createdAt}::timestamptz, ${r.createdBy}, ${r.updatedAt}::timestamptz, ${r.updatedBy})`);
      }
      await db.update(kitchens).set({ version: legacy.length }).where(eq(kitchens.id, "home"));

      await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });

      const rows = ((await db.execute(sql`select id, cooked_by, note_by, made_again_from_meal_id from meals order by id`)) as unknown as {
        rows: Record<string, unknown>[];
      }).rows;
      expect(rows).toEqual([
        { id: "curry", cooked_by: "ana", note_by: "ben", made_again_from_meal_id: null },
        { id: "soup", cooked_by: "ben", note_by: "ben", made_again_from_meal_id: null },
        { id: "tacos", cooked_by: null, note_by: null, made_again_from_meal_id: null },
      ]);
      // The backfill equals a replay of the old events.
      const loaded = await loadKitchenEntities(db, "home");
      expect(loaded.meals).toEqual(replay(legacy).meals);
      expect(loaded.recipes).toEqual(replay(legacy).recipes);

      const ana = await requireMember(db, "ana", "home");
      const list = await listPastMeals(db, ana, {});
      expect(list.map((m) => [m.title, m.lastCookedBy, m.note])).toEqual([
        ["Soup", { id: "ben", name: "Ben" }, { text: "too salty", by: { id: "ben", name: "Ben" } }],
        ["Chicken curry", { id: "ana", name: "Ana" }, { text: "used half the coconut milk", by: { id: "ben", name: "Ben" } }],
      ]);
      expect((await getRecipe(db, ana, "curry"))?.note?.by).toEqual({ id: "ben", name: "Ben" });
    } finally {
      await close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
