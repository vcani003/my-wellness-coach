/**
 * Shopping list grouping (ux.md §10, SL1): one group per store in order of first use, "Anywhere"
 * last, empty groups gone. Within a group, rows keep the order added; rows that were already
 * ticked when you opened the app sit at the bottom ("next visit"), but a tick made now never
 * moves a row (ux.md §2: nothing moves while you tick).
 */
import type { ShoppingItemRow } from "@/contracts/kitchen-state";

export const ANYWHERE = "__anywhere__";

export interface ShoppingGroup<T> {
  /** Store name as spelled on the list, or ANYWHERE. */
  key: string;
  rows: T[];
}

/** Store matching ignores case and spacing, like the backend's merge (backend-data.md §6). */
const storeKey = (store: string | undefined) => {
  const s = store?.trim();
  return s ? s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() || ANYWHERE : ANYWHERE;
};

export function groupShopping<T extends { item: Pick<ShoppingItemRow, "id" | "store"> }>(
  rows: readonly T[],
  tickedAtOpen: ReadonlySet<string> = new Set(),
): ShoppingGroup<T>[] {
  const groups = new Map<string, ShoppingGroup<T>>();
  for (const row of rows) {
    const k = storeKey(row.item.store?.value);
    let g = groups.get(k);
    if (!g) {
      g = { key: k === ANYWHERE ? ANYWHERE : row.item.store!.value.trim(), rows: [] };
      groups.set(k, g);
    }
    g.rows.push(row);
  }
  const out = [...groups.values()].map((g) => ({
    ...g,
    rows: [...g.rows.filter((r) => !tickedAtOpen.has(r.item.id)), ...g.rows.filter((r) => tickedAtOpen.has(r.item.id))],
  }));
  return [...out.filter((g) => g.key !== ANYWHERE), ...out.filter((g) => g.key === ANYWHERE)];
}

/** Insert "removed · Undo" notes back where the row was, so nothing jumps (ux.md §10). */
export function withGhosts<T>(rows: T[], ghosts: readonly { index: number; row: T }[]): T[] {
  const out = [...rows];
  for (const g of [...ghosts].sort((a, b) => a.index - b.index)) out.splice(Math.min(g.index, out.length), 0, g.row);
  return out;
}
