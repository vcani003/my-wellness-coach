/**
 * Tap an item to edit it (0045 KOS3; the item actions of 0030 / 0036) on the pure domain: the edit
 * sheet's operations (`itemEditOperations`), Counter as a place, IA4 (amount on the oldest batch),
 * IA5 (out of the Freezer is a defrost), IA6 (a rename's own receipt line), the amount parser, and
 * which staples are an item's (the Staple switch).
 */
import { describe, expect, it } from "vitest";
import { Location } from "@/contracts/common";
import { itemEditOperations } from "@/domains/kitchen/commands";
import { quantityFromText } from "@/shared/quantity";
import { stapleIdsForItem } from "@/shared/staples";
import { standardName } from "@/shared/text";
import { MemoryKitchen, said } from "../support/memory-kitchen";

/** Fish sauce (one batch, fridge, 1 bottle) and eggs (two batches in the fridge: Oct 2, today). */
function kitchen() {
  const k = new MemoryKitchen();
  k.say("fish sauce", [{ type: "item.add", fields: { name: said("fish sauce"), location: said("fridge"), quantity: said({ asSaid: "1 bottle", amount: 1, unit: "bottle" }) } }]);
  k.say("eggs on Oct 2", [{ type: "item.add", fields: { name: said("eggs"), location: said("fridge"), occurredAt: said("2026-10-02T12:00:00.000Z"), quantity: said({ asSaid: "12 eggs" }) } }]);
  k.say("bought eggs", [{ type: "item.add", fields: { name: said("eggs"), location: said("fridge"), quantity: said({ asSaid: "6 eggs" }) } }]);
  return k;
}

/** Plan the edit sheet's operations against the kitchen as it is, as a button tap. */
function edit(k: MemoryKitchen, name: string, e: Parameters<typeof itemEditOperations>[1], batchId?: string) {
  const ops = itemEditOperations(k.item(name)!, e, batchId);
  return { ops, plan: ops.length ? k.tap(ops) : null };
}

const batches = (k: MemoryKitchen, name: string) => k.state().items.find((i) => i.id === k.item(name)!.id)!.batches!;

describe("Counter is a place (0030 IA1)", () => {
  it("is one of the places", () => {
    expect(Location.options).toEqual(["fridge", "freezer", "pantry", "counter"]);
  });
});

