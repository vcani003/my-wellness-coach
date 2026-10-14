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
    expect(done.applied[0].refs[0]).toEqual({ kind: "item", id: kitchenGinger, change: "updated" });
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
      { kind: "item", id: itemId, change: "added" },
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
