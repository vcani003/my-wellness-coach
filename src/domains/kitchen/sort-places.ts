/**
 * Sorting "Not sure where" once (0041), the pure part: which unplaced batches go where, and the
 * one-line message. Applied by `applyPlacesSortOnce` (commands.ts) as ONE ordinary change set
 * (event-logged, one "What changed" receipt, one Undo); the chat message is saved by
 * `src/server/places-sort.ts`, called from the main layout on the first app load after this ships.
 *
 * No AI call: the code's guess (`src/shared/item-place.ts`) is instant, free and the same every
 * time, and a page load shouldn't wait on a model. Only open batches with **no** place are touched,
 * so a said (or any) place is never overridden; things that genuinely can't be placed (bananas,
 * drinks, "Other") stay "Not sure where".
 */
import type { Fact, Location } from "@/contracts/common";
import { openBatches } from "./batches";
import { effectiveCategory } from "./categories";
import { placeForNewBatch } from "./places";
import type { KitchenEntities } from "./state";

/** One change set holds at most this many moves (the ProposedChange operation limit). */
export const MAX_SORT_MOVES = 50;

export const PLACES_SORT_ACTION = "places.sort";

/** The fixed idempotency key: one sort per kitchen, ever (also after an Undo). */
export const placesSortProposalId = (kitchenId: string) => `places-sort-0041:${kitchenId}`;

export interface PlannedMove {
  itemId: string;
  batchId: string;
  name: string;
  location: Fact<Location>;
}

/**
 * A place for every open batch that has none, where one can be inferred (the kitchen's remembered
 * place for the name, where the item's other batches are, else the code's guess from its name and
 * type). Items in name order, so the receipt reads well and the plan is stable.
 */
export function planPlacesSort(kitchen: KitchenEntities): { moves: PlannedMove[]; unplaced: number } {
  const moves: PlannedMove[] = [];
  let unplaced = 0;
  const items = Object.values(kitchen.items).sort((a, b) => a.name.value.localeCompare(b.name.value) || a.id.localeCompare(b.id));
  for (const item of items) {
    for (const batch of openBatches(item)) {
      if (batch.location) continue;
      const location = placeForNewBatch(
        {
          frozen: batch.frozen,
          name: item.name.value,
          standardName: item.standardName,
          category: effectiveCategory(item, kitchen),
          existing: item,
        },
        kitchen,
      );
      if (location) moves.push({ itemId: item.id, batchId: batch.id, name: item.name.value, location });
      else unplaced += 1;
    }
  }
  return { moves: moves.slice(0, MAX_SORT_MOVES), unplaced: unplaced + Math.max(0, moves.length - MAX_SORT_MOVES) };
}

const PLACE_NAME: Record<Location, string> = { fridge: "Fridge", freezer: "Freezer", pantry: "Pantry" };

/** "I sorted 9 items from "Not sure where" into their usual places: 5 to the Fridge and 4 to the Pantry. …" */
export function sortedReply(moves: PlannedMove[], unplaced: number): string {
  const items = new Set(moves.map((m) => m.itemId)).size;
  const byPlace = new Map<Location, Set<string>>();
  for (const m of moves) byPlace.set(m.location.value, (byPlace.get(m.location.value) ?? new Set()).add(m.itemId));
  const parts = (["fridge", "freezer", "pantry"] as const)
    .filter((l) => byPlace.has(l))
    .map((l) => `${byPlace.get(l)!.size} to the ${PLACE_NAME[l]}`);
  const list = new Intl.ListFormat("en", { type: "conjunction" }).format(parts);
  let text = `I sorted ${items} ${items === 1 ? "item" : "items"} from "Not sure where" into their usual places: ${list}.`;
  if (unplaced > 0) text += ` ${unplaced === 1 ? "One thing stays" : `${unplaced} things stay`} under "Not sure where".`;
  return `${text} If something's in the wrong place, tap Undo or tell me where it goes.`;
}
