/**
 * The shopping list (0027, SL1–SL3, SL5 Rec): `apply` and validation on the in-memory kitchen.
 * Merge, shared ticks, remove, "Done shopping" with some items chosen, Undo, and replay.
 */
import { describe, expect, it } from "vitest";
import { KitchenState } from "@/contracts/kitchen-state";
import { Operation } from "@/contracts/operations";
import { apply, emptyKitchen, getKitchenEntity, kitchenTouchedKeys, replay } from "@/domains/kitchen/state";
import { SL5_BOUGHT_IN_CHAT_CLEARS_LIST, type Plan, type RevertPlan } from "@/domains/kitchen/validate";
import { MemoryKitchen, said, type OpInput } from "../support/memory-kitchen";
import { PHO_LIST, PHO_MESSAGE, phoShoppingOps } from "../support/shopping";

const codes = (p: Plan) => p.rejected.map((r) => r.reason.code);
const listOf = (k: MemoryKitchen) => k.state().shoppingList.map((e) => [e.name.value, e.store?.value]);
const entry = (k: MemoryKitchen, name: string) => {
  const e = k.state().shoppingList.find((x) => x.name.value === name);
  if (!e) throw new Error(`${name} is not on the list`);
  return e;
};

/** What the command's `prepareRevert` builds, for the in-memory kitchen. */
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
function undo(k: MemoryKitchen, plan: Plan, actor = "vero"): Plan {
  const csId = plan.events[0].changeSetId;
  return k.tap([{ type: "changeset.revert", target: { changeSetId: csId } }], {
    actor,
    reverts: new Map([[csId, revertPlan(k, plan)]]),
  });
}

function phoKitchen() {
  const k = new MemoryKitchen();
  const plan = k.say(PHO_MESSAGE, phoShoppingOps);
  return { k, plan };
}

describe("shopping.add", () => {
  it("keeps Vero's list: ginger merged, two stores, in the order said", () => {
    const { k, plan } = phoKitchen();
    expect(plan.rejected).toEqual([]);
    expect(listOf(k)).toEqual(PHO_LIST.map(([n, s]) => [n, s]));
    // The second ginger saved nothing and says so.
    expect(plan.applied[7].summary.code).toBe("SHOPPING_ALREADY");
    expect(plan.applied[7].refs).toEqual([]);
    expect(plan.events).toHaveLength(9);
    expect(k.state().shoppingList.every((e) => e.source === "chat" && !e.ticked)).toBe(true);
  });

  it("merging with a new store or quantity updates the one item", () => {
    const k = new MemoryKitchen();
    k.tap([{ type: "shopping.add", source: "staples", fields: { name: said("hoisin sauce") } }]);
    const again = k.say("we need 2 hoisin sauces from Publix", [
      { type: "shopping.add", fields: { name: said("hoisin sauces"), store: said("Publix"), quantity: said({ asSaid: "2" }) } },
    ]);
    expect(again.applied[0].summary.code).toBe("SHOPPING_STORE");
    const list = k.state().shoppingList;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: { value: "hoisin sauce" }, store: { value: "Publix" }, quantity: { value: { asSaid: "2" } }, source: "staples" });
  });

  it("reuses the spelling of a store already on the list (SL1 groups don't split)", () => {
    const { k } = phoKitchen();
    k.say("add fish sauce from md oriental market", [
      { type: "shopping.add", evidence: "fish sauce", fields: { name: said("fish sauce"), store: said("md oriental market") } },
    ]);
    expect(entry(k, "fish sauce").store?.value).toBe("MD Oriental Market");
  });

  it("a pasted list may add to the shopping list, but not remove from it", () => {
    const k = new MemoryKitchen();
    k.tap([{ type: "shopping.add", fields: { name: said("eggs") } }]);
    const text = "here's my list: rice noodles, eggs";
    const pasted = [{ start: 16, end: text.length }];
    const plan = k.say(
      text,
      [
        { type: "shopping.add", evidence: "rice noodles", fields: { name: said("rice noodles") } },
        { type: "shopping.remove", evidence: "eggs", target: { name: "eggs" } },
      ],
      { pastedRanges: pasted },
    );
    expect(plan.applied.map((a) => a.opId)).toEqual(["op-1"]);
    expect(codes(plan)).toEqual(["NOT_ALLOWED"]);
  });
});

