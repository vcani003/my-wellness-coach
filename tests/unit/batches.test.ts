/**
 * Older and newer batches (0025) on the pure domain: merging into a batch, the cap of 3, oldest
 * first, a named batch, "those are gone", defrosted, Undo, SL5, replay == step by step, and
 * events from before batches.
 */
import { describe, expect, it } from "vitest";
import { isBatchOfferOpen } from "@/contracts/apply-result";
import { KitchenState } from "@/contracts/kitchen-state";
import { ensureBatches, openBatches } from "@/domains/kitchen/batches";
import { getKitchenEntity, kitchenTouchedKeys, replay } from "@/domains/kitchen/state";
import { computeUseItUpSignals } from "@/domains/kitchen/use-it-up";
import { locationAfterDefrost, type Plan, type RevertPlan } from "@/domains/kitchen/validate";
import type { EventEnvelope } from "@/shared/events/types";
import { MemoryKitchen, said } from "../support/memory-kitchen";

const DAY = 86_400_000;
/** MemoryKitchen's clock is 2026-10-14 18:xx UTC. */
const daysAgo = (n: number) => new Date(Date.UTC(2026, 9, 14, 12) - n * DAY).toISOString();
const eggs = (n: number, ago: number) => ({
  type: "item.add" as const,
  fields: { name: said("eggs"), quantity: said({ asSaid: `${n} eggs`, amount: n, unit: "eggs" }), occurredAt: said(daysAgo(ago)) },
});
const codes = (p: Plan) => p.rejected.map((r) => r.reason.code);

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

const row = (k: MemoryKitchen, name = "eggs") => k.state().items.find((i) => i.name.value === name);

describe("buying something you already have adds a batch (0025)", () => {
  it("merges into one item; the receipt offers the one-tap choice for the older batch", () => {
    const k = new MemoryKitchen();
    k.say("12 eggs on Oct 2", [eggs(12, 12)]);
    const again = k.say("bought 6 eggs", [eggs(6, 0)]);
    expect(again.rejected).toEqual([]);
    expect(Object.values(k.kitchen.items)).toHaveLength(1);
    const item = row(k)!;
    expect(item.batches).toHaveLength(2);
    // The row: "2 batches · oldest 12 days"; the quantity sums when the units match.
    expect(item.addedAt).toBe(daysAgo(12));
    expect(item.quantity?.value).toMatchObject({ amount: 18, unit: "eggs" });
    expect(again.applied[0].summary).toMatchObject({ code: "ITEM_BATCH_ADDED", params: { name: "eggs", batches: 2, closedOldest: false } });
    expect(again.applied[0].refs[0]).toMatchObject({ kind: "item", id: item.id, change: "updated", batchId: item.batches![1].id });
    const [offer] = again.applied[0].batchOffers!;
    expect(offer).toEqual({
      itemId: item.id,
      name: "eggs",
      newBatchId: item.batches![1].id,
      older: [{ batchId: item.batches![0].id, addedAt: daysAgo(12), quantity: said({ asSaid: "12 eggs", amount: 12, unit: "eggs" }) }],
    });
    expect(isBatchOfferOpen(offer, k.state())).toBe(true);
    expect(KitchenState.safeParse(k.state()).success).toBe(true);
  });

  it("a first purchase makes no offer, and the row's derived fields match its one batch", () => {
    const k = new MemoryKitchen();
    const first = k.say("eggs", [eggs(12, 1)]);
    expect(first.applied[0].batchOffers).toBeUndefined();
    expect(first.applied[0].summary.code).toBe("ITEM_ADDED");
    const item = row(k)!;
    expect(item.batches).toHaveLength(1);
    expect(item.quantity?.value.asSaid).toBe("12 eggs");
  });

  it("holds up to 3; a 4th closes the oldest as a normal event in the same change set", () => {
    const k = new MemoryKitchen();
    k.say("a", [eggs(12, 20)]);
    k.say("b", [eggs(12, 10)]);
    const third = k.say("c", [eggs(12, 5)]);
    expect(third.applied[0].batchOffers![0].older).toHaveLength(2);
    const oldest = row(k)!.batches![0].id;
    const fourth = k.say("d", [eggs(6, 0)]);
    expect(fourth.events.map((e) => e.type)).toEqual(["item.batch.closed", "item.batch.added"]);
    expect(fourth.events[0].payload).toMatchObject({ batchId: oldest, reason: "replaced" });
    expect(new Set(fourth.events.map((e) => e.changeSetId)).size).toBe(1);
    const item = row(k)!;
    expect(item.batches).toHaveLength(3);
    expect(item.addedAt).toBe(daysAgo(10)); // the oldest *open* batch now
    const [offer] = fourth.applied[0].batchOffers!;
    expect(offer.autoClosed).toEqual({ batchId: oldest, addedAt: daysAgo(20) });
    expect(offer.older.map((o) => o.addedAt)).toEqual([daysAgo(10), daysAgo(5)]);
    expect(fourth.applied[0].summary.params).toMatchObject({ batches: 3, closedOldest: true });
    // Nothing is erased: the closed batch stays in the item's history.
    const all = k.item("eggs")!.batches;
    expect(all).toHaveLength(4);
    expect(all.find((b) => b.id === oldest)).toMatchObject({ closedReason: "replaced" });
  });

  it("an Out item comes back with the new batch (same item, no offer)", () => {
    const k = new MemoryKitchen();
    k.say("eggs", [eggs(12, 3)]);
    k.say("out of eggs", [{ type: "item.use", target: { name: "eggs" }, fields: { stock: said("out") } }]);
    expect(row(k)).toBeUndefined();
    const back = k.say("eggs", [eggs(6, 0)]);
    expect(back.applied[0].summary.code).toBe("ITEM_RESTOCKED");
    expect(back.applied[0].batchOffers).toBeUndefined();
    expect(Object.values(k.kitchen.items)).toHaveLength(1);
    expect(row(k)!.batches).toHaveLength(1);
    expect(row(k)!.stock).toBeUndefined();
  });
});

