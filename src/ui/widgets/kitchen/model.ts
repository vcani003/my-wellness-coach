/** Pure helpers for the Kitchen widget (ux.md §3, decision 0011). */
import type { ItemRow } from "@/contracts/kitchen-state";

export const GROUP_ORDER = ["fridge", "freezer", "pantry", "unknown"] as const;
export type GroupKey = (typeof GROUP_ORDER)[number];

export interface ItemGroup {
  key: GroupKey;
  items: ItemRow[];
}

/**
 * Fridge / Freezer / Pantry / Not sure where, empty groups left out. Inside a group, the most
 * recently changed first; ties keep the kitchen's own order. "Out" items never reach here: the
 * backend leaves them out of `items` (0011).
 */
export function groupItems(items: readonly ItemRow[]): ItemGroup[] {
  const groups = new Map<GroupKey, ItemRow[]>(GROUP_ORDER.map((k) => [k, []]));
  for (const item of items) {
    if (item.stock?.value === "out") continue; // defensive: out items drop off the list
    groups.get(item.location?.value ?? "unknown")!.push(item);
  }
  return GROUP_ORDER.map((key) => ({
    key,
    items: groups.get(key)!.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  })).filter((g) => g.items.length > 0);
}

/** Whole calendar days between two instants, in the device's time zone ("added 3 days ago"). */
export function calendarDaysSince(iso: string, now: Date): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((startOf(now) - startOf(then)) / 86_400_000));
}
