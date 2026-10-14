/**
 * `apply` + validation on the primary journey (0005) and the after-cooking flow (0013),
 * and the key check: replaying all events equals the step-by-step state.
 */
import { describe, expect, it } from "vitest";
import { MemoryKitchen, said } from "../support/memory-kitchen";
import { afterCooking, primaryJourney } from "../support/fixtures";

function runPrimaryJourney() {
  const k = new MemoryKitchen();
  const steps: Record<string, ReturnType<MemoryKitchen["propose"]>> = {};
  steps.bought = k.say(primaryJourney.bought.text, primaryJourney.bought.ops);
  steps.froze = k.say(primaryJourney.froze.text, primaryJourney.froze.ops);
  for (const idea of primaryJourney.ideas) k.ideas.set(idea.ideaId, { name: idea.name });
  steps.choose = k.tap(primaryJourney.choose("idea-curry"));
  const mealId = steps.choose.applied[0].refs[0].id;
  steps.plan = k.say(primaryJourney.addToPlan.text, primaryJourney.addToPlan.ops(mealId));
  return { k, steps, mealId };
}

describe("primary journey (0005)", () => {
  it("step 1: the four items appear, with only the name known", () => {
    const { k, steps } = runPrimaryJourney();
    expect(steps.bought.rejected).toEqual([]);
    expect(steps.bought.applied.map((a) => a.summary.text)).toEqual([
      "Added eggs",
      "Added chicken thighs",
      "Added spinach",
      "Added yogurt",
    ]);
    const eggs = k.item("eggs")!;
    expect(eggs.location).toBeUndefined(); // unknown stays unknown (0011)
    expect(eggs.quantity).toBeUndefined();
    expect(eggs.createdBy).toBe("vero");
  });

  it("step 2: 'the chicken' matches chicken thighs, which moves to the freezer", () => {
    const { k, steps } = runPrimaryJourney();
    expect(steps.froze.rejected).toEqual([]);
    expect(steps.froze.applied[0].summary.text).toBe("chicken thighs → freezer");
    const chicken = k.item("chicken thighs")!;
    expect(chicken.location?.value).toBe("freezer");
    expect(chicken.frozen?.value).toBe(true);
    expect(Object.keys(k.kitchen.items)).toHaveLength(4); // no stray "chicken" item
  });

  it("steps 3–5: the chosen idea becomes a meal, then lands in the plan", () => {
    const { k, steps, mealId } = runPrimaryJourney();
    expect(steps.choose.applied[0].refs).toEqual([{ kind: "meal", id: mealId, change: "added" }]);
    const state = k.state();
    expect(state.plan).toEqual([mealId]);
    const meal = state.meals.find((m) => m.id === mealId)!;
    expect(meal.title).toBe("Chicken and spinach curry");
    expect(meal.status).toBe("planned");
    expect(state.items.map((i) => i.name.value).sort()).toEqual(["chicken thighs", "eggs", "spinach", "yogurt"]);
    expect(state.version).toBe(4);
  });

  it("choosing the same idea twice points at the same meal", () => {
    const { k, mealId } = runPrimaryJourney();
    const again = k.tap(primaryJourney.choose("idea-curry"));
    expect(again.applied[0].refs[0]).toEqual({ kind: "meal", id: mealId, change: "updated" });
    expect(Object.keys(k.kitchen.meals)).toHaveLength(1);
  });
});

