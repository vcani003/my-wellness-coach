/**
 * Kitchen infers where things go (0041), on the pure domain: the code's guess from name and type,
 * the order (said > implied > remembered > where it already is > the AI's guess > the code's
 * guess), remembering a said place per kitchen and Undo forgetting it, the one-time sort's plan and
 * its message, and replay == step by step. People are fictional (Ana, Ben).
 */
import { describe, expect, it } from "vitest";
import type { Location } from "@/contracts/common";
import { getKitchenEntity, kitchenTouchedKeys, replay } from "@/domains/kitchen/state";
import { placeForNewBatch } from "@/domains/kitchen/places";
import { planPlacesSort, sortedReply } from "@/domains/kitchen/sort-places";
import type { Plan, RevertPlan } from "@/domains/kitchen/validate";
import { guessCategoryFact } from "@/shared/item-category";
import { guessPlace, guessPlaceFact } from "@/shared/item-place";
import { MemoryKitchen, inferred, said } from "../support/memory-kitchen";

const medium = (value: Location) => ({ value, basis: "inferred" as const, confidence: "medium" as const });
const high = (value: Location) => ({ value, basis: "inferred" as const, confidence: "high" as const });

function kitchen(): MemoryKitchen {
  const k = new MemoryKitchen();
  k.members = new Map([
    ["ana", "Ana"],
    ["ben", "Ben"],
  ]);
  return k;
}
const add = (name: string, location?: ReturnType<typeof said<Location>>) => ({
  type: "item.add" as const,
  fields: { name: said(name), ...(location ? { location } : {}) },
});
const placeOf = (k: MemoryKitchen, name: string) => k.state().items.find((i) => i.name.value === name)?.location;
const codes = (p: Plan) => p.applied.map((a) => a.summary.code);

function undo(k: MemoryKitchen, plan: Plan): Plan {
  const csId = plan.events[0].changeSetId;
  const first = k.events.findIndex((e) => e.changeSetId === csId);
  const before = replay(k.events.slice(0, first));
  const restore: Record<string, unknown> = {};
  for (const key of new Set(k.events.filter((e) => e.changeSetId === csId).flatMap(kitchenTouchedKeys))) {
    restore[key] = getKitchenEntity(before, key);
  }
  const reverts = new Map<string, RevertPlan>([[csId, { ok: true, restoreByStream: { [`kitchen:${k.kitchenId}`]: restore } }]]);
  return k.tap([{ type: "changeset.revert", target: { changeSetId: csId } }], { reverts, actor: "ana" });
}

describe("the code's guess (src/shared/item-place.ts)", () => {
  it.each<[string, Location | undefined]>([
    ["milk", "fridge"],
    ["eggs", "fridge"],
    ["chicken thighs", "fridge"],
    ["spinach", "fridge"],
    ["pho leftovers", "fridge"],
    ["jasmine rice", "pantry"],
    ["nước mắm", "pantry"],
    ["nuoc mam", "pantry"],
    ["bánh phở", "pantry"],
    ["rau răm", "fridge"],
    ["star anise", "pantry"],
    ["coconut milk", "pantry"],
    ["frozen peas", "freezer"],
    ["frozen dumplings", "freezer"],
    ["ice cream", "freezer"],
    ["onions", "pantry"],
    ["green onions", "fridge"],
    ["garlic", "pantry"],
    ["potatoes", "pantry"],
    ["mayo", "fridge"],
    ["kimchi", "fridge"],
    ["orange juice", "fridge"],
    ["coffee", "pantry"],
    ["dried shiitake", "pantry"],
    // Genuinely depends: stays "Not sure where"
    ["bananas", undefined],
    ["avocado", undefined],
    ["tomatoes", undefined],
    ["sparkling water", undefined],
    ["beer", undefined],
    ["zzz", undefined],
  ])("%s → %s", (name, place) => {
    expect(guessPlaceFact(name, guessCategoryFact(name))?.value).toBe(place);
  });

  it("uses the item's type when no name word decides, and frozen means the freezer", () => {
    expect(guessPlace("mystery thing", "dairy_eggs")).toBe("fridge");
    expect(guessPlace("mystery thing", "baking")).toBe("pantry");
    expect(guessPlace("mystery thing", "drinks")).toBeUndefined();
    expect(guessPlace("mystery thing", "other")).toBeUndefined();
    expect(guessPlace("chicken", "meat_seafood", true)).toBe("freezer");
    expect(guessPlaceFact("chicken", inferred("meat_seafood"))).toEqual(medium("fridge"));
    // A type the kitchen itself couldn't tell gives no place.
    expect(guessPlaceFact("thing", { value: "produce", basis: "inferred", confidence: "low" })).toBeUndefined();
  });
});

