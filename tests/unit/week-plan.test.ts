/**
 * Dated week plan (0045 KOS1) and the week's missing ingredients (KOS12), in memory: the real
 * validate → apply path, the week view grouping and the week's needs. People are fictional.
 */
import { describe, expect, it } from "vitest";
import type { RecipeIngredient } from "@/contracts/operations";
import { isRecipeNeed } from "@/contracts/kitchen-state";
import { getKitchenEntity, kitchenTouchedKeys, replay } from "@/domains/kitchen/state";
import type { Plan, RevertPlan } from "@/domains/kitchen/validate";
import { computeWeekNeeds, weekNeedsRange } from "@/domains/kitchen/week-needs";
import { buildWeekPlan } from "@/shared/week-plan";
import { MemoryKitchen, said } from "../support/memory-kitchen";

// MemoryKitchen's clock is 2026-10-14 (a Wednesday), UTC.
const TODAY = "2026-10-14";
const rejected = (p: Plan) => p.rejected.map((r) => r.reason.code);
const summaries = (p: Plan) => p.applied.map((a) => a.summary.code);

function choose(k: MemoryKitchen, title: string): string {
  const plan = k.tap([{ type: "meal.choose", target: { title } }]);
  return plan.applied[0].refs[0].id;
}

function recipe(k: MemoryKitchen, mealId: string, ingredients: RecipeIngredient[]) {
  k.tap([{ type: "recipe.save", target: { mealId }, source: "ai", text: "", ingredients, steps: ["Cook."], basicsAssumed: [] }]);
}

function revertPlan(k: MemoryKitchen, plan: Plan): RevertPlan {
  const csId = plan.events[0].changeSetId;
  const first = k.events.findIndex((e) => e.changeSetId === csId);
  const before = replay(k.events.slice(0, first));
  const restore: Record<string, unknown> = {};
  for (const key of new Set(k.events.filter((e) => e.changeSetId === csId).flatMap(kitchenTouchedKeys))) {
    restore[key] = getKitchenEntity(before, key);
  }
  return { ok: true, restoreByStream: { [`kitchen:${k.kitchenId}`]: restore } };
}
function undo(k: MemoryKitchen, plan: Plan): Plan {
  const csId = plan.events[0].changeSetId;
  return k.tap([{ type: "changeset.revert", target: { changeSetId: csId } }], { reverts: new Map([[csId, revertPlan(k, plan)]]) });
}

const meal = (k: MemoryKitchen, id: string) => k.state().meals.find((m) => m.id === id);

