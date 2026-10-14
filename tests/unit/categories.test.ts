/**
 * Item categories (CAT1 Rec, 0011): the keyword map (English, Vietnamese, other Asian pantry
 * words), accent-insensitive search, and the category rules on the pure domain: item.add guesses,
 * said beats inferred, remembering a correction for future adds, Undo, replay == step by step.
 */
import { describe, expect, it } from "vitest";
import { ITEM_CATEGORIES, type ItemCategory } from "@/contracts/common";
import { ItemAdd, ItemUpdate } from "@/contracts/operations";
import { KitchenState } from "@/contracts/kitchen-state";
import { getKitchenEntity, kitchenTouchedKeys, replay } from "@/domains/kitchen/state";
import { buildKitchenState } from "@/domains/kitchen/read-model";
import type { Plan, RevertPlan } from "@/domains/kitchen/validate";
import { CATEGORY_LABEL_EN, englishGlosses, guessCategory, guessCategoryFact } from "@/shared/item-category";
import { matchesItemSearch, searchItems } from "@/shared/item-search";
import { foldText } from "@/shared/text";
import type { EventEnvelope } from "@/shared/events/types";
import { MemoryKitchen, inferred, said } from "../support/memory-kitchen";

const add = (name: string, category?: ReturnType<typeof said<ItemCategory>>) => ({
  type: "item.add" as const,
  fields: { name: said(name), ...(category ? { category } : {}) },
});
const setCategory = (name: string, category: ReturnType<typeof said<ItemCategory>>) => ({
  type: "item.update" as const,
  target: { name },
  fields: { category },
});
const row = (k: MemoryKitchen, name: string) => k.state().items.find((i) => i.name.value === name);
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
  return k.tap([{ type: "changeset.revert", target: { changeSetId: csId } }], { reverts });
}

describe("the keyword map", () => {
  it.each<[string, ItemCategory]>([
    // The CAT1 examples
    ["nước mắm", "sauces_condiments"],
    ["nuoc mam", "sauces_condiments"],
    ["Fish sauce", "sauces_condiments"],
    ["hoisin", "sauces_condiments"],
    ["sriracha", "sauces_condiments"],
    ["bánh phở", "rice_noodles_grains"],
    ["rice noodles", "rice_noodles_grains"],
    ["jasmine rice", "rice_noodles_grains"],
    ["pho leftovers", "leftovers"],
    ["leftover phở", "leftovers"],
    // Longest phrase wins; ties go to the English head noun (the last word)
    ["fish", "meat_seafood"],
    ["salmon fillets", "meat_seafood"],
    ["coconut milk", "canned_jarred"],
    ["milk", "dairy_eggs"],
    ["eggs", "dairy_eggs"],
    ["egg noodles", "rice_noodles_grains"],
    ["eggplant", "produce"],
    ["chili sauce", "sauces_condiments"],
    ["chicken thighs", "meat_seafood"],
    ["chicken broth", "canned_jarred"],
    ["chicken curry", "leftovers"],
    ["tomatoes", "produce"],
    ["canned tomatoes", "canned_jarred"],
    ["a jar of kimchi", "canned_jarred"],
    ["cooked rice", "leftovers"],
    ["rice vinegar", "sauces_condiments"],
    ["rice flour", "baking"],
    ["potato chips", "snacks_sweets"],
    ["bok choy", "produce"],
    ["kaffir lime leaves", "produce"],
    ["star anise", "spices_seasonings"],
    ["black pepper", "spices_seasonings"],
    ["oat milk", "dairy_eggs"],
    ["green tea", "drinks"],
    ["brown sugar", "baking"],
    // Vietnamese, with and without accents
    ["tương ớt", "sauces_condiments"],
    ["dầu hào", "sauces_condiments"],
    ["mắm tôm", "sauces_condiments"],
    ["xì dầu", "sauces_condiments"],
    ["cà chua", "produce"],
    ["cá hồi", "meat_seafood"],
    ["thịt bò", "meat_seafood"],
    ["tôm", "meat_seafood"],
    ["rau muống", "produce"],
    ["sả", "produce"],
    ["đậu hũ", "produce"],
    ["dau hu", "produce"],
    ["trứng", "dairy_eggs"],
    ["sữa chua", "dairy_eggs"],
    ["bún", "rice_noodles_grains"],
    ["bánh tráng", "rice_noodles_grains"],
    ["gạo nếp", "rice_noodles_grains"],
    ["mì gói", "rice_noodles_grains"],
    ["bột ngọt", "spices_seasonings"],
    ["hạt nêm", "spices_seasonings"],
    ["nước cốt dừa", "canned_jarred"],
    ["bột năng", "baking"],
    ["đường", "baking"],
    ["kẹo", "snacks_sweets"],
    ["cà phê", "drinks"],
    ["phở bò", "leftovers"],
    ["cơm thừa", "leftovers"],
    // Other Asian pantry words
    ["gochujang", "sauces_condiments"],
    ["miso", "sauces_condiments"],
    ["udon", "rice_noodles_grains"],
    ["Shaoxing wine", "sauces_condiments"],
  ])("%s → %s", (name, category) => {
    expect(guessCategory(name)).toEqual({ category, matched: true });
    expect(guessCategoryFact(name)).toEqual({ value: category, basis: "inferred", confidence: "medium" });
  });

  it("anything unmatched is Other, inferred, low confidence", () => {
    for (const name of ["zzz", "mystery thing", "", "   "]) {
      expect(guessCategoryFact(name)).toEqual({ value: "other", basis: "inferred", confidence: "low" });
    }
  });

  it("is deterministic and only ever returns a known category", () => {
    for (const name of ["nước mắm", "chicken", "zzz", "canned leftover soup"]) {
      expect(guessCategory(name)).toEqual(guessCategory(name));
      expect(ITEM_CATEGORIES).toContain(guessCategory(name).category);
    }
    // Leftovers beats a container: it's food someone cooked.
    expect(guessCategory("canned leftover soup").category).toBe("leftovers");
  });

  it("has an English fallback name for every category, in the CAT1 order", () => {
    expect(Object.keys(CATEGORY_LABEL_EN)).toEqual(ITEM_CATEGORIES);
  });

  it("glosses Vietnamese words in English, longest phrase only", () => {
    expect(englishGlosses("nước mắm")).toEqual(["fish sauce"]);
    expect(englishGlosses("bánh phở")).toEqual(["rice noodles"]);
    expect(englishGlosses("eggs")).toEqual([]);
  });
});