describe("item.add puts things where they usually go (0041)", () => {
  it("no place said: the usual place, as inferred; quantity stays unknown", () => {
    const k = kitchen();
    const plan = k.say("I bought milk, rice and frozen peas", [add("milk"), add("jasmine rice"), add("frozen peas")], { actor: "ana" });
    expect(plan.rejected).toEqual([]);
    expect(placeOf(k, "milk")).toEqual(medium("fridge"));
    expect(placeOf(k, "jasmine rice")).toEqual(medium("pantry"));
    expect(placeOf(k, "frozen peas")).toEqual(medium("freezer"));
    expect(k.item("milk")!.quantity).toBeUndefined();
    expect(k.kitchen.locationPrefs).toEqual({}); // a guess is never remembered
  });

  it("genuinely ambiguous items stay 'Not sure where'", () => {
    const k = kitchen();
    k.say("bought bananas and zzz", [add("bananas"), add("zzz")], { actor: "ana" });
    expect(placeOf(k, "bananas")).toBeUndefined();
    expect(placeOf(k, "zzz")).toBeUndefined();
  });

  it("a said place wins, and is remembered for that name", () => {
    const k = kitchen();
    const plan = k.say("bought milk, it's in the freezer", [add("milk", said("freezer"))], { actor: "ana" });
    expect(plan.events.map((e) => e.type)).toEqual(["item.added", "item.location.remembered"]);
    expect(placeOf(k, "milk")).toEqual(said("freezer"));
    expect(k.kitchen.locationPrefs["milk"]).toMatchObject({ standardName: "milk", location: "freezer", createdBy: "ana" });
  });

  it("the AI's usual-place guess (medium) applies; a remembered place beats it; an implied one (high) beats that", () => {
    const k = kitchen();
    k.say("bought tofu", [{ type: "item.add", fields: { name: said("tofu"), location: medium("pantry") } }], { actor: "ana" });
    expect(placeOf(k, "tofu")).toEqual(medium("pantry"));

    k.say("onions go in the fridge", [{ type: "item.update", target: { name: "onions" }, fields: { location: said("fridge") } }], { actor: "ana" });
    k.say("bought onions", [{ type: "item.add", fields: { name: said("onions"), location: medium("pantry") } }], { actor: "ben" });
    expect(placeOf(k, "onions")).toEqual(high("fridge"));

    k.say("bought chicken", [{ type: "item.update", target: { name: "chicken" }, fields: { location: said("fridge") } }], { actor: "ana" });
    k.say("I froze the new chicken", [{ type: "item.add", fields: { name: said("chicken"), location: high("freezer"), frozen: said(true) } }], { actor: "ana" });
    expect(k.item("chicken")!.batches.at(-1)!.location).toEqual(high("freezer"));
  });

  it("buying more of something keeps it where the item already is", () => {
    const k = kitchen();
    k.say("bought rice, put it in the freezer", [add("jasmine rice", said("freezer"))], { actor: "ana" });
    // A fresh kitchen with no memory: the item's own place still wins over the guess.
    k.kitchen = { ...k.kitchen, locationPrefs: {} };
    k.say("bought more rice", [add("jasmine rice")], { actor: "ben" });
    expect(k.item("jasmine rice")!.batches.map((b) => b.location?.value)).toEqual(["freezer", "freezer"]);
  });

  it("frozen said with no place → freezer", () => {
    const k = kitchen();
    k.say("bought frozen shrimp", [{ type: "item.add", fields: { name: said("shrimp"), frozen: said(true) } }], { actor: "ana" });
    expect(placeOf(k, "shrimp")).toEqual(high("freezer"));
  });

  it("Done shopping puts things away in their usual place too", () => {
    const k = kitchen();
    k.say("need garlic and milk", [
      { type: "shopping.add", fields: { name: said("garlic") } },
      { type: "shopping.add", fields: { name: said("milk") } },
    ], { actor: "ana" });
    const items = Object.values(k.kitchen.shopping).map((e) => ({ shoppingItemId: e.id }));
    k.tap(items.map((i) => ({ type: "shopping.tick" as const, target: i, ticked: true })), { actor: "ana" });
    const done = k.tap([{ type: "shopping.done", items }], { actor: "ana" });
    expect(done.rejected).toEqual([]);
    expect(placeOf(k, "garlic")).toEqual(medium("pantry"));
    expect(placeOf(k, "milk")).toEqual(medium("fridge"));
  });

  it("placeForNewBatch: the order, in one place", () => {
    const k = kitchen();
    const base = { name: "onions", standardName: "onion", category: inferred("produce" as const) };
    expect(placeForNewBatch(base, k.kitchen)).toEqual(medium("pantry"));
    expect(placeForNewBatch({ ...base, given: medium("fridge") }, k.kitchen)).toEqual(medium("fridge"));
    k.say("onions go in the freezer", [{ type: "item.update", target: { name: "onions" }, fields: { location: said("freezer") } }], { actor: "ana" });
    expect(placeForNewBatch({ ...base, given: medium("fridge") }, k.kitchen)).toEqual(high("freezer"));
    expect(placeForNewBatch({ ...base, given: high("pantry") }, k.kitchen)).toEqual(high("pantry"));
    expect(placeForNewBatch({ ...base, given: said("fridge") }, k.kitchen)).toEqual(said("fridge"));
  });
});