describe("shopping.tick", () => {
  it("is shared: each member's tick shows who made it; a second tick changes nothing", () => {
    const { k } = phoKitchen();
    k.tap([{ type: "shopping.tick", target: { name: "garlic" }, ticked: true }], { actor: "vero" });
    k.tap([{ type: "shopping.tick", target: { shoppingItemId: entry(k, "ginger").id }, ticked: true }], { actor: "sam" });
    const again = k.tap([{ type: "shopping.tick", target: { name: "garlic" }, ticked: true }], { actor: "sam" });

    expect(again.events).toEqual([]);
    expect(entry(k, "garlic").ticked?.by).toEqual({ id: "vero", name: "Vero" });
    expect(entry(k, "ginger").ticked?.by).toEqual({ id: "sam", name: "Sam" });

    k.tap([{ type: "shopping.tick", target: { name: "garlic" }, ticked: false }], { actor: "sam" });
    expect(entry(k, "garlic").ticked).toBeUndefined();
    expect(entry(k, "garlic").updatedBy).toEqual({ id: "sam", name: "Sam" });
  });

  it("an item not on the list: unknown ID rejected, unknown name is no change", () => {
    const { k } = phoKitchen();
    const plan = k.tap([
      { type: "shopping.tick", target: { shoppingItemId: "nope" }, ticked: true },
      { type: "shopping.tick", target: { name: "durian" }, ticked: true },
    ]);
    expect(codes(plan)).toEqual(["UNKNOWN_TARGET"]);
    expect(plan.applied[0].summary.code).toBe("SHOPPING_NOT_FOUND");
    expect(plan.events).toEqual([]);
  });
});

describe("shopping.remove and shopping.update", () => {
  it("removes an item; removing it again is refused; adding it again starts a new item", () => {
    const { k } = phoKitchen();
    const id = entry(k, "shallot").id;
    const removed = k.tap([{ type: "shopping.remove", target: { shoppingItemId: id } }]);
    expect(removed.applied[0].refs).toEqual([{ kind: "shopping", id, change: "removed" }]);
    expect(listOf(k).map(([n]) => n)).not.toContain("shallot");
    expect(k.kitchen.shopping[id].status).toBe("removed");

    expect(codes(k.tap([{ type: "shopping.remove", target: { shoppingItemId: id } }]))).toEqual(["NOT_ON_LIST"]);
    k.say("shallot", [{ type: "shopping.add", fields: { name: said("shallot") } }]);
    expect(entry(k, "shallot").id).not.toBe(id);
  });

  it("'move culantro to Publix' and clearing a store (back to Anywhere)", () => {
    const { k } = phoKitchen();
    const moved = k.say("move culantro to Publix", [
      { type: "shopping.update", target: { name: "culantro" }, fields: { store: said("publix") } },
    ]);
    expect(moved.applied[0].summary).toMatchObject({ code: "SHOPPING_STORE", params: { name: "culantro", store: "Publix" } });
    expect(entry(k, "culantro").store?.value).toBe("Publix");

    k.tap([{ type: "shopping.update", target: { name: "culantro" }, fields: {}, clear: ["store"] }]);
    expect(entry(k, "culantro").store).toBeUndefined();

    const bad = k.tap([{ type: "shopping.update", target: { name: "garlic" }, fields: { store: said("Publix") }, clear: ["store"] }]);
    expect(codes(bad)).toEqual(["INVALID_OPERATION"]);
  });
});