describe("using an item (0025, 0011)", () => {
  function twoBatches() {
    const k = new MemoryKitchen();
    k.say("6 eggs", [eggs(6, 12)]);
    k.say("12 eggs", [eggs(12, 0)]);
    const [older, newer] = row(k)!.batches!;
    return { k, older: older.id, newer: newer.id, itemId: row(k)!.id };
  }

  it("takes the oldest batch first, spilling into the next when the units match", () => {
    const { k, older, newer } = twoBatches();
    const used = k.say("used 8 eggs", [
      { type: "item.use", target: { name: "eggs" }, fields: { amountUsed: said({ asSaid: "8 eggs", amount: 8, unit: "eggs" }) } },
    ]);
    expect(used.rejected).toEqual([]);
    const item = k.item("eggs")!;
    expect(item.batches.find((b) => b.id === older)).toMatchObject({ closedReason: "used-up", stock: { value: "out" } });
    expect(item.batches.find((b) => b.id === newer)!.quantity?.value.amount).toBe(10);
    expect(row(k)!.batches!.map((b) => b.id)).toEqual([newer]);
    expect(used.applied[0].summary).toMatchObject({ code: "ITEM_BATCH_USED_UP", params: { left: 1 } });
  });

  it("an amount that fits the oldest batch leaves the newer one alone", () => {
    const { k, older, newer } = twoBatches();
    k.say("used 2 eggs", [
      { type: "item.use", target: { name: "eggs" }, fields: { amountUsed: said({ asSaid: "2 eggs", amount: 2, unit: "eggs" }) } },
    ]);
    const item = k.item("eggs")!;
    expect(item.batches.find((b) => b.id === older)!.quantity?.value.amount).toBe(4);
    expect(item.batches.find((b) => b.id === newer)!.quantity?.value.amount).toBe(12);
    expect(item.batches.find((b) => b.id === older)!.lastUsedAt).toBeDefined();
    expect(item.batches.find((b) => b.id === newer)!.lastUsedAt).toBeUndefined();
  });

  it("a named batch: 'the new eggs' (which: newest) or an exact batch ID", () => {
    const { k, older, newer, itemId } = twoBatches();
    k.say("used 2 of the new eggs", [
      {
        type: "item.use",
        target: { name: "eggs", which: "newest" },
        fields: { amountUsed: said({ asSaid: "2 eggs", amount: 2, unit: "eggs" }) },
      },
    ]);
    let item = k.item("eggs")!;
    expect(item.batches.find((b) => b.id === newer)!.quantity?.value.amount).toBe(10);
    expect(item.batches.find((b) => b.id === older)!.quantity?.value.amount).toBe(6);

    k.tap([{ type: "item.use", target: { itemId, batchId: older }, fields: { stock: said("out") } }]);
    item = k.item("eggs")!;
    expect(item.batches.find((b) => b.id === older)!.closedAt).toBeDefined();
    expect(row(k)!.batches!.map((b) => b.id)).toEqual([newer]);

    expect(codes(k.tap([{ type: "item.use", target: { itemId, batchId: older }, fields: { stock: said("low") } }]))).toEqual([
      "ALREADY_OUT",
    ]);
    expect(codes(k.tap([{ type: "item.use", target: { itemId, batchId: "nope" }, fields: {} }]))).toEqual(["UNKNOWN_TARGET"]);
  });

  it("Out without a batch closes every batch, so the item drops off the list (0011)", () => {
    const { k } = twoBatches();
    const out = k.say("we're out of eggs", [{ type: "item.use", target: { name: "eggs" }, fields: { stock: said("out") } }]);
    expect(out.applied[0].summary.code).toBe("ITEM_OUT");
    expect(row(k)).toBeUndefined();
    expect(openBatches(k.item("eggs")!)).toEqual([]);
    expect(k.item("eggs")!.stock?.value).toBe("out");
  });

  it("auto-Out: using the full measured amount of every batch marks the item Out", () => {
    const { k } = twoBatches();
    k.say("used 18 eggs", [
      { type: "item.use", target: { name: "eggs" }, fields: { amountUsed: said({ asSaid: "18 eggs", amount: 18, unit: "eggs" }) } },
    ]);
    expect(row(k)).toBeUndefined();
    expect(k.item("eggs")!.stock).toMatchObject({ value: "out", basis: "inferred" });
  });

  it("Low on the whole item marks every batch; one Low batch next to a fresh one isn't Low", () => {
    const { k, itemId, older } = twoBatches();
    k.tap([{ type: "item.use", target: { itemId, batchId: older }, fields: { stock: said("low") } }]);
    expect(row(k)!.stock).toBeUndefined();
    k.say("eggs are running low", [{ type: "item.use", target: { name: "eggs" }, fields: { stock: said("low") } }]);
    expect(row(k)!.stock?.value).toBe("low");
  });

  it("finishing a meal records the oldest batch as used", () => {
    const { k, older } = twoBatches();
    k.ideas.set("idea-1", { name: "Omelette" });
    const chose = k.tap([{ type: "meal.choose", target: { ideaId: "idea-1" } }]);
    const mealId = chose.applied[0].refs[0].id;
    k.tap([
      {
        type: "recipe.save",
        target: { mealId },
        source: "ai",
        text: "",
        ingredients: [{ name: "eggs" }],
        steps: [],
        basicsAssumed: [],
      },
    ]);
    k.tap([{ type: "meal.transition", target: { mealId }, to: "cooking" }]);
    const done = k.tap([{ type: "meal.transition", target: { mealId }, to: "done" }]);
    const used = done.events.find((e) => e.type === "item.used")!;
    expect(used.payload).toMatchObject({ batchId: older, mealId });
  });
});