describe("remembered places (0041, like remembered types in 0032)", () => {
  it("'onions go in the pantry' with no onions: only remembered; the next add goes there; Undo forgets it", () => {
    const k = kitchen();
    const habit = k.say("onions go in the pantry", [{ type: "item.update", target: { name: "onions" }, fields: { location: said("pantry") } }], { actor: "ana" });
    expect(codes(habit)).toEqual(["PLACE_REMEMBERED"]);
    expect(habit.applied[0].summary.text).toBe("I'll put onions in the pantry from now on");
    expect(habit.events.map((e) => e.type)).toEqual(["item.location.remembered"]);
    expect(k.kitchen.locationPrefs["onion"]?.location).toBe("pantry");

    k.say("bought onions", [{ type: "item.add", fields: { name: said("onions"), location: medium("fridge") } }], { actor: "ben" });
    expect(placeOf(k, "onions")).toEqual(high("pantry"));

    undo(k, habit);
    expect(k.kitchen.locationPrefs["onion"]).toBeUndefined();
  });

  it("moving an item there is remembered too, and Undo puts both back", () => {
    const k = kitchen();
    k.say("bought milk", [add("milk")], { actor: "ana" });
    const move = k.say("put the milk in the freezer", [{ type: "item.update", target: { name: "milk" }, fields: { location: said("freezer") } }], { actor: "ana" });
    expect(codes(move)).toEqual(["ITEM_MOVED"]);
    expect(move.events.map((e) => e.type)).toEqual(["item.updated", "item.location.remembered"]);
    k.say("bought milk", [add("milk")], { actor: "ana" }); // a new batch, where the household keeps it
    expect(k.item("milk")!.batches.map((b) => b.location?.value)).toEqual(["freezer", "freezer"]);

    const k2 = kitchen();
    k2.say("bought milk", [add("milk")], { actor: "ana" });
    const move2 = k2.say("put the milk in the freezer", [{ type: "item.update", target: { name: "milk" }, fields: { location: said("freezer") } }], { actor: "ana" });
    undo(k2, move2);
    expect(placeOf(k2, "milk")).toEqual(medium("fridge"));
    expect(k2.kitchen.locationPrefs).toEqual({});
  });

  it("an implied place ('I froze the beef') or a guess is never remembered; saying the same place again is no new event", () => {
    const k = kitchen();
    k.say("bought beef", [add("beef")], { actor: "ana" });
    k.say("I froze the beef", [{ type: "item.update", target: { name: "beef" }, fields: { location: high("freezer"), frozen: said(true) } }], { actor: "ana" });
    expect(k.kitchen.locationPrefs).toEqual({});
    k.say("rice goes in the pantry", [{ type: "item.update", target: { name: "rice" }, fields: { location: said("pantry") } }], { actor: "ana" });
    const again = k.say("rice goes in the pantry", [{ type: "item.update", target: { name: "rice" }, fields: { location: said("pantry") } }], { actor: "ana" });
    expect(codes(again)).toEqual(["NO_CHANGE"]);
  });

  it("replaying the events gives the same kitchen, step by step", () => {
    const k = kitchen();
    k.say("bought milk and onions", [add("milk"), add("onions")], { actor: "ana" });
    k.say("onions go in the fridge", [{ type: "item.update", target: { name: "onions" }, fields: { location: said("fridge") } }], { actor: "ana" });
    k.say("bought onions", [add("onions")], { actor: "ben" });
    k.history.forEach((h) => expect(k.replayKitchen(h.events)).toEqual(h.kitchen));
  });
});

