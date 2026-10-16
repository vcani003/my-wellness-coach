/**
 * Dated week plan (0045 KOS1) and the week's missing ingredients (KOS12) on Postgres (PGlite, the
 * real migrations):
 * - migration 0016 is additive: one empty nullable `meals.planned_for` date column; planned meals
 *   from before stay undated;
 * - plan for a day / move / clear: one change set each with Undo; projections == replay; the plan
 *   window counts from the person's own today (their time zone), not the server's;
 * - the week's needs: one change set with one Undo, source `week-plan`, merged, already-listed
 *   skipped, a chosen subset, and "nothing to add";
 * - chat (fake interpreter): "plan the curry for Tuesday", "what are we eating this week?",
 *   "add what we need for this week's meals".
 * People are fictional (Ana, Ben).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import type { ApplyResult } from "@/contracts/apply-result";
import type { RecipeIngredient } from "@/contracts/operations";
import type { StreamEvent } from "@/contracts/stream";
import { createFakeInterpreter } from "@/ai/fake";
import { handleChatTurn } from "@/ai";
import {
  addRecipeNeedsToShoppingList,
  addWeekNeedsToShoppingList,
  planMeal,
  rebuildProjections,
  setMealDay,
  undo,
} from "@/domains/kitchen/commands";
import { getKitchenState, getKitchenVersion, getWeekNeeds } from "@/domains/kitchen/queries";
import { loadKitchenEntities } from "@/domains/kitchen/store";
import type { KitchenScope } from "@/shared/membership";
import { buildWeekPlan } from "@/shared/week-plan";
import { said } from "../support/memory-kitchen";
import { newKitchen, ok, openLocalDb } from "../support/db";
import { journalTags, migrationsUpTo } from "../support/migrations";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

/** 22:30 on Friday 2026-10-16 in Los Angeles; already Saturday the 17th in UTC. */
const NOW = new Date("2026-10-17T05:30:00Z");
const LA = "America/Los_Angeles";
const tapId = () => `tap-${randomUUID().slice(0, 12)}`;
const version = (scope: KitchenScope) => getKitchenVersion(db, scope);
async function must(p: Promise<{ ok: true; result: ApplyResult } | { ok: false; error: unknown }>): Promise<ApplyResult> {
  const out = await p;
  if (!out.ok) throw new Error(`failed: ${JSON.stringify(out)}`);
  return out.result;
}

async function kitchen() {
  const t = await newKitchen(db, ["Ana", "Ben"]);
  return { t, ana: await t.scope("Ana"), ben: await t.scope("Ben") };
}

async function meal(scope: KitchenScope, title: string, ingredients?: RecipeIngredient[]): Promise<string> {
  const r = await ok(db, scope, [{ type: "meal.choose", target: { title } }]);
  const id = r.applied[0].refs[0].id;
  if (ingredients) {
    await ok(db, scope, [{ type: "recipe.save", target: { mealId: id }, source: "ai", text: "", ingredients, steps: ["Cook."], basicsAssumed: [] }]);
  }
  return id;
}

async function projectionsMatchReplay(scope: KitchenScope) {
  const before = await loadKitchenEntities(db, scope.kitchenId);
  await rebuildProjections(db, scope);
  expect(await loadKitchenEntities(db, scope.kitchenId)).toEqual(before);
}

describe("migration 0016 (KOS1): additive, on top of a database at 0015", () => {
  it("adds one empty nullable date column; an already planned meal stays undated", async () => {
    expect(journalTags().slice(-2)).toEqual(["0015_chat_pending_confirm", "0016_meal_planned_for"]);
    const at0015 = migrationsUpTo("0015_chat_pending_confirm");
    const { db: old, close: closeOld } = await openLocalDb({ migrationsFolder: at0015.dir });
    try {
      await old.execute(sql`insert into users (id, display_name) values ('ana', 'Ana')`);
      await old.execute(sql`insert into kitchens (id, name, version, created_at) values ('home', 'Home', 1, now())`);
      await old.execute(sql`
        insert into meals (id, kitchen_id, title, status, plan_position, chosen_at, created_at, created_by, updated_at, updated_by)
        values ('pho', 'home', 'Pho', 'planned', 1, now(), now(), 'ana', now(), 'ana')`);
      const at0016 = migrationsUpTo("0016_meal_planned_for");
      try {
        await migrate(old as unknown as Parameters<typeof migrate>[0], { migrationsFolder: at0016.dir });
      } finally {
        at0016.cleanup();
      }
      const cols = (await old.execute(
        sql`select data_type, is_nullable from information_schema.columns where table_name = 'meals' and column_name = 'planned_for'`,
      )) as unknown as { rows: { data_type: string; is_nullable: string }[] };
      expect(cols.rows).toEqual([{ data_type: "date", is_nullable: "YES" }]);
      const rows = (await old.execute(sql`select id, status, planned_for from meals`)) as unknown as { rows: unknown[] };
      expect(rows.rows).toEqual([{ id: "pho", status: "planned", planned_for: null }]);
    } finally {
      await closeOld();
      at0015.cleanup();
    }
  });
});

