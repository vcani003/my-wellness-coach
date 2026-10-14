/** Small builders for KitchenState rows in UI tests. */
import type { ItemRow, KitchenState } from "@/contracts/kitchen-state";

const said = <T,>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
export const VERO = { id: "vero", name: "Vero" };
export const LEVI = { id: "levi", name: "Levi" };
export const T0 = "2026-10-14T10:00:00.000Z";

export function item(id: string, name: string, extra: Partial<ItemRow> = {}): ItemRow {
  return {
    id,
    name: said(name),
    standardName: name.toLowerCase(),
    addedAt: T0,
    createdAt: T0,
    createdBy: VERO,
    updatedAt: T0,
    updatedBy: VERO,
    ...extra,
  };
}

export function kitchen(items: ItemRow[], version = 1): KitchenState {
  return { kitchenId: "k1", version, items, meals: [], plan: [], ticks: [], toReview: [] };
}

export { said };
