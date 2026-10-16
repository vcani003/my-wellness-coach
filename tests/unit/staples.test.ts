/**
 * Smart staples (0054) on the pure domain: the contract, a staple's computed need (SS3), the
 * staple operations with Undo and replay, the shared kitchen (SS1), the usual store (SS5), the old
 * "Staples: …" preference line (SS2), and the "Add X to my list" offer on Low/Out receipts (SS4,
 * 0055 KOS4-d), which never adds anything by itself. People are fictional (Ana, Ben).
 */
import { describe, expect, it } from "vitest";
import { isListOfferOpen, RefKind } from "@/contracts/apply-result";
import { KitchenState, stapleNeedsBuying, StapleNeed } from "@/contracts/kitchen-state";
import { Operation } from "@/contracts/operations";
import { getKitchenEntity, kitchenTouchedKeys, KITCHEN_EVENT, replay } from "@/domains/kitchen/state";
import type { Plan, RevertPlan } from "@/domains/kitchen/validate";
import { legacyStapleNames, matchStaple, nameKeys, stapleNeed, type NeedContext } from "@/shared/staples";
import { standardName } from "@/shared/text";
import { MemoryKitchen, said, type OpInput } from "../support/memory-kitchen";

const codes = (p: Plan) => p.rejected.map((r) => r.reason.code);
const staple = (name: string, store?: string): OpInput => ({
  type: "staple.add",
  fields: { name: said(name), ...(store ? { store: said(store) } : {}) },
});
const row = (k: MemoryKitchen, name: string) => k.state().staples.find((s) => s.standardName === standardName(name));

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
  return k.tap([{ type: "changeset.revert", target: { changeSetId: csId } }], { actor, reverts: new Map([[csId, revertPlan(k, plan)]]) });
}

const ctx = (over: Partial<NeedContext> = {}): NeedContext => ({ current: [], out: [], list: [], ...over });
const named = (name: string, extra: Record<string, unknown> = {}) => ({ id: `id-${name}`, name, standardName: standardName(name), ...extra });

describe("the contract (0054)", () => {
  it("parses the three staple operations and rejects a staple with no name", () => {
    const add = { opId: "1", type: "staple.add", fields: { name: said("fish sauce"), store: said("MD Oriental") } };
    expect(Operation.safeParse(add).success).toBe(true);
    expect(Operation.safeParse({ ...add, fields: { name: said("") } }).success).toBe(false);
    expect(Operation.safeParse({ opId: "2", type: "staple.update", target: { stapleId: "fish sauce" }, fields: {}, clear: ["store"] }).success).toBe(true);
    expect(Operation.safeParse({ opId: "3", type: "staple.remove", target: { name: "eggs" } }).success).toBe(true);
    // No amounts or par levels (0054, out of scope).
    expect(Operation.safeParse({ ...add, fields: { name: said("rice"), quantity: said({ asSaid: "2" }) } }).success).toBe(true);
    expect((Operation.parse({ ...add, fields: { name: said("rice"), quantity: said({ asSaid: "2" }) } }) as { fields: object }).fields).not.toHaveProperty("quantity");
  });

  it("a state cached by an older build (no staples) still parses, as an empty list", () => {
    const old = { kitchenId: "k", version: 1, items: [], meals: [], plan: [], ticks: [], toReview: [], shoppingList: [] };
    expect(KitchenState.parse(old).staples).toEqual([]);
    expect(RefKind.options).toContain("staple");
  });

  it("Restock pre-selects Out, Low and Not in yet only (SS3)", () => {
    expect(StapleNeed.options.filter(stapleNeedsBuying)).toEqual(["out", "low", "missing"]);
  });
});