describe("itemEditOperations: the edit sheet (KOS3)", () => {
  it("rename gets its own receipt line (IA6) and the amount another, in one change set", () => {
    const k = kitchen();
    const { plan } = edit(k, "fish sauce", { name: "nước mắm", amount: "half a bottle" });
    expect(plan!.rejected).toEqual([]);
    expect(plan!.applied.map((a) => a.summary.code)).toEqual(["ITEM_RENAMED", "ITEM_UPDATED"]);
    expect(plan!.applied[0].summary).toMatchObject({ params: { from: "fish sauce", name: "nước mắm" }, text: "Renamed fish sauce → nước mắm" });
    expect(new Set(plan!.events.map((e) => e.changeSetId)).size).toBe(1);
    const row = k.state().items.find((i) => i.name.value === "nước mắm")!;
    expect(row.quantity).toEqual(said({ asSaid: "half a bottle" }));
  });

  it("only what changed becomes an operation; an unchanged sheet is nothing", () => {
    const k = kitchen();
    expect(edit(k, "fish sauce", { name: "fish sauce", amount: "1 bottle", place: "fridge" }).ops).toEqual([]);
  });

  it("an empty amount clears it to unknown (no made-up default, 0011)", () => {
    const k = kitchen();
    const { plan } = edit(k, "fish sauce", { amount: "" });
    expect(plan!.rejected).toEqual([]);
    expect(k.state().items.find((i) => i.name.value === "fish sauce")!.quantity).toBeUndefined();
    expect(edit(k, "fish sauce", { amount: null }).ops).toEqual([]);
  });

  it("IA4: the amount goes on the oldest open batch, or on the batch given", () => {
    const k = kitchen();
    const [older, newer] = batches(k, "eggs");
    edit(k, "eggs", { amount: "10" });
    expect(batches(k, "eggs").map((b) => b.quantity?.value.asSaid)).toEqual(["10", "6 eggs"]);
    edit(k, "eggs", { amount: "4 eggs" }, newer.id);
    const now = batches(k, "eggs");
    expect(now.find((b) => b.id === older.id)!.quantity?.value).toEqual({ asSaid: "10", amount: 10 });
    expect(now.find((b) => b.id === newer.id)!.quantity?.value).toEqual({ asSaid: "4 eggs", amount: 4, unit: "eggs" });
  });

  it("a place moves every open batch, or only the batch given; Counter is said and remembered", () => {
    const k = kitchen();
    const [older, newer] = batches(k, "eggs");
    const one = edit(k, "eggs", { place: "counter" }, newer.id).plan!;
    expect(one.applied[0].summary.code).toBe("ITEM_MOVED");
    expect(batches(k, "eggs").map((b) => [b.id, b.location?.value])).toEqual([
      [older.id, "fridge"],
      [newer.id, "counter"],
    ]);
    edit(k, "eggs", { place: "pantry" });
    expect(batches(k, "eggs").map((b) => b.location)).toEqual([said("pantry"), said("pantry")]);
    expect(k.kitchen.locationPrefs?.[standardName("eggs")]?.location).toBe("pantry");
  });

  it("into the Freezer is the 'froze it' path; out of it counts as defrosting (IA5)", () => {
    const k = kitchen();
    edit(k, "fish sauce", { place: "freezer" });
    let b = batches(k, "fish sauce")[0];
    expect([b.location?.value, b.frozen?.value]).toEqual(["freezer", true]);
    const out = edit(k, "fish sauce", { place: "counter" }).plan!;
    expect(out.applied[0].summary.code).toBe("ITEM_DEFROSTED");
    b = batches(k, "fish sauce")[0];
    expect([b.location, b.frozen?.value]).toEqual([said("counter"), false]);
    expect(b.defrostedOn).toBeDefined();
  });

  it("type is saved as said", () => {
    const k = kitchen();
    const { plan } = edit(k, "fish sauce", { category: "spices_seasonings" });
    expect(plan!.applied[0].summary.code).toBe("ITEM_CATEGORY");
    expect(k.state().items.find((i) => i.name.value === "fish sauce")!.category).toEqual(said("spices_seasonings"));
  });

  it("renaming onto another item's name is allowed and nothing merges (item-actions.md §2)", () => {
    const k = kitchen();
    const { plan } = edit(k, "fish sauce", { name: "eggs" });
    expect(plan!.rejected).toEqual([]);
    expect(k.state().items.filter((i) => i.standardName === "egg")).toHaveLength(2);
  });

  it("a batch that closed since the sheet opened is refused, nothing saved", () => {
    const k = kitchen();
    const [older] = batches(k, "eggs");
    k.tap([{ type: "item.batch.close", target: { itemId: k.item("eggs")!.id, batchId: older.id } }]);
    const { plan } = edit(k, "eggs", { amount: "3", place: "counter" }, older.id);
    expect(plan!.applied).toEqual([]);
    expect(plan!.rejected.map((r) => r.reason.code)).toEqual(["ALREADY_OUT"]);
  });
});

describe("ITEM_RENAMED from chat too (IA6)", () => {
  it("a rename alone reads 'Renamed …'; a rename with other fields stays 'Updated'", () => {
    const k = kitchen();
    const id = k.item("fish sauce")!.id;
    const a = k.say("call the fish sauce nước mắm", [{ type: "item.update", target: { itemId: id }, fields: { name: said("nước mắm") } }]);
    expect(a.applied[0].summary.code).toBe("ITEM_RENAMED");
    const b = k.say("it's red boat, half left", [{ type: "item.update", target: { itemId: id }, fields: { name: said("red boat"), quantity: said({ asSaid: "half" }) } }]);
    expect(b.applied[0].summary.code).toBe("ITEM_UPDATED");
  });
});

describe("quantityFromText: the amount as typed", () => {
  it.each([
    ["2 lbs", { asSaid: "2 lbs", amount: 2, unit: "lbs" }],
    [" 6 ", { asSaid: "6", amount: 6 }],
    ["1,5 kg", { asSaid: "1,5 kg", amount: 1.5, unit: "kg" }],
    ["half a bag", { asSaid: "half a bag" }],
    ["about 6", { asSaid: "about 6" }],
    ["", null],
    ["   ", null],
  ])("%j", (text, expected) => {
    expect(quantityFromText(text)).toEqual(expected);
  });
});

describe("stapleIdsForItem: the Staple switch reads exact names only", () => {
  const s = (name: string) => ({ id: standardName(name), name, standardName: standardName(name) });
  const item = (name: string) => ({ name, standardName: standardName(name) });
  it("matches the same name, and either half of 'nước mắm (fish sauce)'", () => {
    expect(stapleIdsForItem(item("Eggs"), [s("eggs"), s("rice")])).toEqual(["egg"]);
    expect(stapleIdsForItem(item("nước mắm (fish sauce)"), [s("fish sauce")])).toEqual(["fish sauce"]);
    expect(stapleIdsForItem(item("fish sauce"), [s("nước mắm (fish sauce)")])).toEqual(["nước mắm fish sauce"]);
  });
  it("never the looser all-the-words match", () => {
    expect(stapleIdsForItem(item("jasmine rice"), [s("rice")])).toEqual([]);
  });
});
