/**
 * "Use it up" signals (0025, AI8): the facts the meal AI ranks on, per current item. Code only
 * reports them; the ranking and its thresholds belong to the AI (`src/ai/meals/use-it-up.ts`).
 * No shelf-life prediction (spec §10), and never "safe to eat".
 */
import type { ItemRow, KitchenState } from "@/contracts/kitchen-state";
import type { Location } from "@/contracts/common";

const DAY_MS = 86_400_000;

export interface UseItUpSignal {
  itemId: string;
  name: string;
  location?: Location;
  /** Open batches (an item from an older cached state counts as 1). */
  batchCount: number;
  /** The oldest open batch: the one used first. */
  oldestBatchId: string;
  oldestAddedAt: string;
  /** Whole days since the oldest batch was added (0 = today). */
  oldestDays: number;
  /** The most recent "defrosted on" among the open batches, and whole days since. */
  defrostedOn?: string;
  defrostedDays?: number;
  /** Every open batch is Low ("Running low"). AI9 decides whether Low excuses allergens. */
  low: boolean;
}

export function wholeDaysSince(iso: string, now: Date): number {
  const d = Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

export function signalFor(item: ItemRow, now: Date): UseItUpSignal {
  const oldest = item.batches?.[0];
  const oldestAddedAt = oldest?.addedAt ?? item.addedAt;
  const defrostedOn = item.defrostedOn?.value;
  return {
    itemId: item.id,
    name: item.name.value,
    ...(item.location ? { location: item.location.value } : {}),
    batchCount: item.batches?.length || 1,
    oldestBatchId: oldest?.id ?? item.id,
    oldestAddedAt,
    oldestDays: wholeDaysSince(oldestAddedAt, now),
    ...(defrostedOn ? { defrostedOn, defrostedDays: wholeDaysSince(defrostedOn, now) } : {}),
    low: item.stock?.value === "low",
  };
}

/** Signals for every current item, oldest batch first. Pure. */
export function computeUseItUpSignals(state: Pick<KitchenState, "items">, now: Date): UseItUpSignal[] {
  return state.items
    .map((i) => signalFor(i, now))
    .sort((a, b) => a.oldestAddedAt.localeCompare(b.oldestAddedAt) || a.itemId.localeCompare(b.itemId));
}
