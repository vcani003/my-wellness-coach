/**
 * Item categories (CAT1 Rec): which category an item gets, and when the user's own word wins.
 * Pure. The keyword guess itself is `src/shared/item-category.ts` (client-safe).
 *
 * - **Said beats inferred** (0011): a category the user said is never replaced by a guess,
 *   whether the guess is the AI's, a remembered one or the keyword map's.
 * - **Remembering corrections:** a said category is remembered for that standard name in the
 *   kitchen (`item.category.remembered`); later adds of the name default to it, as `inferred`
 *   with high confidence (the user said it about an earlier item, not this one).
 * - Items saved before categories have none stored; they read as `effectiveCategory`, computed
 *   on every read and never written, so the "backfill" is safe on live data and the same on
 *   replay (0028).
 */
import type { Fact, ItemCategory } from "@/contracts/common";
import { guessCategoryFact } from "@/shared/item-category";
import type { Item, KitchenEntities } from "./state";

/** The kitchen's remembered choice for a standard name, as a default for a new add. */
export function rememberedCategory(standardName: string, kitchen: KitchenEntities): Fact<ItemCategory> | undefined {
  const pref = kitchen.categoryPrefs[standardName];
  return pref ? { value: pref.category, basis: "inferred", confidence: "high" } : undefined;
}

/** No category given: the remembered choice, else the keyword guess (`other` / low if none). */
export function defaultCategory(name: string, standardName: string, kitchen: KitchenEntities): Fact<ItemCategory> {
  return rememberedCategory(standardName, kitchen) ?? guessCategoryFact(name);
}

/** The category a brand-new item gets: said > remembered > the AI's guess > the keyword guess. */
export function categoryForNewItem(
  given: Fact<ItemCategory> | undefined,
  name: string,
  standardName: string,
  kitchen: KitchenEntities,
): Fact<ItemCategory> {
  if (given?.basis === "said") return given;
  return rememberedCategory(standardName, kitchen) ?? given ?? guessCategoryFact(name);
}

/** What an item reads as: its stored category, else (saved before categories) the default. */
export function effectiveCategory(item: Pick<Item, "category" | "name" | "standardName">, kitchen: KitchenEntities): Fact<ItemCategory> {
  return item.category ?? defaultCategory(item.name.value, item.standardName, kitchen);
}

const same = (a: Fact<ItemCategory> | undefined, b: Fact<ItemCategory>) => a?.value === b.value && a.basis === b.basis;

/**
 * Buying more of something already in the kitchen (`item.add` merging into it): the item keeps
 * its category unless the user said a new one now, or it has none stored yet. Returns the
 * category to set, or undefined for no change.
 */
export function categoryOnRestock(stored: Fact<ItemCategory> | undefined, given: Fact<ItemCategory> | undefined): Fact<ItemCategory> | undefined {
  if (!given || same(stored, given)) return undefined;
  if (!stored) return given;
  return given.basis === "said" ? given : undefined;
}

/**
 * `item.update` setting a category: it replaces the stored one, except that a guess never
 * replaces one the user said. Returns the category to set, or undefined for no change.
 */
export function categoryOnUpdate(stored: Fact<ItemCategory> | undefined, given: Fact<ItemCategory> | undefined): Fact<ItemCategory> | undefined {
  if (!given || same(stored, given)) return undefined;
  if (stored?.basis === "said" && given.basis !== "said") return undefined;
  return given;
}