describe("shopping.done (SL2)", () => {
  function shopped() {
    const { k } = phoKitchen();
    for (const name of ["garlic", "ginger", "oatmilk"]) {
      k.tap([{ type: "shopping.tick", target: { name }, ticked: true }]);
    }
    return k;
  }

  it("moves only the chosen ticked items into the kitchen, in one change set", () => {
    const k = shopped();
    k.tap([{ type: "shopping.update", target: { name: "garlic" }, fields: { quantity: said({ asSaid: "2 heads" }) } }]);
    const garlic = entry(k, "garlic").id;
    const ginger = entry(k, "ginger").id;
    const done = k.tap([
      { type: "shopping.done", items: [{ shoppingItemId: garlic }, { shoppingItemId: ginger, fields: { location: said("fridge") } }] },
    ]);

    expect(done.rejected).toEqual([]);
    expect(done.applied[0].summary).toMatchObject({ code: "SHOPPING_DONE", params: { count: 2, names: "garlic, ginger" } });
    expect(new Set(done.events.map((e) => e.changeSetId)).size).toBe(1);
    const state = k.state();
    expect(state.items.map((i) => i.name.value)).toEqual(["garlic", "ginger"]);
    expect(state.items[0].quantity?.value.asSaid).toBe("2 heads");
    expect(state.items[1].location?.value).toBe("fridge");
    // Oatmilk was ticked but not chosen: it stays, still ticked. Unticked items stay too.
    expect(listOf(k).map(([n]) => n)).toEqual(["green onion", "shallot", "culantro", "lemongrass", "sweet potato", "coconut milk", "oatmilk"]);
    expect(entry(k, "oatmilk").ticked).toBeDefined();
    expect(k.kitchen.shopping[garlic]).toMatchObject({ status: "moved", movedToItemId: state.items[0].id });
  });

  it("uses item.add's rules: an Out item of the same name is restocked, not duplicated", () => {
    const k = shopped();
    k.say("I bought ginger", [{ type: "item.add", fields: { name: said("ginger") } }]); // SL5 moves the list's ginger
    k.say("I'm out of ginger", [{ type: "item.use", target: { name: "ginger" }, fields: { stock: said("out") } }]);
    k.say("ginger", [{ type: "shopping.add", fields: { name: said("ginger") } }]);
    k.tap([{ type: "shopping.tick", target: { name: "ginger" }, ticked: true }]);
    const kitchenGinger = k.item("ginger")!.id;
    const done = k.tap([{ type: "shopping.done", items: [{ shoppingItemId: entry(k, "ginger").id }] }]);
    expect(done.applied[0].refs[0]).toEqual({ kind: "item", id: kitchenGinger, change: "updated", batchId: expect.any(String) });
    expect(Object.values(k.kitchen.items).filter((i) => i.standardName === "ginger")).toHaveLength(1);
    expect(k.item("ginger")!.stock).toBeUndefined();
  });

  it("is all or nothing: unticked, gone, unknown or repeated items refuse the whole step", () => {
    const k = shopped();
    const garlic = entry(k, "garlic").id;
    const shallot = entry(k, "shallot").id; // not ticked
    expect(codes(k.tap([{ type: "shopping.done", items: [{ shoppingItemId: garlic }, { shoppingItemId: shallot }] }]))).toEqual([
      "NOT_TICKED",
    ]);
    expect(codes(k.tap([{ type: "shopping.done", items: [{ shoppingItemId: "nope" }] }]))).toEqual(["UNKNOWN_TARGET"]);
    expect(codes(k.tap([{ type: "shopping.done", items: [{ shoppingItemId: garlic }, { shoppingItemId: garlic }] }]))).toEqual([
      "INVALID_OPERATION",
    ]);
    expect(k.state().items).toEqual([]);
    k.tap([{ type: "shopping.done", items: [{ shoppingItemId: garlic }] }]);
    expect(codes(k.tap([{ type: "shopping.done", items: [{ shoppingItemId: garlic }] }]))).toEqual(["NOT_ON_LIST"]);
  });

  it("one Undo takes the items back out of the kitchen and puts them back on the list, ticked", () => {
    const k = shopped();
    const before = k.state().shoppingList;
    const done = k.tap([
      { type: "shopping.done", items: ["garlic", "ginger"].map((n) => ({ shoppingItemId: entry(k, n).id })) },
    ]);
    const undone = undo(k, done);
    expect(undone.rejected).toEqual([]);
    const after = k.state();
    expect(after.items).toEqual([]);
    expect(after.shoppingList.map((e) => [e.id, e.name.value, Boolean(e.ticked)])).toEqual(
      before.map((e) => [e.id, e.name.value, Boolean(e.ticked)]),
    );
  });
});