describe("'those are gone' (0025)", () => {
  it("closes that batch; the newer one stays; the offer is answered", () => {
    const k = new MemoryKitchen();
    k.say("eggs", [eggs(12, 12)]);
    const again = k.say("eggs", [eggs(6, 0)]);
    const offer = again.applied[0].batchOffers![0];
    const gone = k.tap([{ type: "item.batch.close", target: { itemId: offer.itemId, batchId: offer.older[0].batchId } }]);
    expect(gone.rejected).toEqual([]);
    expect(gone.applied[0].summary).toMatchObject({ code: "ITEM_BATCH_GONE", params: { left: 1 } });
    expect(row(k)!.batches!.map((b) => b.id)).toEqual([offer.newBatchId]);
    expect(row(k)!.addedAt).toBe(daysAgo(0));
    expect(isBatchOfferOpen(offer, k.state())).toBe(false);
    // A second tap changes nothing.
    const twice = k.tap([{ type: "item.batch.close", target: { itemId: offer.itemId, batchId: offer.older[0].batchId } }]);
    expect(twice.events).toEqual([]);
    expect(twice.applied[0].summary.code).toBe("NO_CHANGE");
  });

  it("closing the last batch makes the item Out, so it drops off the list (0011)", () => {
    const k = new MemoryKitchen();
    k.say("eggs", [eggs(12, 1)]);
    const gone = k.say("the old eggs are gone", [{ type: "item.batch.close", target: { name: "eggs", which: "oldest" } }]);
    expect(gone.applied[0].summary.code).toBe("ITEM_OUT");
    expect(row(k)).toBeUndefined();
  });

  it("'Still have them' records it, answers the offer and is a soft, non-undoable change", () => {
    const k = new MemoryKitchen();
    k.say("eggs", [eggs(12, 12)]);
    const offer = k.say("eggs", [eggs(6, 0)]).applied[0].batchOffers![0];
    const kept = k.tap([{ type: "item.batch.keep", target: { itemId: offer.itemId, batchId: offer.older[0].batchId } }]);
    expect(kept.applied[0]).toMatchObject({ summary: { code: "ITEM_BATCH_KEPT" }, refs: [] });
    expect(row(k)!.batches).toHaveLength(2);
    expect(row(k)!.batches![0].keptAt).toBeDefined();
    expect(isBatchOfferOpen(offer, k.state())).toBe(false);
    expect(k.tap([{ type: "item.batch.keep", target: { itemId: offer.itemId, batchId: offer.older[0].batchId } }]).events).toEqual([]);
  });
});