describe("plan for a day, move it, clear it (KOS1)", () => {
  it("each is one change set with Undo; the date is stored as a calendar date; projections == replay", async () => {
    const { ana, ben } = await kitchen();
    const curry = await meal(ana, "Chicken curry");

    const planned = await must(planMeal(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: curry, date: "2026-10-20", timeZone: LA, now: NOW }));
    expect(planned.undoable).toBe(true);
    expect(planned.applied.map((a) => a.summary.code)).toEqual(["MEAL_PLANNED_FOR"]);
    expect(planned.state.meals.find((m) => m.id === curry)).toMatchObject({ status: "planned", plannedFor: "2026-10-20" });
    const raw = (await db.execute(sql`select planned_for from meals where id = ${curry}`)) as unknown as { rows: { planned_for: string }[] };
    expect(raw.rows[0].planned_for).toBe("2026-10-20");

    // Ben sees the same day (shared plan).
    expect((await getKitchenState(db, ben)).meals.find((m) => m.id === curry)?.plannedFor).toBe("2026-10-20");

    const moved = await must(setMealDay(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: curry, date: "2026-10-23", timeZone: LA, now: NOW }));
    expect(moved.applied[0].summary).toMatchObject({ code: "MEAL_DATE_SET", params: { date: "2026-10-23", day: "Fri, Oct 23" } });
    const cleared = await must(setMealDay(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: curry, date: null, timeZone: LA, now: NOW }));
    expect(cleared.applied[0].summary.code).toBe("MEAL_DATE_CLEARED");
    expect(cleared.state.meals.find((m) => m.id === curry)?.plannedFor).toBeUndefined();
    await projectionsMatchReplay(ana);

    // Undo the clear → back on Friday the 23rd.
    const undone = await must(undo(db, ana, { changeSetId: cleared.changeSetId, tapId: tapId(), basedOnVersion: cleared.newVersion }));
    expect(undone.rejected).toEqual([]);
    expect(undone.state.meals.find((m) => m.id === curry)?.plannedFor).toBe("2026-10-23");
    await projectionsMatchReplay(ana);

    // A double tap is harmless (same tapId → same result, nothing new).
    const tap = tapId();
    const v = await version(ana);
    await must(setMealDay(db, ana, { tapId: tap, basedOnVersion: v, mealId: curry, date: "2026-10-24", timeZone: LA, now: NOW }));
    await must(setMealDay(db, ana, { tapId: tap, basedOnVersion: v, mealId: curry, date: "2026-10-24", timeZone: LA, now: NOW }));
    expect(await version(ana)).toBe(v + 1);
  });

  it("the window counts from the person's own today: yesterday in LA is fine, in UTC it's two days ago", async () => {
    const { ana } = await kitchen();
    const curry = await meal(ana, "Chicken curry");
    // In LA it's still Friday the 16th, so Thursday the 15th is "yesterday".
    const la = await must(planMeal(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: curry, date: "2026-10-15", timeZone: LA, now: NOW }));
    expect(la.rejected).toEqual([]);
    const pho = await meal(ana, "Pho");
    // With no time zone (UTC), it's Saturday the 17th, so the 15th is out.
    const utc = await must(planMeal(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: pho, date: "2026-10-15", now: NOW }));
    expect(utc.rejected.map((r) => r.reason.code)).toEqual(["DATE_OUT_OF_WINDOW"]);
    expect(utc.rejected[0].reason.text).toBe("Thu, Oct 15 is outside the plan. Pick a day from yesterday to 3 weeks ahead.");
    // 21 days ahead of LA's Friday is Friday Nov 6; Nov 7 is out.
    const edge = await must(setMealDay(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: pho, date: "2026-11-06", timeZone: LA, now: NOW }));
    expect(edge.rejected).toEqual([]);
    const over = await must(setMealDay(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: pho, date: "2026-11-07", timeZone: LA, now: NOW }));
    expect(over.rejected.map((r) => r.reason.code)).toEqual(["DATE_OUT_OF_WINDOW"]);
  });

  it("the week view groups the shared state by day", async () => {
    const { ana } = await kitchen();
    const curry = await meal(ana, "Chicken curry");
    const pasta = await meal(ana, "Pasta");
    await must(planMeal(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: curry, date: "2026-10-18", timeZone: LA, now: NOW }));
    await must(planMeal(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: pasta, timeZone: LA, now: NOW }));
    const week = buildWeekPlan(await getKitchenState(db, ana), "2026-10-16");
    expect(week.days.find((d) => d.date === "2026-10-18")?.mealIds).toEqual([curry]);
    expect(week.undated).toEqual([pasta]);
  });
});