describe("SL5 Rec: buying in chat takes the item off the list", () => {
  it("is switched on", () => {
    expect(SL5_BOUGHT_IN_CHAT_CLEARS_LIST).toBe(true);
  });

  it("'I bought garlic' moves the open list item in the same change set; one Undo restores both", () => {
    const { k } = phoKitchen();
    const garlic = entry(k, "garlic").id;
    const bought = k.say("I bought garlic", [{ type: "item.add", evidence: "garlic", fields: { name: said("garlic") } }]);
    const itemId = k.item("garlic")!.id;
    expect(bought.applied[0].summary.code).toBe("ITEM_ADDED_FROM_LIST");
    expect(bought.applied[0].refs).toEqual([
      { kind: "item", id: itemId, change: "added", batchId: expect.any(String) },
      { kind: "shopping", id: garlic, change: "removed" },
    ]);
    expect(k.kitchen.shopping[garlic]).toMatchObject({ status: "moved", movedToItemId: itemId });

    undo(k, bought);
    expect(k.item("garlic")).toBeUndefined();
    expect(entry(k, "garlic").id).toBe(garlic);
  });

  it("only for chat, and only for the same standard name", () => {
    const { k } = phoKitchen();
    k.tap([{ type: "item.add", fields: { name: said("garlic") } }]);
    k.say("I bought onions", [{ type: "item.add", fields: { name: said("onions") } }]);
    expect(listOf(k).map(([n]) => n)).toContain("garlic");
    expect(listOf(k).map(([n]) => n)).toContain("green onion");
  });
});

describe("contract and apply", () => {
  it("the new operations parse; KitchenState from an older build gets an empty list", () => {
    const ops: unknown[] = [
      { opId: "1", type: "shopping.add", fields: { name: said("eggs"), store: null }, source: "stock-offer" },
      { opId: "2", type: "shopping.update", target: { name: "eggs" }, fields: {}, clear: ["quantity"] },
      { opId: "3", type: "shopping.tick", target: { shoppingItemId: "s1" }, ticked: false },
      { opId: "4", type: "shopping.remove", target: { shoppingItemId: "s1" } },
      { opId: "5", type: "shopping.done", items: [{ shoppingItemId: "s1", fields: { location: said("pantry") } }] },
    ];
    for (const op of ops) expect(Operation.safeParse(op).success).toBe(true);
    expect(Operation.safeParse({ opId: "6", type: "shopping.done", items: [] }).success).toBe(false);
    const old = KitchenState.parse({ kitchenId: "k", version: 1, items: [], meals: [], plan: [], ticks: [], toReview: [] });
    expect(old.shoppingList).toEqual([]);
  });

  it("apply ignores shopping events about missing list items", () => {
    const s = emptyKitchen();
    const e = (type: string, payload: unknown) => ({
      id: "e", stream: "kitchen:k1", seq: 1, type, v: 1, actor: "vero", via: "chat" as const,
      recordedAt: "2026-10-14T18:00:00.000Z", occurredAt: null, changeSetId: "cs", sourceMessageId: null,
      reverses: null, corrects: null, payload,
    });
    for (const [type, payload] of [
      ["shopping.updated", { shoppingItemId: "x", set: {}, clear: [] }],
      ["shopping.ticked", { shoppingItemId: "x", ticked: true }],
      ["shopping.removed", { shoppingItemId: "x" }],
      ["shopping.moved", { shoppingItemId: "x", itemId: "i" }],
    ] as const) {
      expect(apply(s, e(type, payload))).toBe(s);
    }
  });

  it("replaying all events equals the step-by-step state, at every step", () => {
    const { k } = phoKitchen();
    const steps: [string, OpInput[], string?][] = [
      ["tap", [{ type: "shopping.tick", target: { name: "garlic" }, ticked: true }], "vero"],
      ["tap", [{ type: "shopping.tick", target: { name: "oatmilk" }, ticked: true }], "sam"],
      ["tap", [{ type: "shopping.remove", target: { name: "shallot" } }]],
      ["say", [{ type: "shopping.update", target: { name: "culantro" }, fields: { store: said("Publix") } }]],
      ["say", [{ type: "item.add", fields: { name: said("lemongrass") } }]],
    ];
    for (const [how, ops, actor] of steps) {
      if (how === "tap") k.tap(ops, { actor });
      else k.say("I bought lemongrass; move culantro to Publix", ops);
    }
    const done = k.tap([{ type: "shopping.done", items: [{ shoppingItemId: entry(k, "garlic").id }] }]);
    undo(k, done);
    for (const step of k.history) expect(k.replayKitchen(step.events)).toEqual(step.kitchen);
  });
});