describe("defrosted (0025, AI8)", () => {
  it("sets 'defrosted on' (now, or the day said) and frozen: false on the frozen batch", () => {
    const k = new MemoryKitchen();
    k.say("chicken in the fridge", [{ type: "item.add", fields: { name: said("chicken"), location: said("fridge") } }]);
    k.say("chicken in the freezer", [
      { type: "item.add", fields: { name: said("chicken"), location: said("freezer"), frozen: said(true) } },
    ]);
    const frozenBatch = k.item("chicken")!.batches[1].id;
    const thawed = k.say("I defrosted the chicken", [{ type: "item.defrost", target: { name: "chicken" } }]);
    expect(thawed.rejected).toEqual([]);
    expect(thawed.applied[0]).toMatchObject({ summary: { code: "ITEM_DEFROSTED" }, refs: [{ batchId: frozenBatch }] });
    const b = k.item("chicken")!.batches[1];
    expect(b.defrostedOn).toMatchObject({ basis: "inferred" });
    expect(b.frozen).toEqual({ value: false, basis: "inferred", confidence: "high" });
    expect(row(k, "chicken")!.defrostedOn?.value).toBe(b.defrostedOn!.value);

    const yesterday = daysAgo(1);
    k.say("I defrosted it yesterday", [
      { type: "item.defrost", target: { name: "chicken", which: "newest" }, fields: { defrostedOn: said(yesterday) } },
    ]);
    expect(k.item("chicken")!.batches[1].defrostedOn).toEqual(said(yesterday));
    const [signal] = computeUseItUpSignals(k.state(), new Date(Date.UTC(2026, 9, 14, 20)));
    expect(signal).toMatchObject({ name: "chicken", batchCount: 2, defrostedOn: yesterday, defrostedDays: 1, low: false });
  });
});

describe("defrosted food leaves the freezer (DF1 Rec)", () => {
  const inferredFridge = { value: "fridge", basis: "inferred", confidence: "high" };

  it("moves the defrosted batch to the fridge, inferred, with frozen: false and the date", () => {
    const k = new MemoryKitchen();
    k.say("chicken in the freezer", [
      { type: "item.add", fields: { name: said("chicken"), location: said("freezer"), frozen: said(true) } },
    ]);
    const out = k.say("I defrosted the chicken", [{ type: "item.defrost", target: { name: "chicken" } }]);
    expect(out.rejected).toEqual([]);
    const b = k.item("chicken")!.batches[0];
    expect(b.location).toEqual(inferredFridge);
    expect(b.frozen?.value).toBe(false);
    expect(b.defrostedOn).toBeDefined();
    expect(row(k, "chicken")!.location).toEqual(inferredFridge);
  });

  it("keeps a place the user said in the same operation", () => {
    const k = new MemoryKitchen();
    k.say("chicken in the freezer", [
      { type: "item.add", fields: { name: said("chicken"), location: said("freezer"), frozen: said(true) } },
    ]);
    k.say("thawing the chicken in the pantry", [
      { type: "item.defrost", target: { name: "chicken" }, fields: { location: said("pantry") } },
    ]);
    expect(row(k, "chicken")!.location).toEqual(said("pantry"));
    expect(row(k, "chicken")!.frozen?.value).toBe(false);
  });

  it("the rule: a said place wins; anything else is the fridge, inferred", () => {
    expect(locationAfterDefrost(undefined)).toEqual(inferredFridge);
    expect(locationAfterDefrost(said("pantry"))).toEqual(said("pantry"));
    expect(locationAfterDefrost({ value: "freezer", basis: "inferred", confidence: "low" })).toEqual(inferredFridge);
  });
});