describe("a staple's need, computed on read (SS3)", () => {
  it("on the list wins over everything", () => {
    expect(stapleNeed(named("eggs"), ctx({ list: [named("eggs")], current: [named("eggs", { stock: "low" })] }))).toEqual({ need: "on-list", shoppingItemId: "id-eggs" });
  });

  it("not in the kitchen: Out when it was there before, else Not in yet", () => {
    expect(stapleNeed(named("eggs"), ctx({ out: [named("eggs")] })).need).toBe("out");
    expect(stapleNeed(named("eggs"), ctx()).need).toBe("missing");
  });

  it("in the kitchen: Low only when every match is Low; Some, Plenty or no level is 'have'", () => {
    expect(stapleNeed(named("rice"), ctx({ current: [named("rice", { stock: "low" })] }))).toEqual({ need: "low", itemId: "id-rice", level: "low" });
    expect(stapleNeed(named("rice"), ctx({ current: [named("rice", { stock: "some" })] }))).toEqual({ need: "have", itemId: "id-rice", level: "some" });
    expect(stapleNeed(named("rice"), ctx({ current: [named("rice")] }))).toEqual({ need: "have", itemId: "id-rice" });
    expect(stapleNeed(named("rice"), ctx({ current: [named("rice", { stock: "plenty" })] })).need).toBe("have");
  });

  it("matches 'fish sauce' with 'nước mắm (fish sauce)' both ways, and 'rice' with 'jasmine rice' one way only", () => {
    expect(nameKeys("nước mắm (fish sauce)")).toEqual(["nước mắm fish sauce", "nước mắm", "fish sauce"]);
    expect(matchStaple(named("fish sauce"), [named("nước mắm (fish sauce)")])).toHaveLength(1);
    expect(matchStaple(named("nước mắm (fish sauce)"), [named("fish sauce")])).toHaveLength(1);
    expect(matchStaple(named("rice"), [named("jasmine rice")])).toHaveLength(1);
    expect(matchStaple(named("jasmine rice"), [named("rice")])).toHaveLength(0);
    // An exact match wins over a looser one.
    expect(matchStaple(named("rice"), [named("jasmine rice"), named("rice")]).map((c) => c.name)).toEqual(["rice"]);
  });
});

describe("the old 'Staples: …' preference line (SS2)", () => {
  it("splits at commas and 'and', drops repeats, and ignores other statements", () => {
    expect(legacyStapleNames(["Staples: fish sauce, jasmine rice and rice noodles.", "Prefers quick dinners", "staples - Eggs; fish sauce"])).toEqual([
      "fish sauce",
      "jasmine rice",
      "rice noodles",
      "Eggs",
    ]);
    expect(legacyStapleNames(["We like staples a lot"])).toEqual([]);
  });
});

describe("staple.add (SS1, SS2, SS5)", () => {
  it("adds one staple for the whole kitchen, with who added it; never duplicated", () => {
    const k = new MemoryKitchen();
    const plan = k.say("fish sauce is a staple", [staple("fish sauce")]);
    expect(codes(plan)).toEqual([]);
    expect(plan.events.map((e) => e.type)).toEqual([KITCHEN_EVENT.stapleAdded]);
    expect(plan.applied[0].summary).toMatchObject({ code: "STAPLE_ADDED", params: { name: "fish sauce" } });
    expect(plan.applied[0].refs).toEqual([{ kind: "staple", id: "fish sauce", change: "added" }]);
    expect(row(k, "fish sauce")).toMatchObject({ id: "fish sauce", name: said("fish sauce"), need: "missing", createdBy: { id: "vero", name: "Vero" } });
    expect(row(k, "fish sauce")!.store).toBeUndefined();

    // Ben (Sam here) says it again: no change, no duplicate.
    const again = k.say("Fish Sauce is a staple", [staple("Fish Sauce")], { actor: "sam" });
    expect(again.events).toEqual([]);
    expect(again.applied[0].summary.code).toBe("STAPLE_ALREADY");
    expect(again.applied[0].refs).toEqual([]);
    expect(k.state().staples).toHaveLength(1);
  });

  it("keeps a store only as given, spelled like one the kitchen already uses; a new store on a repeat sets it", () => {
    const k = new MemoryKitchen();
    k.tap([{ type: "shopping.add", fields: { name: said("garlic"), store: said("MD Oriental") } }]);
    const plan = k.tap([staple("rice noodles", "md oriental")]);
    expect(plan.applied[0].summary).toMatchObject({ code: "STAPLE_ADDED_STORE", params: { store: "MD Oriental" } });
    expect(row(k, "rice noodles")!.store?.value).toBe("MD Oriental");

    k.tap([staple("eggs")]);
    const store = k.tap([staple("eggs", "Publix")]);
    expect(store.applied[0].summary).toMatchObject({ code: "STAPLE_STORE", params: { name: "eggs", store: "Publix" } });
    expect(store.events.map((e) => e.type)).toEqual([KITCHEN_EVENT.stapleUpdated]);
    expect(row(k, "eggs")!.store?.value).toBe("Publix");
  });

  it("a blank name is refused; pasted text can't make a staple (only typed words count)", () => {
    const k = new MemoryKitchen();
    expect(codes(k.tap([staple(" !! ")]))).toEqual(["INVALID_OPERATION"]);
    const text = "Pasted list: eggs is a staple";
    const plan = k.propose([{ ...staple("eggs"), evidence: "eggs is a staple" }], { messageText: text, pastedRanges: [{ start: 0, end: text.length }] });
    expect(codes(plan)).toEqual(["NOT_ALLOWED"]);
  });
});