describe("Do later → To review (shopping-list card)", () => {
  /** Vero's list with garlic and ginger ticked; shallot chosen too, though not ticked. */
  function queued() {
    const { k } = phoKitchen();
    for (const name of ["garlic", "ginger"]) k.tap([{ type: "shopping.tick", target: { name }, ticked: true }]);
    const ids = ["garlic", "ginger", "shallot"].map((n) => entry(k, n).id);
    const plan = k.tap([{ type: "review.queue", kind: "add-to-kitchen", items: ids.map((shoppingItemId) => ({ shoppingItemId })) }]);
    const reviewId = plan.applied[0]?.refs[0]?.id;
    return { k, plan, ids, reviewId };
  }
  const card = (k: MemoryKitchen) => k.state().toReview.find((r) => r.origin === "shopping-list");
  const cardNames = (k: MemoryKitchen) => card(k)?.items.map((e) => e.name);

  it("queues the chosen items as one card; the list doesn't change", () => {
    const { k, plan, ids } = queued();
    expect(plan.rejected).toEqual([]);
    expect(plan.applied[0].summary).toMatchObject({ code: "SHOPPING_REVIEW_QUEUED", params: { names: "garlic, ginger, shallot" } });
    expect(plan.applied[0].refs).toEqual([{ kind: "review", id: expect.any(String), change: "added" }]);
    expect(plan.events.map((e) => e.type)).toEqual(["review.queued"]);
    const r = card(k)!;
    expect(r).toMatchObject({ kind: "add-to-kitchen", origin: "shopping-list", status: "pending" });
    expect(r.meal).toBeUndefined();
    expect(r.items).toEqual(ids.map((shoppingItemId, i) => ({ name: ["garlic", "ginger", "shallot"][i], shoppingItemId })));
    // Still on the list, ticks as they were; nothing in the kitchen yet.
    expect(k.state().shoppingList).toHaveLength(9);
    expect(k.state().shoppingList.filter((e) => e.ticked).map((e) => e.name.value)).toEqual(["garlic", "ginger"]);
    expect(k.state().items).toEqual([]);
  });

  it("refuses a card that isn't a set of open list items", () => {
    const { k } = phoKitchen();
    const garlic = entry(k, "garlic").id;
    k.tap([{ type: "shopping.remove", target: { name: "shallot" } }]);
    const shallot = Object.values(k.kitchen.shopping).find((e) => e.name.value === "shallot")!.id;
    const q = (items: unknown[], kind: "add-to-kitchen" | "after-cooking" = "add-to-kitchen") =>
      codes(k.tap([{ type: "review.queue", kind, items } as unknown as OpInput]));
    expect(q([])).toEqual(["INVALID_OPERATION"]);
    expect(q([{ shoppingItemId: garlic }], "after-cooking")).toEqual(["INVALID_OPERATION"]);
    expect(q([{ shoppingItemId: garlic }, { shoppingItemId: garlic }])).toEqual(["INVALID_OPERATION"]);
    expect(q([{ name: "garlic" }])).toEqual(["INVALID_OPERATION"]); // no meal, no list item
    expect(q([{ shoppingItemId: "nope" }])).toEqual(["UNKNOWN_TARGET"]);
    expect(q([{ shoppingItemId: shallot }])).toEqual(["NOT_ON_LIST"]);
    // A meal's card can't carry list items.
    k.ideas.set("idea-1", { name: "Beef pho" });
    const mealId = k.tap([{ type: "meal.choose", target: { ideaId: "idea-1" } }]).applied[0].refs[0].id;
    expect(codes(k.tap([{ type: "review.queue", kind: "add-to-kitchen", mealId, items: [{ shoppingItemId: garlic }] }]))).toEqual([
      "INVALID_OPERATION",
    ]);
    expect(k.state().toReview).toEqual([]);
  });

  it("Do later again adds to the same card; the same items again change nothing", () => {
    const { k, reviewId } = queued();
    const oatmilk = entry(k, "oatmilk").id;
    const again = k.tap([
      { type: "review.queue", kind: "add-to-kitchen", items: [{ shoppingItemId: entry(k, "ginger").id }, { shoppingItemId: oatmilk }] },
    ]);
    expect(again.applied[0].refs).toEqual([{ kind: "review", id: reviewId, change: "updated" }]);
    expect(again.events.map((e) => e.type)).toEqual(["review.updated"]);
    expect(k.state().toReview).toHaveLength(1);
    expect(cardNames(k)).toEqual(["garlic", "ginger", "shallot", "oatmilk"]);

    const same = k.tap([{ type: "review.queue", kind: "add-to-kitchen", items: [{ shoppingItemId: oatmilk }] }]);
    expect(same.applied[0].summary.code).toBe("NO_CHANGE");
    expect(same.events).toEqual([]);
  });

  it("Add runs the same path as Done shopping: same kitchen and list, one change set, card closed", () => {
    const { k, reviewId } = queued();
    const garlic = entry(k, "garlic").id;
    const ginger = entry(k, "ginger").id;
    const resolved = k.tap([
      {
        type: "review.resolve",
        target: { reviewId },
        outcome: "done",
        items: [{ shoppingItemId: garlic }, { shoppingItemId: ginger, fields: { location: said("fridge") } }],
      },
    ]);
    expect(resolved.rejected).toEqual([]);
    expect(resolved.applied[0].summary).toMatchObject({ code: "SHOPPING_DONE", params: { count: 2, names: "garlic, ginger" } });
    // The place the user picked for ginger is remembered for next time (0041).
    expect(resolved.events.map((e) => e.type)).toEqual(["item.added", "shopping.moved", "item.added", "item.location.remembered", "shopping.moved", "review.resolved"]);
    expect(new Set(resolved.events.map((e) => e.changeSetId)).size).toBe(1);
    expect(resolved.applied[0].refs.at(-1)).toEqual({ kind: "review", id: reviewId, change: "updated" });
    expect(k.kitchen.reviews[reviewId].status).toBe("done");
    expect(k.state().toReview).toEqual([]);

    // A twin kitchen that used "Done shopping" directly ends up with the same kitchen and list.
    const twin = phoKitchen().k;
    for (const name of ["garlic", "ginger"]) twin.tap([{ type: "shopping.tick", target: { name }, ticked: true }]);
    twin.tap([
      {
        type: "shopping.done",
        items: [{ shoppingItemId: entry(twin, "garlic").id }, { shoppingItemId: entry(twin, "ginger").id, fields: { location: said("fridge") } }],
      },
    ]);
    const facts = (m: MemoryKitchen) => m.state().items.map((i) => [i.name.value, i.location?.value, i.quantity?.value.asSaid]);
    expect(facts(k)).toEqual(facts(twin));
    expect(listOf(k)).toEqual(listOf(twin));
    // Shallot was queued but not chosen at Add: it stays on the list.
    expect(listOf(k).map(([n]) => n)).toContain("shallot");
  });

  it("Add is all or nothing: an unticked item, an item not on the card or no items refuse it, and the card stays", () => {
    const { k, reviewId } = queued();
    const shallot = entry(k, "shallot").id; // queued but not ticked
    const oatmilk = entry(k, "oatmilk").id; // not on the card
    const garlic = entry(k, "garlic").id;
    const resolve = (extra: Record<string, unknown>) =>
      codes(k.tap([{ type: "review.resolve", target: { reviewId }, outcome: "done", ...extra } as OpInput]));
    expect(resolve({ items: [{ shoppingItemId: garlic }, { shoppingItemId: shallot }] })).toEqual(["NOT_TICKED"]);
    k.tap([{ type: "shopping.tick", target: { name: "oatmilk" }, ticked: true }]);
    expect(resolve({ items: [{ shoppingItemId: oatmilk }] })).toEqual(["INVALID_OPERATION"]);
    expect(resolve({})).toEqual(["INVALID_OPERATION"]);
    expect(codes(k.tap([{ type: "review.resolve", target: { reviewId }, outcome: "skipped", items: [{ shoppingItemId: garlic }] }]))).toEqual([
      "INVALID_OPERATION",
    ]);
    expect(k.state().items).toEqual([]);
    expect(cardNames(k)).toEqual(["garlic", "ginger", "shallot"]);
    // A list item changed since the version on screen: STALE_TARGET, like Done shopping.
    const stale = k.tap([{ type: "review.resolve", target: { reviewId }, outcome: "done", items: [{ shoppingItemId: garlic }] }], {
      staleKeys: new Set([`shopping:${garlic}`]),
    });
    expect(codes(stale)).toEqual(["STALE_TARGET"]);
  });

  it("Skip closes the card and changes nothing else; it can't be resolved twice", () => {
    const { k, reviewId } = queued();
    const before = k.state().shoppingList;
    const skipped = k.tap([{ type: "review.resolve", target: { reviewId }, outcome: "skipped" }]);
    expect(skipped.events.map((e) => e.type)).toEqual(["review.resolved"]);
    expect(k.state().toReview).toEqual([]);
    expect(k.state().shoppingList).toEqual(before);
    expect(codes(k.tap([{ type: "review.resolve", target: { reviewId }, outcome: "skipped" }]))).toEqual(["INVALID_TRANSITION"]);
  });

  it("one Undo of Add takes the items out of the kitchen, puts them back on the list and the card back in To review", () => {
    const { k, reviewId, ids } = queued();
    const listBefore = k.state().shoppingList;
    const resolved = k.tap([
      { type: "review.resolve", target: { reviewId }, outcome: "done", items: ids.slice(0, 2).map((shoppingItemId) => ({ shoppingItemId })) },
    ]);
    const undone = undo(k, resolved);
    expect(undone.rejected).toEqual([]);
    expect(k.state().items).toEqual([]);
    expect(k.state().shoppingList.map((e) => [e.id, Boolean(e.ticked)])).toEqual(listBefore.map((e) => [e.id, Boolean(e.ticked)]));
    expect(card(k)?.id).toBe(reviewId);
    expect(cardNames(k)).toEqual(["garlic", "ginger", "shallot"]);
  });

  it("the card shows only what's still on the list and drops out when nothing is; Undo brings it back", () => {
    const { k, reviewId } = queued();
    k.tap([{ type: "shopping.update", target: { name: "shallot" }, fields: { name: said("shallots") } }]);
    k.tap([{ type: "shopping.remove", target: { name: "ginger" } }]);
    expect(cardNames(k)).toEqual(["garlic", "shallots"]); // named as on the list now
    k.say("I bought garlic", [{ type: "item.add", fields: { name: said("garlic") } }]); // SL5
    const last = k.tap([{ type: "shopping.remove", target: { name: "shallots" } }]);
    expect(k.state().toReview).toEqual([]);
    expect(k.kitchen.reviews[reviewId].status).toBe("pending");
    undo(k, last);
    expect(cardNames(k)).toEqual(["shallots"]);
    // Do later again after that prunes what left the list and adds the new choice.
    k.tap([{ type: "review.queue", kind: "add-to-kitchen", items: [{ shoppingItemId: entry(k, "culantro").id }] }]);
    expect(k.kitchen.reviews[reviewId].items.map((e) => e.name)).toEqual(["shallot", "culantro"]);
  });

  it("replay equals the step-by-step state; old review events and cached states still read as meal cards", () => {
    const { k, reviewId, ids } = queued();
    k.tap([{ type: "review.queue", kind: "add-to-kitchen", items: [{ shoppingItemId: entry(k, "oatmilk").id }] }]);
    const resolved = k.tap([{ type: "review.resolve", target: { reviewId }, outcome: "done", items: [{ shoppingItemId: ids[0] }] }]);
    undo(k, resolved);
    for (const step of k.history) expect(k.replayKitchen(step.events)).toEqual(step.kitchen);

    const oldEvent = {
      id: "e", stream: "kitchen:k1", seq: 1, type: "review.queued", v: 1, actor: "vero", via: "button" as const,
      recordedAt: "2026-10-14T18:00:00.000Z", occurredAt: null, changeSetId: "cs", sourceMessageId: null,
      reverses: null, corrects: null, payload: { reviewId: "r1", kind: "after-cooking", mealId: "m1", items: [{ name: "eggs" }] },
    };
    expect(apply(emptyKitchen(), oldEvent).reviews.r1).toMatchObject({ origin: "meal", mealId: "m1" });
    expect(apply(emptyKitchen(), { ...oldEvent, type: "review.updated", payload: { reviewId: "x", items: [] } })).toEqual(emptyKitchen());
    const cached = KitchenState.parse({
      kitchenId: "k", version: 1, items: [], meals: [], plan: [], ticks: [], shoppingList: [],
      toReview: [{ id: "r1", kind: "after-cooking", meal: { id: "m1", title: "Pho" }, items: [], status: "pending",
        createdAt: "2026-10-14T18:00:00.000Z", createdBy: { id: "v", name: "Vero" }, updatedAt: "2026-10-14T18:00:00.000Z", updatedBy: { id: "v", name: "Vero" } }],
    });
    expect(cached.toReview[0].origin).toBe("meal");
    expect(Operation.safeParse({ opId: "1", type: "review.resolve", target: { reviewId: "r" }, outcome: "done", items: [] }).success).toBe(false);
  });
});