describe("use-it-up signals (0025)", () => {
  it("report the oldest batch's age, the batch count and Low, oldest first", () => {
    const k = new MemoryKitchen();
    k.say("eggs", [eggs(12, 12)]);
    k.say("eggs", [eggs(6, 0)]);
    k.say("milk is low", [
      { type: "item.add", fields: { name: said("milk") } },
      { type: "item.use", target: { name: "milk" }, fields: { stock: said("low") } },
    ]);
    const signals = computeUseItUpSignals(k.state(), new Date(Date.UTC(2026, 9, 14, 20)));
    expect(signals.map((s) => [s.name, s.batchCount, s.oldestDays, s.low])).toEqual([
      ["eggs", 2, 12, false],
      ["milk", 1, 0, true],
    ]);
  });
});

describe("Undo across batch ops", () => {
  it("restores each step exactly: auto-close, 'those are gone', defrost and use", () => {
    const k = new MemoryKitchen();
    k.say("a", [eggs(12, 20)]);
    k.say("b", [eggs(12, 10)]);
    k.say("c", [eggs(12, 5)]);
    const before4 = row(k);
    const fourth = k.say("d", [eggs(6, 0)]);
    expect(undo(k, fourth).rejected).toEqual([]);
    expect(row(k)!.batches!.map((b) => b.id)).toEqual(before4!.batches!.map((b) => b.id)); // the oldest is back
    expect(row(k)!.addedAt).toBe(daysAgo(20));

    const beforeGone = row(k);
    const gone = k.tap([{ type: "item.batch.close", target: { name: "eggs", which: "oldest" } }]);
    undo(k, gone);
    expect(row(k)!.batches!.map((b) => b.id)).toEqual(beforeGone!.batches!.map((b) => b.id));

    const used = k.say("used 13 eggs", [
      { type: "item.use", target: { name: "eggs" }, fields: { amountUsed: said({ asSaid: "13 eggs", amount: 13, unit: "eggs" }) } },
    ]);
    expect(row(k)!.batches).toHaveLength(2);
    undo(k, used);
    expect(row(k)!.quantity?.value.amount).toBe(36);
  });
});

describe("SL5 (bought from the list) with batches", () => {
  it("'I bought eggs' adds a batch to the eggs you have and takes eggs off the list, one change set", () => {
    const k = new MemoryKitchen();
    k.say("eggs", [eggs(12, 7)]);
    k.say("eggs on the list", [{ type: "shopping.add", fields: { name: said("eggs") } }]);
    const listId = k.state().shoppingList[0].id;
    const bought = k.say("I bought eggs", [{ type: "item.add", fields: { name: said("eggs") } }]);
    expect(bought.applied[0].summary).toMatchObject({ code: "ITEM_BATCH_ADDED", params: { fromList: true, batches: 2 } });
    expect(bought.applied[0].refs.map((r) => r.kind)).toEqual(["item", "shopping"]);
    expect(bought.applied[0].batchOffers).toHaveLength(1);
    expect(k.state().shoppingList).toEqual([]);
    expect(k.kitchen.shopping[listId]).toMatchObject({ status: "moved", movedToItemId: row(k)!.id });
    undo(k, bought);
    expect(k.state().shoppingList.map((e) => e.id)).toEqual([listId]);
    expect(row(k)!.batches).toHaveLength(1);
  });

  it("'Done shopping' also merges into a batch and carries the offer", () => {
    const k = new MemoryKitchen();
    k.say("eggs", [eggs(12, 7)]);
    k.say("eggs on the list", [{ type: "shopping.add", fields: { name: said("eggs") } }]);
    const listId = k.state().shoppingList[0].id;
    k.tap([{ type: "shopping.tick", target: { shoppingItemId: listId }, ticked: true }]);
    const done = k.tap([{ type: "shopping.done", items: [{ shoppingItemId: listId }] }]);
    expect(done.rejected).toEqual([]);
    expect(done.applied[0].batchOffers![0].older).toHaveLength(1);
    expect(row(k)!.batches).toHaveLength(2);
  });
});