describe("the one-time sort's plan (0041)", () => {
  /** Items as an old build left them: no place. */
  function legacy(): MemoryKitchen {
    const k = kitchen();
    k.say("bought things", [add("milk"), add("jasmine rice"), add("bananas"), add("nước mắm"), add("eggs", said("pantry"))], { actor: "ana" });
    k.tap(["milk", "jasmine rice", "nước mắm"].map((name) => ({ type: "item.update" as const, target: { name }, fields: {}, clear: ["location" as const] })), { actor: "ana" });
    return k;
  }

  it("places every open batch with no place, leaves said places and ambiguous items alone", () => {
    const k = legacy();
    const { moves, unplaced } = planPlacesSort(k.kitchen);
    expect(moves.map((m) => [m.name, m.location])).toEqual([
      ["jasmine rice", medium("pantry")],
      ["milk", medium("fridge")],
      ["nước mắm", medium("pantry")],
    ]);
    expect(unplaced).toBe(1); // bananas
    // Applying it is ordinary item.update operations: one change set, nothing remembered.
    const plan = k.tap(moves.map((m) => ({ type: "item.update" as const, target: { itemId: m.itemId, batchId: m.batchId }, fields: { location: m.location } })), { actor: "ana" });
    expect(plan.rejected).toEqual([]);
    expect(new Set(plan.events.map((e) => e.changeSetId)).size).toBe(1);
    expect(codes(plan)).toEqual(["ITEM_MOVED", "ITEM_MOVED", "ITEM_MOVED"]);
    expect(Object.keys(k.kitchen.locationPrefs)).toEqual(["egg"]); // only the place Ana said for eggs
    expect(placeOf(k, "eggs")).toEqual(said("pantry"));
    // Idempotent: a second plan finds nothing to place.
    expect(planPlacesSort(k.kitchen).moves).toEqual([]);
  });

  it("uses a remembered place first", () => {
    const k = legacy();
    k.kitchen = { ...k.kitchen, locationPrefs: { "jasmine rice": { standardName: "jasmine rice", location: "freezer", createdAt: "", createdBy: "ana", updatedAt: "", updatedBy: "ana" } } };
    expect(planPlacesSort(k.kitchen).moves.find((m) => m.name === "jasmine rice")?.location).toEqual(high("freezer"));
  });

  it("says what it did in one line", () => {
    const k = legacy();
    const { moves, unplaced } = planPlacesSort(k.kitchen);
    expect(sortedReply(moves, unplaced)).toBe(
      'I sorted 3 items from "Not sure where" into their usual places: 1 to the Fridge and 2 to the Pantry. One thing stays under "Not sure where". If something\'s in the wrong place, tap Undo or tell me where it goes.',
    );
    expect(sortedReply(moves.slice(0, 1), 0)).toBe(
      'I sorted 1 item from "Not sure where" into their usual places: 1 to the Pantry. If something\'s in the wrong place, tap Undo or tell me where it goes.',
    );
  });
});