describe("a planned meal gets an optional day (KOS1)", () => {
  it("plan for a day: a chosen meal is planned and dated in one operation and one change set", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Chicken curry");
    const plan = k.tap([{ type: "meal.plan", target: { mealId: id }, date: "2026-10-20" }]);
    expect(rejected(plan)).toEqual([]);
    expect(plan.applied).toHaveLength(1);
    expect(plan.applied[0].summary).toMatchObject({
      code: "MEAL_PLANNED_FOR",
      params: { title: "Chicken curry", date: "2026-10-20", day: "Tue, Oct 20" },
      text: "Planned Chicken curry for Tue, Oct 20",
    });
    expect(new Set(plan.events.map((e) => e.changeSetId)).size).toBe(1);
    expect(meal(k, id)).toMatchObject({ status: "planned", plannedFor: "2026-10-20" });
    expect(k.state().plan).toEqual([id]);
    // Replaying the log gives the same state (projections are just this).
    expect(k.replayKitchen()).toEqual(k.kitchen);
  });

  it("undated still works exactly as before", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Pasta");
    const plan = k.tap([{ type: "meal.plan", target: { mealId: id } }]);
    expect(summaries(plan)).toEqual(["MEAL_PLANNED"]);
    expect(meal(k, id)?.plannedFor).toBeUndefined();
    // Planning again without a day changes nothing (and never clears a day).
    expect(k.tap([{ type: "meal.plan", target: { mealId: id } }]).events).toEqual([]);
  });

  it("set, change and clear the day; each is its own change set with Undo", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Pasta");
    k.tap([{ type: "meal.plan", target: { mealId: id } }]);

    const set = k.tap([{ type: "meal.date", target: { mealId: id }, date: "2026-10-16" }]);
    expect(set.applied[0].summary).toMatchObject({ code: "MEAL_DATE_SET", params: { date: "2026-10-16", day: "Fri, Oct 16" } });
    const moved = k.say("move the pasta to Saturday", [{ type: "meal.date", target: { mealId: id }, date: "2026-10-17" }]);
    expect(moved.applied[0].summary).toMatchObject({ code: "MEAL_DATE_SET", text: "Moved Pasta to Sat, Oct 17" });
    expect(meal(k, id)?.plannedFor).toBe("2026-10-17");

    const cleared = k.tap([{ type: "meal.date", target: { mealId: id }, date: null }]);
    expect(cleared.applied[0].summary).toMatchObject({ code: "MEAL_DATE_CLEARED", text: "Pasta: no day set" });
    expect(meal(k, id)?.plannedFor).toBeUndefined();
    expect(meal(k, id)?.status).toBe("planned");

    // Undo the clear: the day comes back; undo the move: the earlier day comes back.
    expect(rejected(undo(k, cleared))).toEqual([]);
    expect(meal(k, id)?.plannedFor).toBe("2026-10-17");
    expect(k.replayKitchen()).toEqual(k.kitchen);
  });

  it("Undo of 'plan for a day' takes the meal back to chosen, with no day", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Pho");
    const plan = k.tap([{ type: "meal.plan", target: { mealId: id }, date: "2026-10-15" }]);
    undo(k, plan);
    expect(meal(k, id)).toMatchObject({ status: "chosen" });
    expect(meal(k, id)?.plannedFor).toBeUndefined();
  });

  it("the same day again, or clearing an undated meal, is a no-change", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Pasta");
    k.tap([{ type: "meal.plan", target: { mealId: id }, date: "2026-10-16" }]);
    expect(k.tap([{ type: "meal.date", target: { mealId: id }, date: "2026-10-16" }]).events).toEqual([]);
    expect(k.tap([{ type: "meal.plan", target: { mealId: id }, date: "2026-10-16" }]).events).toEqual([]);
    const other = choose(k, "Soup");
    k.tap([{ type: "meal.plan", target: { mealId: other } }]);
    expect(summaries(k.tap([{ type: "meal.date", target: { mealId: other }, date: null }]))).toEqual(["NO_CHANGE"]);
  });

  it("a chosen meal given a day by meal.date is planned for it; a cooking meal can keep a day", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Tacos");
    expect(summaries(k.tap([{ type: "meal.date", target: { mealId: id }, date: "2026-10-18" }]))).toEqual(["MEAL_PLANNED_FOR"]);
    expect(meal(k, id)).toMatchObject({ status: "planned", plannedFor: "2026-10-18" });
    k.tap([{ type: "meal.transition", target: { mealId: id }, to: "cooking" }]);
    expect(meal(k, id)).toMatchObject({ status: "cooking", plannedFor: "2026-10-18" });
  });

  it("done or cancelled meals can't get a day", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Soup");
    k.tap([{ type: "meal.transition", target: { mealId: id }, to: "cancelled" }]);
    expect(rejected(k.tap([{ type: "meal.date", target: { mealId: id }, date: "2026-10-15" }]))).toEqual(["INVALID_TRANSITION"]);
    expect(rejected(k.tap([{ type: "meal.date", target: { mealId: id }, date: null }]))).toEqual(["INVALID_TRANSITION"]);
    expect(rejected(k.tap([{ type: "meal.plan", target: { mealId: id }, date: "2026-10-15" }]))).toEqual(["INVALID_TRANSITION"]);
  });

  it("'plan the omelette for Friday' from an idea card: choose + dated plan in one change set", () => {
    const k = new MemoryKitchen();
    k.ideas.set("idea-1", { name: "Omelette" });
    const plan = k.tap([
      { type: "meal.choose", target: { ideaId: "idea-1" } },
      { type: "meal.plan", target: { ideaId: "idea-1" }, date: "2026-10-16" },
    ]);
    expect(summaries(plan)).toEqual(["MEAL_CHOSEN", "MEAL_PLANNED_FOR"]);
    expect(k.state().meals[0]).toMatchObject({ title: "Omelette", status: "planned", plannedFor: "2026-10-16" });
  });
});