describe("the week's missing ingredients (KOS12)", () => {
  async function planned(scope: KitchenScope) {
    await ok(db, scope, [{ type: "item.add", fields: { name: said("garlic") } }]);
    const curry = await meal(scope, "Chicken curry", [{ name: "coconut milk" }, { name: "lemongrass" }, { name: "garlic" }, { name: "salt", basic: true }]);
    const pho = await meal(scope, "Pho", [{ name: "rice noodles" }, { name: "lemongrass" }]);
    const later = await meal(scope, "Ramen", [{ name: "ramen noodles" }]);
    await must(planMeal(db, scope, { tapId: tapId(), basedOnVersion: await version(scope), mealId: curry, date: "2026-10-17", timeZone: LA, now: NOW }));
    await must(planMeal(db, scope, { tapId: tapId(), basedOnVersion: await version(scope), mealId: pho, timeZone: LA, now: NOW }));
    await must(planMeal(db, scope, { tapId: tapId(), basedOnVersion: await version(scope), mealId: later, date: "2026-10-30", timeZone: LA, now: NOW }));
    return { curry, pho, later };
  }

  it("preview, then Add: one change set with one Undo, source week-plan, merged, already-listed skipped", async () => {
    const { ana, ben } = await kitchen();
    await planned(ana);
    await ok(db, ben, [{ type: "shopping.add", fields: { name: said("coconut milk") } }]);

    const preview = await getWeekNeeds(db, ana, { today: "2026-10-16" });
    expect(preview.items.map((i) => [i.name, i.onList, i.meals.map((m) => m.title)])).toEqual([
      ["coconut milk", true, ["Chicken curry"]],
      ["lemongrass", false, ["Chicken curry", "Pho"]],
      ["rice noodles", false, ["Pho"]],
    ]);

    const added = await must(addWeekNeedsToShoppingList(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), timeZone: LA, now: NOW }));
    expect(added.undoable).toBe(true);
    expect(added.applied.map((a) => a.summary.code)).toEqual(["SHOPPING_ADDED", "SHOPPING_ADDED"]);
    const list = added.state.shoppingList.map((e) => [e.name.value, e.source]);
    expect(list).toEqual([
      ["coconut milk", "chat"],
      ["lemongrass", "week-plan"],
      ["rice noodles", "week-plan"],
    ]);
    await projectionsMatchReplay(ana);

    const undone = await must(undo(db, ana, { changeSetId: added.changeSetId, tapId: tapId(), basedOnVersion: added.newVersion }));
    expect(undone.state.shoppingList.map((e) => e.name.value)).toEqual(["coconut milk"]);
  });

  it("a chosen subset; a wider range; nothing to add → WEEK_NEEDS_NONE and nothing changes", async () => {
    const { ana } = await kitchen();
    await planned(ana);
    const some = await must(addWeekNeedsToShoppingList(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), timeZone: LA, now: NOW, names: ["Lemongrass"] }));
    expect(some.state.shoppingList.map((e) => e.name.value)).toEqual(["lemongrass"]);

    const wide = await must(
      addWeekNeedsToShoppingList(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), timeZone: LA, now: NOW, to: "2026-10-31", includeUndated: false }),
    );
    expect(wide.state.shoppingList.map((e) => e.name.value)).toEqual(["lemongrass", "coconut milk", "ramen noodles"]);

    const v = await version(ana);
    const none = await addWeekNeedsToShoppingList(db, ana, { tapId: tapId(), basedOnVersion: v, timeZone: LA, now: NOW, to: "2026-10-31" });
    expect(none.ok).toBe(true); // rice noodles (undated Pho) still needed
    const nothing = await addWeekNeedsToShoppingList(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), timeZone: LA, now: NOW, to: "2026-10-31" });
    expect(nothing).toMatchObject({ ok: false, error: { reason: { code: "WEEK_NEEDS_NONE" }, retryable: false } });
  });
});

