/**
 * Where a new batch goes (0041): Kitchen puts things where they usually go, so nobody has to say.
 * Pure. The code-side guess itself is `src/shared/item-place.ts`.
 *
 * Order, first that applies:
 * 1. A place the user **said** ("put the milk in the freezer"), or one their words clearly imply
 *    (`inferred` with **high** confidence: "I froze the chicken" → Freezer). Frozen said or implied
 *    with no place → Freezer.
 * 2. The kitchen's **remembered** place for that name: the user said it before ("onions go in the
 *    pantry", or moved the onions there). Mirrors remembered categories (0032).
 * 3. Buying more of something already in the kitchen: where that item already is.
 * 4. The AI's usual-place guess (`inferred`, medium).
 * 5. The code's guess from the name and type, or none ("Not sure where").
 * Everything but (1) is recorded as `inferred`, so "What changed" can show it and Undo fixes it.
 */
import type { Fact, ItemCategory, Location } from "@/contracts/common";
import { guessPlaceFact } from "@/shared/item-place";
import { openBatches } from "./batches";
import type { Item, KitchenEntities } from "./state";

const FROM_HABIT = { basis: "inferred", confidence: "high" } as const;

/** The kitchen's remembered place for a standard name, as a default for a new add. */
export function rememberedPlace(standardName: string, kitchen: KitchenEntities): Fact<Location> | undefined {
  const pref = kitchen.locationPrefs?.[standardName];
  return pref ? { value: pref.location, ...FROM_HABIT } : undefined;
}

/** Where an item already is: its newest open batch with a place, else its newest batch with one. */
export function existingPlace(item: Item | null | undefined): Fact<Location> | undefined {
  if (!item) return undefined;
  const placed = (batches: Item["batches"]) => [...batches].reverse().find((b) => b.location)?.location;
  const where = placed(openBatches(item)) ?? placed(item.batches ?? []) ?? item.location;
  return where ? { value: where.value, ...FROM_HABIT } : undefined;
}

export interface PlaceInput {
  /** The place proposed with the add (said, implied, or the AI's usual-place guess). */
  given?: Fact<Location>;
  frozen?: Fact<boolean>;
  name: string;
  standardName: string;
  /** The item's type, for the code's guess. */
  category?: Fact<ItemCategory>;
  /** Buying more of this item (0025): it joins it as a new batch. */
  existing?: Item | null;
}

/** The place a new batch gets (see the order above), or undefined for "Not sure where". */
export function placeForNewBatch(input: PlaceInput, kitchen: KitchenEntities): Fact<Location> | undefined {
  const { given, frozen } = input;
  if (given && (given.basis === "said" || given.confidence === "high")) return given;
  if (frozen?.value === true) return { value: "freezer", basis: "inferred", confidence: "high" };
  return (
    rememberedPlace(input.standardName, kitchen) ??
    existingPlace(input.existing) ??
    given ??
    guessPlaceFact(input.name, input.category)
  );
}