describe("staple.update and staple.remove", () => {
  function withStaples() {
    const k = new MemoryKitchen();
    k.tap([staple("fish sauce", "MD Oriental"), staple("eggs"), staple("jasmine rice"), staple("brown rice")]);
    return k;
  }

  it("sets, keeps and clears the usual store (SS5)", () => {
    const k = withStaples();
    const set = k.tap([{ type: "staple.update", target: { stapleId: "egg" }, fields: { store: said("Publix") } }]);
    expect(set.applied[0].summary).toMatchObject({ code: "STAPLE_STORE", params: { name: "eggs", store: "Publix" } });
    const same = k.tap([{ type: "staple.update", target: { name: "eggs" }, fields: { store: said("publix") } }]);
    expect(same.events).toEqual([]);
    expect(same.applied[0].summary.code).toBe("NO_CHANGE");
    const cleared = k.tap([{ type: "staple.update", target: { stapleId: "egg" }, fields: {}, clear: ["store"] }]);
    expect(cleared.applied[0].summary.code).toBe("STAPLE_STORE_CLEARED");
    expect(row(k, "eggs")!.store).toBeUndefined();
  });

  it("removes by ID or by name; unknown, missing and ambiguous targets", () => {
    const k = withStaples();
    const rm = k.say("eggs aren't a staple any more", [{ type: "staple.remove", target: { name: "eggs" } }]);
    expect(rm.applied[0]).toMatchObject({ summary: { code: "STAPLE_REMOVED" }, refs: [{ kind: "staple", id: "egg", change: "removed" }] });
    expect(row(k, "eggs")).toBeUndefined();
    expect(codes(k.tap([{ type: "staple.remove", target: { stapleId: "egg" } }]))).toEqual(["UNKNOWN_TARGET"]);
    const none = k.tap([{ type: "staple.remove", target: { name: "tofu" } }]);
    expect(none.applied[0].summary).toMatchObject({ code: "STAPLE_NOT_FOUND", params: { name: "tofu" } });
    expect(none.events).toEqual([]);
    expect(codes(k.tap([{ type: "staple.remove", target: { name: "rice" } }]))).toEqual(["AMBIGUOUS_ITEM"]);
    // The bracket name finds it too.
    const fish = k.tap([{ type: "staple.remove", target: { name: "nước mắm (fish sauce)" } }]);
    expect(fish.applied[0].summary.code).toBe("STAPLE_REMOVED");
  });

  it("a stapleId changed by someone else since the tap was read is STALE_TARGET", () => {
    const k = withStaples();
    const plan = k.tap([{ type: "staple.remove", target: { stapleId: "egg" } }], { staleKeys: new Set(["staple:egg"]) });
    expect(codes(plan)).toEqual(["STALE_TARGET"]);
  });
});

describe("Undo and replay (0007, 0017)", () => {
  it("Undo of an add removes it; Undo of a remove brings it back as it was, store and who added it", () => {
    const k = new MemoryKitchen();
    const add = k.tap([staple("fish sauce", "MD Oriental")], { actor: "sam" });
    const back = undo(k, add, "sam");
    expect(back.applied[0].refs).toEqual([{ kind: "staple", id: "fish sauce", change: "removed" }]);
    expect(k.state().staples).toEqual([]);

    const again = k.tap([staple("fish sauce", "MD Oriental")], { actor: "sam" });
    const rm = k.tap([{ type: "staple.remove", target: { stapleId: "fish sauce" } }]);
    expect(row(k, "fish sauce")).toBeUndefined();
    undo(k, rm);
    expect(row(k, "fish sauce")).toMatchObject({ store: said("MD Oriental"), createdBy: { id: "sam", name: "Sam" } });
    expect(again.events).toHaveLength(1);
  });

  it("replaying the log gives the same staples at every step", () => {
    const k = new MemoryKitchen();
    k.tap([staple("fish sauce"), staple("eggs", "Publix")]);
    k.tap([{ type: "staple.update", target: { stapleId: "egg" }, fields: {}, clear: ["store"] }]);
    k.tap([{ type: "staple.remove", target: { stapleId: "fish sauce" } }]);
    for (const step of k.history) expect(k.replayKitchen(step.events).staples).toEqual(step.kitchen.staples);
  });
});

describe("the need follows the kitchen and the list (SS3, the loop closes by itself)", () => {
  it("Not in yet → have → Low → on the list → Out", () => {
    const k = new MemoryKitchen();
    k.tap([staple("jasmine rice")]);
    expect(row(k, "jasmine rice")!.need).toBe("missing");
    k.say("bought jasmine rice", [{ type: "item.add", fields: { name: said("jasmine rice") } }]);
    expect(row(k, "jasmine rice")).toMatchObject({ need: "have" });
    k.tap([{ type: "item.stock.set", target: { name: "jasmine rice" }, fields: { stock: said("some") } }]);
    expect(row(k, "jasmine rice")).toMatchObject({ need: "have", level: "some" });
    k.tap([{ type: "item.stock.set", target: { name: "jasmine rice" }, fields: { stock: said("low") } }]);
    expect(row(k, "jasmine rice")).toMatchObject({ need: "low", level: "low" });
    k.tap([{ type: "shopping.add", source: "staples", fields: { name: said("jasmine rice") } }]);
    expect(row(k, "jasmine rice")!.need).toBe("on-list");
    k.tap([{ type: "item.stock.set", target: { name: "jasmine rice" }, fields: { stock: said("out") } }]);
    expect(row(k, "jasmine rice")!.need).toBe("on-list");
    const listId = k.state().shoppingList[0].id;
    k.tap([{ type: "shopping.remove", target: { shoppingItemId: listId } }]);
    expect(row(k, "jasmine rice")!.need).toBe("out");
  });
});