// Regression (found building KOS12): "Add Need items" skipped an ingredient whose kitchen item had
// since been removed, though the recipe screen shows it under Need.
describe("a recipe's Need items (0027), shared rule with KOS12", () => {
  it("an ingredient linked to a removed item is added like any Need", async () => {
    const { ana } = await kitchen();
    const added = await ok(db, ana, [{ type: "item.add", fields: { name: said("tofu") } }]);
    const itemId = added.applied[0].refs[0].id;
    const id = await meal(ana, "Mapo tofu", [{ name: "tofu", itemId }, { name: "chili bean paste" }]);
    await ok(db, ana, [{ type: "item.remove", target: { itemId } }]);
    const r = await must(addRecipeNeedsToShoppingList(db, ana, { tapId: tapId(), basedOnVersion: await version(ana), mealId: id }));
    expect(r.state.shoppingList.map((e) => e.name.value)).toEqual(["tofu", "chili bean paste"]);
  });
});

describe("chat (fake interpreter)", () => {
  let n = 0;
  async function turn(scope: KitchenScope, text: string) {
    const events: StreamEvent[] = [];
    const interpreter = createFakeInterpreter();
    for await (const e of handleChatTurn({ db, scope, interpreter }, { clientMessageId: `wk-${randomUUID().slice(0, 6)}-${++n}`, text, timeZone: LA, now: NOW })) {
      events.push(e);
    }
    const applied = events.find((e) => e.type === "applied");
    return {
      result: applied?.type === "applied" ? applied.result : null,
      reply: events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join(""),
      clarification: events.find((e) => e.type === "clarification"),
    };
  }

  it("plan for Tuesday, move to Saturday, what's this week, add what we need: each from the person's own today", async () => {
    const { ana } = await kitchen();
    await meal(ana, "Chicken curry", [{ name: "coconut milk" }, { name: "lemongrass" }]);
    await meal(ana, "Pasta", [{ name: "spaghetti" }]);

    // LA Friday the 16th → Tuesday the 20th (UTC would already be Saturday).
    const plan = await turn(ana, "plan the curry for Tuesday");
    expect(plan.result?.applied[0].summary).toMatchObject({ code: "MEAL_PLANNED_FOR", params: { date: "2026-10-20" } });
    expect(plan.reply).toBe("Done, it's on the plan.");
    await turn(ana, "plan the pasta for tomorrow");
    const moved = await turn(ana, "move the pasta to Sunday");
    expect(moved.result?.applied[0].summary).toMatchObject({ code: "MEAL_DATE_SET", params: { date: "2026-10-18" } });

    const vague = await turn(ana, "move the curry to next week");
    expect(vague.result).toBeNull();
    expect(vague.clarification).toMatchObject({ question: "Which day?" });

    const week = await turn(ana, "what are we eating this week?");
    expect(week.result).toBeNull();
    expect(week.reply).toBe("This week: Sun, Oct 18: Pasta. Tue, Oct 20: Chicken curry.");

    const asked = await turn(ana, "what do we need for this week's meals?");
    expect(asked.result).toBeNull();
    expect(asked.reply).toBe("For this week's meals you need: spaghetti, coconut milk, and lemongrass. Want me to add these to your list?");
    expect((await getKitchenState(db, ana)).shoppingList).toEqual([]);

    const add = await turn(ana, "add what we need for this week's meals");
    expect(add.result?.undoable).toBe(true);
    expect(add.result?.applied.map((a) => a.summary.code)).toEqual(["SHOPPING_ADDED", "SHOPPING_ADDED", "SHOPPING_ADDED"]);
    expect(add.result?.state.shoppingList.map((e) => [e.name.value, e.source])).toEqual([
      ["spaghetti", "week-plan"],
      ["coconut milk", "week-plan"],
      ["lemongrass", "week-plan"],
    ]);
    expect(add.reply).toBe("Added 3 things for this week's meals: spaghetti, coconut milk, and lemongrass.");

    const again = await turn(ana, "add what we need for this week's meals");
    expect(again.result).toBeNull();
    expect(again.reply).toBe("You have everything this week's meals need. Already on your list: spaghetti, coconut milk, and lemongrass.");
  });
});