describe("after cooking (0013)", () => {
  function cook() {
    const { k, mealId } = runPrimaryJourney();
    const chicken = k.item("chicken thighs")!;
    const spinach = k.item("spinach")!;
    k.tap(afterCooking.recipe(mealId, chicken.id));
    k.tap(afterCooking.startCooking(mealId));
    const finish = k.tap(afterCooking.finish(mealId, chicken.id, spinach.id));
    return { k, mealId, chicken, spinach, finish };
  }

  it("finishing records in-kitchen ingredients as used (not basics, not missing ones)", () => {
    const { k, mealId, chicken, spinach, finish } = cook();
    expect(finish.rejected).toEqual([]);
    const usedInMeal = k.events.filter(
      (e) => e.type === "item.used" && (e.payload as { mealId?: string }).mealId === mealId,
    );
    expect(usedInMeal.map((e) => (e.payload as { itemId: string }).itemId).sort()).toEqual(
      [chicken.id, spinach.id].sort(),
    );
    // amount unknown: no stock and no quantity on those events
    // (the oldest batch, 0025)
    for (const e of usedInMeal) expect(e.payload).toEqual({ itemId: expect.any(String), batchId: expect.any(String), mealId });
  });

  it("Running low keeps the item, labelled; Out takes it off the list; the note is saved", () => {
    const { k, mealId } = cook();
    const state = k.state();
    expect(state.items.map((i) => i.name.value).sort()).toEqual(["eggs", "spinach", "yogurt"]);
    expect(state.items.find((i) => i.name.value === "spinach")!.stock?.value).toBe("low");
    expect(state.plan).toEqual([]); // done meals leave the plan
    const meal = k.kitchen.meals[mealId];
    expect(meal.status).toBe("done");
    expect(meal.note).toBe("Used the whole pack of chicken");
    expect(meal.cookedAt).toBeDefined();
    expect(meal.planPosition).toBeUndefined();
  });

  it("Do later: done now, To review card, then the note and stock levels later", () => {
    const { k, mealId } = runPrimaryJourney();
    const chicken = k.item("chicken thighs")!;
    k.tap(afterCooking.recipe(mealId, chicken.id));
    k.tap(afterCooking.startCooking(mealId));
    const later = k.tap([
      { type: "meal.transition", target: { mealId }, to: "done" },
      {
        type: "review.queue",
        kind: "after-cooking",
        mealId,
        items: [{ name: "chicken thighs", itemId: chicken.id }, { name: "spinach" }],
      },
    ]);
    expect(later.rejected).toEqual([]);
    const reviewId = later.applied[1].refs[0].id;
    expect(k.state().toReview.map((r) => r.id)).toEqual([reviewId]);

    const resolved = k.tap([
      { type: "review.resolve", target: { reviewId }, outcome: "done" },
      { type: "item.use", target: { itemId: chicken.id }, fields: { stock: said("out") } },
      { type: "meal.transition", target: { mealId }, to: "done", note: "Freeze half next time" },
    ]);
    expect(resolved.rejected).toEqual([]);
    expect(resolved.applied[2].summary.code).toBe("MEAL_NOTE_SAVED");
    expect(k.state().toReview).toEqual([]);
    expect(k.kitchen.meals[mealId].note).toBe("Freeze half next time");
  });

  it("cancelling never changes the kitchen", () => {
    const { k, mealId } = runPrimaryJourney();
    const before = k.kitchen.items;
    const cancel = k.tap([{ type: "meal.transition", target: { mealId }, to: "cancelled" }]);
    expect(cancel.events.map((e) => e.type)).toEqual(["meal.transitioned"]);
    expect(k.kitchen.items).toBe(before);
  });
});

describe("replay", () => {
  it("replaying all events equals the step-by-step state, at every step", () => {
    const { k, mealId } = runPrimaryJourney();
    const chicken = k.item("chicken thighs")!;
    const spinach = k.item("spinach")!;
    k.say("I'm allergic to peanuts", [
      { type: "profile.restriction.add", fields: { kind: "allergy", subject: { value: "peanuts", basis: "said", confidence: "high" } } },
    ]);
    k.tap(afterCooking.recipe(mealId, chicken.id));
    k.tap([{ type: "checklist.tick", target: { mealId }, ingredient: "onion", ticked: true }]);
    k.tap(afterCooking.startCooking(mealId));
    k.tap(afterCooking.finish(mealId, chicken.id, spinach.id));
    k.say("I bought more spinach", [{ type: "item.add", fields: { name: { value: "spinach", basis: "said", confidence: "high" } } }]);

    expect(k.history.length).toBeGreaterThan(8);
    for (const step of k.history) {
      expect(k.replayKitchen(step.events)).toEqual(step.kitchen);
      expect(k.replayProfiles(step.events)).toEqual(step.profiles);
    }
    // Adding spinach again cleared "Running low" instead of creating a duplicate.
    expect(Object.values(k.kitchen.items).filter((i) => i.standardName === "spinach")).toHaveLength(1);
    expect(k.item("spinach")!.stock).toBeUndefined();
  });
});