describe("replay", () => {
  it("replaying the log equals the state after every step", () => {
    const k = new MemoryKitchen();
    k.say("a", [eggs(12, 20)]);
    k.say("b", [eggs(12, 10), { type: "item.add", fields: { name: said("chicken"), frozen: said(true) } }]);
    k.say("c", [eggs(12, 5)]);
    const fourth = k.say("d", [eggs(6, 0)]);
    k.say("used 13 eggs", [
      { type: "item.use", target: { name: "eggs" }, fields: { amountUsed: said({ asSaid: "13 eggs", amount: 13, unit: "eggs" }) } },
    ]);
    k.say("defrosted the chicken", [{ type: "item.defrost", target: { name: "chicken" } }]);
    const offer = fourth.applied[0].batchOffers![0];
    k.tap([{ type: "item.batch.keep", target: { itemId: offer.itemId, batchId: offer.older[1].batchId } }]);
    k.say("the old eggs are gone", [{ type: "item.batch.close", target: { name: "eggs", which: "oldest" } }]);
    k.say("moved the eggs to the pantry", [{ type: "item.update", target: { name: "eggs", which: "newest" }, fields: { location: said("pantry") } }]);
    undo(k, fourth);
    for (const step of k.history) expect(k.replayKitchen(step.events)).toEqual(step.kitchen);
  });

  it("events from before batches replay into one batch with the item's own ID (as migration 0008 backfills)", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 10, 9, m)).toISOString();
    const ev = (n: number, type: string, payload: unknown): EventEnvelope => ({
      id: `e${n}`,
      stream: "kitchen:k1",
      seq: n,
      type,
      v: 1,
      actor: "vero",
      via: "chat",
      recordedAt: at(n),
      occurredAt: null,
      changeSetId: `cs${n}`,
      sourceMessageId: null,
      reverses: null,
      corrects: null,
      payload,
    });
    const legacy = [
      ev(1, "item.added", { itemId: "eggs", name: said("eggs"), standardName: "egg", quantity: said({ asSaid: "12 eggs", amount: 12, unit: "eggs" }) }),
      ev(2, "item.used", { itemId: "eggs", amountUsed: said({ asSaid: "12 eggs", amount: 12, unit: "eggs" }), quantityAfter: { value: { asSaid: "0 eggs", amount: 0, unit: "eggs" }, basis: "inferred", confidence: "high" }, stock: { value: "out", basis: "inferred", confidence: "high" } }),
      // the old "added again" restock
      ev(3, "item.updated", { itemId: "eggs", set: { quantity: said({ asSaid: "6 eggs", amount: 6, unit: "eggs" }) }, clear: ["stock"] }),
      ev(4, "item.added", { itemId: "milk", name: said("milk"), standardName: "milk", location: said("fridge") }),
      ev(5, "item.updated", { itemId: "milk", set: { location: said("pantry") }, clear: [] }),
    ];
    const state = replay(legacy);
    expect(state.items.eggs.batches.map((b) => b.id)).toEqual(["eggs"]);
    expect(openBatches(state.items.eggs)).toHaveLength(1);
    expect(state.items.eggs.stock).toBeUndefined();
    expect(state.items.eggs.quantity?.value.amount).toBe(6);
    expect(state.items.milk.batches[0]).toMatchObject({ id: "milk", location: said("pantry") });
    // An item saved without batches (an older projection or Undo snapshot) reads the same.
    const { batches: _b, ...bare } = state.items.milk;
    void _b;
    expect(ensureBatches(bare).batches[0]).toMatchObject({ id: "milk", location: said("pantry"), addedAt: state.items.milk.addedAt });
  });
});