describe("the plan window: yesterday to 21 days ahead (KOS1)", () => {
  const cases: Array<[string, boolean]> = [
    ["2026-10-13", true], // yesterday
    ["2026-10-12", false], // two days ago
    ["2026-10-14", true], // today
    ["2026-11-04", true], // 21 days ahead
    ["2026-11-05", false], // 22 days ahead
  ];
  it.each(cases)("%s → allowed %s", (date, allowed) => {
    const k = new MemoryKitchen();
    const id = choose(k, "Curry");
    const plan = k.tap([{ type: "meal.plan", target: { mealId: id }, date }]);
    if (allowed) {
      expect(rejected(plan)).toEqual([]);
    } else {
      expect(rejected(plan)).toEqual(["DATE_OUT_OF_WINDOW"]);
      expect(plan.rejected[0].reason.params).toMatchObject({ title: "Curry", date, from: "2026-10-13", to: "2026-11-04" });
      expect(plan.rejected[0].reason.text).toMatch(/outside the plan\. Pick a day from yesterday to 3 weeks ahead/);
      expect(meal(k, id)).toMatchObject({ status: "chosen" });
    }
  });

  it("counts from the person's own today, not the server's UTC date", () => {
    // 2026-10-14 18:xx UTC, but for someone whose day is already the 15th (e.g. far east),
    // "yesterday" is the 14th and the 13th is out.
    const k = new MemoryKitchen();
    const id = choose(k, "Curry");
    expect(rejected(k.tap([{ type: "meal.date", target: { mealId: id }, date: "2026-10-13" }], { today: "2026-10-15" }))).toEqual([
      "DATE_OUT_OF_WINDOW",
    ]);
    expect(rejected(k.tap([{ type: "meal.date", target: { mealId: id }, date: "2026-11-05" }], { today: "2026-10-15" }))).toEqual([]);
  });

  it("clearing a day is always allowed, even for a day that has slipped out of the window", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Curry");
    k.tap([{ type: "meal.plan", target: { mealId: id }, date: "2026-10-13" }]);
    // Days later, the 13th is out of the window; it can still be cleared.
    expect(summaries(k.tap([{ type: "meal.date", target: { mealId: id }, date: null }], { today: "2026-10-20" }))).toEqual([
      "MEAL_DATE_CLEARED",
    ]);
  });

  it("a bad date never reaches validation (the contract refuses it)", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Curry");
    expect(() => k.tap([{ type: "meal.date", target: { mealId: id }, date: "2026-02-30" }])).toThrow();
  });
});