describe("search (case- and accent-insensitive)", () => {
  const item = (name: string, standardName = name) => ({ name: { value: name }, standardName });

  it("folds accents, case and đ", () => {
    expect(foldText("Nước Mắm")).toBe("nuoc mam");
    expect(foldText("ĐẬU HŨ")).toBe("dau hu");
    expect(foldText("Crème fraîche")).toBe("creme fraiche");
  });

  it("finds an item by the name as said or the standard name, in any case and without accents", () => {
    const nuocMam = item("nước mắm");
    for (const q of ["nuoc mam", "NƯỚC MẮM", "Nuoc", "mam", "nước"]) expect(matchesItemSearch(q, nuocMam)).toBe(true);
    expect(matchesItemSearch("chicken thigh", item("Chicken Thighs", "chicken thigh"))).toBe(true);
    expect(matchesItemSearch("thighs", item("Chicken Thighs", "chicken thigh"))).toBe(true);
    expect(matchesItemSearch("eggs", item("egg"))).toBe(true);
  });

  it("finds a Vietnamese item by its English name (CAT1: type “fish”)", () => {
    expect(matchesItemSearch("fish", item("nước mắm"))).toBe(true);
    expect(matchesItemSearch("rice noodles", item("bánh phở"))).toBe(true);
  });

  it("needs every word, in any order, and an empty query matches everything", () => {
    const items = [item("fish sauce"), item("fresh fish"), item("soy sauce")];
    expect(searchItems(items, "sauce fish").map((i) => i.name.value)).toEqual(["fish sauce"]);
    expect(searchItems(items, "fish").map((i) => i.name.value)).toEqual(["fish sauce", "fresh fish"]);
    expect(searchItems(items, "  ")).toEqual(items);
    expect(searchItems(items, "milk")).toEqual([]);
  });

  it("works on KitchenState items alone", () => {
    const k = new MemoryKitchen();
    k.say("I bought nước mắm and eggs", [add("nước mắm"), add("eggs")]);
    expect(searchItems(k.state().items, "nuoc mam").map((i) => i.name.value)).toEqual(["nước mắm"]);
  });
});