describe("'Add X to my list' after Low or Out (SS4, 0055 KOS4-d)", () => {
  function pantry() {
    const k = new MemoryKitchen();
    k.say("bought", [
      { type: "item.add", fields: { name: said("nước mắm (fish sauce)") } },
      { type: "item.add", fields: { name: said("eggs") } },
      { type: "item.add", fields: { name: said("milk"), quantity: said({ asSaid: "1 l", amount: 1, unit: "l" }) } },
    ]);
    return k;
  }

  it("a chat 'running low' carries the offer; nothing is added to the list", () => {
    const k = pantry();
    const plan = k.say("eggs are running low", [{ type: "item.use", target: { name: "eggs" }, fields: { stock: said("low") } }]);
    expect(plan.applied[0].listOffers).toEqual([{ itemId: k.item("eggs")!.id, name: "eggs", standardName: "egg", level: "low" }]);
    expect(k.state().shoppingList).toEqual([]);
  });

  it("Out, a staple with its store, and isListOfferOpen", () => {
    const k = pantry();
    k.tap([staple("fish sauce", "MD Oriental")]);
    const plan = k.say("we're out of fish sauce", [{ type: "item.stock.set", target: { name: "fish sauce" }, fields: { stock: said("out") } }]);
    const [offer] = plan.applied[0].listOffers!;
    expect(offer).toMatchObject({ name: "nước mắm (fish sauce)", level: "out", stapleId: "fish sauce", store: "MD Oriental" });
    expect(isListOfferOpen(offer, k.state())).toBe(true);
    k.tap([{ type: "shopping.add", source: "stock-offer", fields: { name: said("nước mắm (fish sauce)") } }]);
    expect(isListOfferOpen(offer, k.state())).toBe(false);
  });

  it("Plenty and Some never offer; neither does a change that leaves it as it was", () => {
    const k = pantry();
    for (const level of ["plenty", "some"] as const) {
      const p = k.tap([{ type: "item.stock.set", target: { name: "eggs" }, fields: { stock: said(level) } }]);
      expect(p.applied[0].listOffers).toBeUndefined();
    }
    k.tap([{ type: "item.stock.set", target: { name: "eggs" }, fields: { stock: said("low") } }]);
    const again = k.tap([{ type: "item.use", target: { name: "eggs" }, fields: { amountUsed: said({ asSaid: "2" }) } }]);
    expect(again.applied[0].listOffers).toBeUndefined();
  });

  it("no offer when it's already on the list, or added to it in the same message", () => {
    const k = pantry();
    k.tap([{ type: "shopping.add", fields: { name: said("eggs") } }]);
    expect(k.tap([{ type: "item.use", target: { name: "eggs" }, fields: { stock: said("out") } }]).applied[0].listOffers).toBeUndefined();
    const same = k.say("out of milk, add it to my list", [
      { type: "item.use", target: { name: "milk" }, fields: { stock: said("out") } },
      { type: "shopping.add", fields: { name: said("milk") } },
    ]);
    expect(same.applied.flatMap((a) => a.listOffers ?? [])).toEqual([]);
  });

  it("auto-Out (used it all) and the last batch gone both offer", () => {
    const k = pantry();
    const used = k.tap([{ type: "item.use", target: { name: "milk" }, fields: { amountUsed: said({ asSaid: "1 l", amount: 1, unit: "l" }) } }]);
    expect(used.applied[0].listOffers).toMatchObject([{ name: "milk", level: "out" }]);
    const gone = k.tap([{ type: "item.batch.close", target: { name: "eggs", which: "oldest" } }]);
    expect(gone.applied[0].listOffers).toMatchObject([{ name: "eggs", level: "out" }]);
  });

  it("buying or removing never offers", () => {
    const k = pantry();
    expect(k.tap([{ type: "item.add", fields: { name: said("eggs") } }]).applied[0].listOffers).toBeUndefined();
    expect(k.tap([{ type: "item.remove", target: { name: "milk" } }]).applied[0].listOffers).toBeUndefined();
  });
});