describe("the week view: the plan grouped by day (KOS1)", () => {
  it("days with their meals in plan order, plus earlier, later and undated", () => {
    const k = new MemoryKitchen();
    const a = choose(k, "Curry");
    const b = choose(k, "Pasta");
    const c = choose(k, "Pho");
    const d = choose(k, "Tacos");
    const e = choose(k, "Soup");
    const f = choose(k, "Salad");
    k.tap([{ type: "meal.plan", target: { mealId: a }, date: "2026-10-16" }]);
    k.tap([{ type: "meal.plan", target: { mealId: b } }]);
    k.tap([{ type: "meal.plan", target: { mealId: c }, date: "2026-10-16" }]);
    k.tap([{ type: "meal.plan", target: { mealId: d }, date: "2026-10-13" }]);
    k.tap([{ type: "meal.plan", target: { mealId: e }, date: "2026-10-30" }]);
    k.tap([{ type: "meal.plan", target: { mealId: f }, date: "2026-10-14" }]);
    k.tap([{ type: "meal.transition", target: { mealId: f }, to: "cooking" }]);

    const week = buildWeekPlan(k.state(), TODAY);
    expect(week).toMatchObject({ today: TODAY, from: TODAY, to: "2026-10-20", window: { from: "2026-10-13", to: "2026-11-04" } });
    expect(week.days.map((x) => x.date)).toEqual([
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
    expect(week.days[0].mealIds).toEqual([f]);
    expect(week.days[2].mealIds).toEqual([a, c]);
    expect(week.earlier).toEqual([d]);
    expect(week.later).toEqual([e]);
    expect(week.undated).toEqual([b]);
  });

  it("a custom range across a month end, and an empty plan", () => {
    const k = new MemoryKitchen();
    const a = choose(k, "Curry");
    k.tap([{ type: "meal.plan", target: { mealId: a }, date: "2026-11-01" }]);
    const week = buildWeekPlan(k.state(), TODAY, { from: "2026-10-29", days: 5 });
    expect(week.days.map((x) => x.date)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(week.days[3].mealIds).toEqual([a]);
    expect(buildWeekPlan({ meals: [], plan: [] }, TODAY).days.every((x) => x.mealIds.length === 0)).toBe(true);
  });
});

describe("the week's missing ingredients (KOS12)", () => {
  function setUp() {
    const k = new MemoryKitchen();
    k.tap([
      { type: "item.add", fields: { name: said("garlic") } },
      { type: "item.add", fields: { name: said("chicken thighs") } },
    ]);
    const curry = choose(k, "Chicken curry");
    recipe(k, curry, [
      { name: "chicken thighs" },
      { name: "coconut milk", amount: "1 can" },
      { name: "lemongrass" },
      { name: "salt", basic: true },
    ]);
    k.tap([{ type: "meal.plan", target: { mealId: curry }, date: "2026-10-15" }]);
    const pho = choose(k, "Pho");
    recipe(k, pho, [{ name: "Lemongrass" }, { name: "rice noodles" }, { name: "garlic" }]);
    k.tap([{ type: "meal.plan", target: { mealId: pho }, date: "2026-10-18" }]);
    const pasta = choose(k, "Pasta");
    recipe(k, pasta, [{ name: "spaghetti" }]);
    k.tap([{ type: "meal.plan", target: { mealId: pasta } }]);
    return { k, curry, pho, pasta };
  }

  it("collects each planned meal's Need items, merges duplicates, leaves out kitchen items and basics", () => {
    const { k, curry, pho, pasta } = setUp();
    const needs = computeWeekNeeds(k.kitchen, weekNeedsRange(TODAY));
    expect(needs).toMatchObject({ from: TODAY, to: "2026-10-20", includeUndated: true });
    expect(needs.meals.map((m) => m.mealId)).toEqual([curry, pho, pasta]);
    expect(needs.items.map((i) => i.name)).toEqual(["coconut milk", "lemongrass", "rice noodles", "spaghetti"]);
    const lemongrass = needs.items.find((i) => i.standardName === "lemongrass")!;
    expect(lemongrass.meals.map((m) => m.title)).toEqual(["Chicken curry", "Pho"]);
    expect(needs.items.every((i) => !i.onList)).toBe(true);
  });

  it("range: undated left out on request; dates outside the range and cooking meals left out", () => {
    const { k, pho } = setUp();
    const late = choose(k, "Ramen");
    recipe(k, late, [{ name: "ramen noodles" }]);
    k.tap([{ type: "meal.plan", target: { mealId: late }, date: "2026-10-25" }]);
    const cooking = choose(k, "Stir fry");
    recipe(k, cooking, [{ name: "bok choy" }]);
    k.tap([{ type: "meal.transition", target: { mealId: cooking }, to: "cooking" }]);

    const dated = computeWeekNeeds(k.kitchen, weekNeedsRange(TODAY, { includeUndated: false }));
    expect(dated.items.map((i) => i.name)).toEqual(["coconut milk", "lemongrass", "rice noodles"]);
    const later = computeWeekNeeds(k.kitchen, weekNeedsRange(TODAY, { from: "2026-10-18", to: "2026-10-25", includeUndated: false }));
    expect(later.meals.map((m) => m.mealId)).toEqual([pho, late]);
    // Named as in the first recipe that needs it (here Pho's "Lemongrass").
    expect(later.items.map((i) => i.name)).toEqual(["Lemongrass", "rice noodles", "ramen noodles"]);
  });

  it("items already on the list are flagged (muted, not pre-selected)", () => {
    const { k } = setUp();
    k.tap([{ type: "shopping.add", fields: { name: said("Coconut milk") } }]);
    const needs = computeWeekNeeds(k.kitchen, weekNeedsRange(TODAY));
    expect(needs.items.find((i) => i.standardName === "coconut milk")?.onList).toBe(true);
    expect(needs.items.filter((i) => i.onList)).toHaveLength(1);
  });

  it("a meal without a recipe is listed with hasRecipe false and adds nothing", () => {
    const k = new MemoryKitchen();
    const id = choose(k, "Tacos");
    k.tap([{ type: "meal.plan", target: { mealId: id }, date: TODAY }]);
    expect(computeWeekNeeds(k.kitchen, weekNeedsRange(TODAY))).toMatchObject({
      meals: [{ mealId: id, title: "Tacos", plannedFor: TODAY, hasRecipe: false }],
      items: [],
    });
  });

  it("range limits: `to` before `from` is one day; at most 23 days", () => {
    expect(weekNeedsRange(TODAY, { from: "2026-10-20", to: "2026-10-10" })).toEqual({ from: "2026-10-20", to: "2026-10-20", includeUndated: true });
    expect(weekNeedsRange(TODAY, { to: "2027-01-01" }).to).toBe("2026-11-05");
  });

  // Regression (found building KOS12): a recipe ingredient linked to a kitchen item that has
  // since run Out still showed under "In your kitchen", so it was never a Need and never added.
  it("an ingredient linked to an item that is Out now is a Need again", () => {
    const k = new MemoryKitchen();
    k.tap([{ type: "item.add", fields: { name: said("fish sauce") } }]);
    const itemId = Object.values(k.kitchen.items)[0].id;
    const pho = choose(k, "Pho");
    recipe(k, pho, [{ name: "fish sauce", itemId }]);
    k.tap([{ type: "meal.plan", target: { mealId: pho }, date: TODAY }]);
    expect(computeWeekNeeds(k.kitchen, weekNeedsRange(TODAY)).items).toEqual([]);
    k.tap([{ type: "item.use", target: { itemId }, fields: { stock: said("out") } }]);
    expect(computeWeekNeeds(k.kitchen, weekNeedsRange(TODAY)).items.map((i) => i.name)).toEqual(["fish sauce"]);
  });

  it("isRecipeNeed matches the recipe screen's Need group", () => {
    expect(isRecipeNeed({ name: "lemongrass" })).toBe(true);
    expect(isRecipeNeed({ name: "salt", basic: true })).toBe(false);
    expect(isRecipeNeed({ name: "garlic", item: { id: "i1", name: "garlic" } })).toBe(false);
    // A link to an item row that no longer exists shows under Need on screen, so it is one.
    expect(isRecipeNeed({ name: "tofu", item: { id: "gone", missing: true } })).toBe(true);
  });
});
