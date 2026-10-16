/**
 * Refining an idea card, end to end on an embedded Postgres (ai.md §5, Vero 2026-10-15): the FAKE
 * interpreter and FAKE meal AI → `handleChatTurn` / `handleChooseMeal` → the real stores.
 * - B: "remove the yogurt from the chicken curry" changes the stored card in place (one
 *   `idea.updated`, no change set, no recipe), and the recipe written when she later chooses it
 *   leaves the yogurt out.
 * - A: once the meal has a recipe, the card follows the latest saved version, in the same turn.
 * - "Make the chicken curry without yogurt" chooses it and writes the recipe without yogurt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/db/client";
import { MIGRATIONS_FOLDER } from "@/db/client";
import { mealIdeas } from "@/db/schema";
import { StreamEvent, type MealIdea } from "@/contracts/stream";
import { createFakeInterpreter } from "@/ai/fake";
import { createFakeMealAI } from "@/ai/fake/meals";
import { handleChatTurn, handleChooseMeal } from "@/ai/turn";
import { getKitchenState, getRecipe } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { newKitchen, openLocalDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await openLocalDb());
});
afterAll(async () => {
  await close();
});

let n = 0;
async function collect(gen: AsyncGenerator<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const e of gen) {
    StreamEvent.parse(e);
    events.push(e);
  }
  return {
    events,
    types: events.map((e) => e.type),
    ideas: events.flatMap((e) => (e.type === "idea" ? [e.idea] : [])),
    updates: events.flatMap((e) => (e.type === "idea.updated" ? [e.idea] : [])),
    reply: events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join(""),
  };
}
const deps = (scope: KitchenScope) => ({ db, scope, interpreter: createFakeInterpreter(), meals: createFakeMealAI() });
const turn = (scope: KitchenScope, text: string) => collect(handleChatTurn(deps(scope), { clientMessageId: `idea-${++n}`, text }));
const choose = (scope: KitchenScope, ideaId: string) =>
  collect(handleChooseMeal({ db, scope, meals: createFakeMealAI() }, { clientMessageId: `tap-${++n}`, target: { ideaId } }));

async function anaWithCurryIdea() {
  const k = await newKitchen(db, ["Ana", "Ben"]);
  const ana = await k.scope("Ana");
  await turn(ana, "I bought chicken thighs, potatoes and greek yogurt");
  const asked = await turn(ana, "what can I make? a chicken curry with potatoes, greek yogurt and lemongrass");
  const curry = asked.ideas[0];
  return { k, ana, curry, names: async (ids: string[]) => {
    const state = await getKitchenState(db, ana);
    return ids.map((id) => state.items.find((i) => i.id === id)?.name.value);
  } };
}

describe("refining an idea with no recipe (B)", () => {
  it("edits the stored card in place: one idea.updated, no change set, no recipe, no meal", async () => {
    const { ana, curry, names } = await anaWithCurryIdea();
    expect(curry.name).toBe("Chicken curry");
    expect(await names(curry.uses)).toEqual(["chicken thighs", "potatoes", "greek yogurt"]);
    expect(curry.missing).toEqual(["lemongrass"]);
    const before = (await getKitchenState(db, ana)).version;

    const t = await turn(ana, "remove the yogurt from the chicken curry");
    expect(t.types).not.toContain("applied");
    expect(t.types).not.toContain("recipe");
    expect(t.types.filter((x) => x === "idea.updated")).toHaveLength(1);
    const card = t.updates[0];
    expect(card.ideaId).toBe(curry.ideaId);
    expect(await names(card.uses)).toEqual(["chicken thighs", "potatoes"]);
    expect(card.missing).toEqual(["lemongrass"]);
    expect(t.reply).toBe("Took the yogurt out of the Chicken curry idea.");

    const state = await getKitchenState(db, ana);
    expect(state.version).toBe(before);
    expect(state.meals).toEqual([]);
    const [row] = await db.select().from(mealIdeas).where(eq(mealIdeas.id, curry.ideaId));
    expect(row.uses).toEqual(card.uses);
    expect(row.notes).toBe("remove the yogurt from the chicken curry");

    // Choosing it later: the recipe honours the edited card.
    const c = await choose(ana, curry.ideaId);
    expect(c.types).toContain("recipe.saved");
    const mealId = (await getKitchenState(db, ana)).meals[0].id;
    const recipe = await getRecipe(db, ana, mealId);
    expect(recipe?.ingredients.map((i) => i.name)).not.toContain("greek yogurt");
    expect(recipe?.ingredients.map((i) => i.name)).toEqual(expect.arrayContaining(["chicken thighs", "potatoes", "lemongrass"]));
  });

  it("the next turn sees the edited card (uses and missing in <meal_ideas>)", async () => {
    const { ana, curry } = await anaWithCurryIdea();
    await turn(ana, "remove the yogurt from the chicken curry");
    const again = await turn(ana, "swap the chicken for greek yogurt in the first one");
    // Yogurt is back only because she asked; chicken gone. The card is still the same idea.
    expect(again.updates[0].ideaId).toBe(curry.ideaId);
    const [row] = await db.select().from(mealIdeas).where(eq(mealIdeas.id, curry.ideaId));
    expect(row.notes).toBe("remove the yogurt from the chicken curry\nswap the chicken for greek yogurt in the first one");
  });

  it("another member's turn can't touch Ana's cards (they're not shown to him)", async () => {
    const { k, curry } = await anaWithCurryIdea();
    const ben = await k.scope("Ben");
    const t = await turn(ben, "remove the yogurt from the chicken curry");
    expect(t.types).not.toContain("idea.updated");
    const [row] = await db.select().from(mealIdeas).where(and(eq(mealIdeas.id, curry.ideaId)));
    expect(row.notes).toBeNull();
  });
});

describe("the card follows its meal's latest recipe (A, C)", () => {
  it("a recipe change in chat (edit mode) updates the card in the same turn", async () => {
    const { ana, curry, names } = await anaWithCurryIdea();
    await choose(ana, curry.ideaId);
    const t = await turn(ana, "no potatoes");
    const at = t.types.indexOf("recipe.saved");
    expect(at).toBeGreaterThan(-1);
    expect(t.types.indexOf("idea.updated")).toBeGreaterThan(at);
    const card = t.updates[0] as MealIdea;
    expect(card.ideaId).toBe(curry.ideaId);
    expect(await names(card.uses)).toEqual(["chicken thighs", "greek yogurt"]);
    const [row] = await db.select().from(mealIdeas).where(eq(mealIdeas.id, curry.ideaId));
    expect(row.uses).toEqual(card.uses);
  });

  it("'make the chicken curry without yogurt' chooses it, writes the recipe without yogurt, and the card follows", async () => {
    const { ana, curry, names } = await anaWithCurryIdea();
    const t = await turn(ana, "make the chicken curry without yogurt");
    expect(t.types).toContain("applied");
    expect(t.types).toContain("recipe.saved");
    const meal = (await getKitchenState(db, ana)).meals[0];
    expect(meal.ideaId).toBe(curry.ideaId);
    const recipe = await getRecipe(db, ana, meal.id);
    expect(recipe?.ingredients.map((i) => i.name)).not.toContain("greek yogurt");
    expect(await names(t.updates[0].uses)).toEqual(["chicken thighs", "potatoes"]);
  });
});

describe("migration 0013: additive, on top of a database already at 0012", () => {
  it("adds only the empty, nullable meal_ideas.notes column", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-0013-"));
    fs.mkdirSync(path.join(dir, "meta"));
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
    const tags = (journal.entries as { idx: number; tag: string }[]).map((e) => e.tag);
    expect(tags.slice(12, 14)).toEqual(["0012_item_location_prefs", "0013_meal_idea_notes"]);
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 12);
    fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
    for (const e of journal.entries as { tag: string }[]) fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
    const old = await openLocalDb({ migrationsFolder: dir });
    try {
      const notes = async () =>
        ((await old.db.execute(sql`select column_name, is_nullable from information_schema.columns where table_name = 'meal_ideas' and column_name = 'notes'`)) as unknown as { rows: unknown[] }).rows;
      expect(await notes()).toEqual([]);
      await migrate(old.db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
      expect(await notes()).toEqual([{ column_name: "notes", is_nullable: "YES" }]);
    } finally {
      await old.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