describe("categories on items (pure domain)", () => {
  it("is in the contract: item.add / item.update take an optional category fact", () => {
    expect(ItemAdd.safeParse({ opId: "1", type: "item.add", fields: { name: said("x"), category: inferred("produce") } }).success).toBe(true);
    expect(ItemAdd.safeParse({ opId: "1", type: "item.add", fields: { name: said("x"), category: null } }).success).toBe(true);
    expect(ItemAdd.safeParse({ opId: "1", type: "item.add", fields: { name: said("x"), category: inferred("fruit") } }).success).toBe(false);
    expect(ItemUpdate.safeParse({ opId: "1", type: "item.update", target: { name: "x" }, fields: { category: said("other") } }).success).toBe(true);
    expect(ItemUpdate.safeParse({ opId: "1", type: "item.update", target: { name: "x" }, fields: {}, clear: ["category"] }).success).toBe(false);
  });

  it("item.add without a category gets the keyword guess; with one, the AI's guess", () => {
    const k = new MemoryKitchen();
    k.say("bought fish sauce, zzz and limes", [add("fish sauce"), add("zzz"), add("limes", inferred("produce"))]);
    expect(row(k, "fish sauce")!.category).toEqual({ value: "sauces_condiments", basis: "inferred", confidence: "medium" });
    expect(row(k, "zzz")!.category).toEqual({ value: "other", basis: "inferred", confidence: "low" });
    expect(row(k, "limes")!.category).toEqual(inferred("produce"));
    expect(k.item("fish sauce")!.category).toBeDefined(); // stored on the event, not computed later
    expect(() => KitchenState.parse(k.state())).not.toThrow();
  });

  it("a said category is stored as said and remembered; a guess is not remembered", () => {
    const k = new MemoryKitchen();
    const p = k.say("bought hoisin, it goes with sauces", [add("hoisin", said("sauces_condiments"))]);
    expect(row(k, "hoisin")!.category).toEqual(said("sauces_condiments"));
    expect(k.kitchen.categoryPrefs["hoisin"]).toMatchObject({ standardName: "hoisin", category: "sauces_condiments" });
    expect(p.touched).toContain("catpref:hoisin");
    k.say("bought limes", [add("limes", inferred("produce"))]);
    expect(k.kitchen.categoryPrefs["lime"]).toBeUndefined();
  });

  it("item.update with a said category overrides the guess and is remembered", () => {
    const k = new MemoryKitchen();
    k.say("bought nước mắm", [add("nước mắm", inferred("other"))]);
    const p = k.say("nước mắm goes under sauces", [setCategory("nước mắm", said("sauces_condiments"))]);
    expect(codes(p)).toEqual(["ITEM_CATEGORY"]);
    expect(p.applied[0].summary).toMatchObject({ params: { name: "nước mắm", category: "sauces_condiments", categoryName: "Sauces & condiments" } });
    expect(row(k, "nước mắm")!.category).toEqual(said("sauces_condiments"));
    expect(k.kitchen.categoryPrefs["nước mắm"]?.category).toBe("sauces_condiments");
    // The category is the item's; its batch is untouched.
    expect(k.item("nước mắm")!.batches[0]).not.toHaveProperty("category");
  });

  it("a guess never replaces a category the user said", () => {
    const k = new MemoryKitchen();
    k.say("bought tofu", [add("tofu")]);
    k.say("tofu goes under meat & seafood", [setCategory("tofu", said("meat_seafood"))]);
    // The AI guessing again (update or buying more) changes nothing.
    const p = k.say("tofu is produce I think", [setCategory("tofu", inferred("produce"))]);
    expect(codes(p)).toEqual(["NO_CHANGE"]);
    expect(p.events).toEqual([]);
    k.say("bought more tofu", [add("tofu", inferred("produce"))]);
    expect(row(k, "tofu")!.category).toEqual(said("meat_seafood"));
    expect(row(k, "tofu")!.batches).toHaveLength(2);
    // Saying it again does change it.
    k.say("tofu goes under other", [setCategory("tofu", said("other"))]);
    expect(row(k, "tofu")!.category).toEqual(said("other"));
    expect(k.kitchen.categoryPrefs["tofu"]?.category).toBe("other");
  });

  it("an inferred update replaces an inferred category", () => {
    const k = new MemoryKitchen();
    k.say("bought zzz", [add("zzz")]);
    k.say("zzz is a drink", [setCategory("zzz", inferred("drinks"))]);
    expect(row(k, "zzz")!.category).toEqual(inferred("drinks"));
    expect(k.kitchen.categoryPrefs["zzz"]).toBeUndefined();
  });

  it("remembers a correction for future adds of that name, over the AI's guess", () => {
    const k = new MemoryKitchen();
    k.say("bought fish sauce", [add("fish sauce")]);
    k.say("fish sauce goes under canned", [setCategory("fish sauce", said("canned_jarred"))]);
    k.say("threw out the fish sauce", [{ type: "item.remove", target: { name: "fish sauce" } }]);
    k.say("bought fish sauce", [add("Fish Sauce", inferred("sauces_condiments"))]);
    expect(row(k, "Fish Sauce")!.category).toEqual({ value: "canned_jarred", basis: "inferred", confidence: "high" });
    // And through Done shopping, which adds with item.add's rules.
    k.say("threw it out", [{ type: "item.remove", target: { name: "fish sauce" } }]);
    k.say("put fish sauce on the list", [{ type: "shopping.add", fields: { name: said("fish sauce") } }]);
    const listed = k.state().shoppingList[0];
    k.tap([{ type: "shopping.tick", target: { shoppingItemId: listed.id }, ticked: true }]);
    k.tap([{ type: "shopping.done", items: [{ shoppingItemId: listed.id }] }]);
    expect(row(k, "fish sauce")!.category?.value).toBe("canned_jarred");
  });

  it("a correction for something not in the kitchen is only remembered (no item is added)", () => {
    const k = new MemoryKitchen();
    const p = k.say("hoisin goes under sauces", [setCategory("hoisin", said("sauces_condiments"))]);
    expect(codes(p)).toEqual(["CATEGORY_REMEMBERED"]);
    expect(k.state().items).toEqual([]);
    expect(k.kitchen.categoryPrefs["hoisin"]?.category).toBe("sauces_condiments");
    k.say("bought hoisin", [add("hoisin")]);
    expect(row(k, "hoisin")!.category).toEqual({ value: "sauces_condiments", basis: "inferred", confidence: "high" });
    // A guess about something not in the kitchen does nothing.
    expect(codes(k.say("zzz is a drink", [setCategory("zzz", inferred("drinks"))]))).toEqual(["NO_CHANGE"]);
  });

  it("saying the remembered category again for another item adds no second memory event", () => {
    const k = new MemoryKitchen();
    k.say("hoisin goes under sauces", [setCategory("hoisin", said("sauces_condiments"))]);
    const p = k.say("bought hoisin, under sauces", [add("hoisin", said("sauces_condiments"))]);
    expect(p.events.map((e) => e.type)).toEqual(["item.added"]);
  });

  it("a rename re-sorts an item the user never sorted, but not one they did", () => {
    const k = new MemoryKitchen();
    k.say("bought zzz", [add("zzz")]);
    k.say("zzz is actually fish sauce", [{ type: "item.update", target: { name: "zzz" }, fields: { name: said("fish sauce") } }]);
    expect(row(k, "fish sauce")!.category?.value).toBe("sauces_condiments");
    k.say("fish sauce goes under other", [setCategory("fish sauce", said("other"))]);
    k.say("it's called nước mắm", [{ type: "item.update", target: { name: "fish sauce" }, fields: { name: said("nước mắm") } }]);
    expect(row(k, "nước mắm")!.category).toEqual(said("other"));
  });

  it("Undo of a correction restores the old category and forgets it; replay == step by step", () => {
    const k = new MemoryKitchen();
    k.say("bought fish sauce", [add("fish sauce")]);
    const fix = k.say("fish sauce goes under canned", [setCategory("fish sauce", said("canned_jarred"))]);
    expect(fix.touched.sort()).toEqual(["catpref:fish sauce", `item:${k.item("fish sauce")!.id}`]);
    undo(k, fix);
    expect(row(k, "fish sauce")!.category).toEqual({ value: "sauces_condiments", basis: "inferred", confidence: "medium" });
    expect(k.kitchen.categoryPrefs).toEqual({});
    for (const h of k.history) expect(k.replayKitchen(h.events)).toEqual(h.kitchen);
  });

  it("items saved before categories read as the keyword guess, the same on replay", () => {
    const legacy: EventEnvelope = {
      id: "e1", stream: "kitchen:k1", seq: 1, type: "item.added", v: 1, actor: "vero", via: "chat",
      recordedAt: "2026-10-01T12:00:00.000Z", occurredAt: null, changeSetId: "cs1", sourceMessageId: null,
      reverses: null, corrects: null,
      payload: { itemId: "it1", name: said("bánh phở"), standardName: "bánh phở" },
    };
    const kitchen = replay([legacy]);
    expect(kitchen.items.it1.category).toBeUndefined();
    const state = buildKitchenState(kitchen, { kitchenId: "k1", version: 1, names: new Map(), restrictions: [] });
    expect(state.items[0].category).toEqual({ value: "rice_noodles_grains", basis: "inferred", confidence: "medium" });
  });
});
