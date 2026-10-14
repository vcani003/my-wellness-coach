/** Small KitchenState builders for the AI unit tests and the eval set. */
import type { Location, StockLevel } from "@/contracts/common";
import { KitchenState, type ItemRow } from "@/contracts/kitchen-state";
import { standardName } from "@/shared/text";
import type { InterpretRequest } from "../interpreter";

export const NOW = new Date("2026-10-14T16:00:00.000Z");
const actor = { id: "u-vero", name: "Vero" };

export interface ItemSpec {
  name: string;
  location?: Location;
  stock?: StockLevel;
  frozen?: boolean;
  quantity?: string;
  daysAgo?: number;
}

export function item(spec: ItemSpec, index: number): ItemRow {
  const at = new Date(NOW.getTime() - (spec.daysAgo ?? 1) * 86_400_000).toISOString();
  const f = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
  return {
    id: `item-${index + 1}`,
    name: f(spec.name),
    standardName: standardName(spec.name),
    ...(spec.location && { location: f(spec.location) }),
    ...(spec.stock && { stock: f(spec.stock) }),
    ...(spec.frozen !== undefined && { frozen: f(spec.frozen) }),
    ...(spec.quantity && { quantity: f({ asSaid: spec.quantity }) }),
    addedAt: at,
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
  };
}

export function kitchen(items: ItemSpec[] = [], version = 3): KitchenState {
  return KitchenState.parse({
    kitchenId: "k-home",
    version,
    items: items.map(item),
    meals: [],
    plan: [],
    ticks: [],
    toReview: [],
  });
}

export function request(
  text: string,
  items: ItemSpec[] = [],
  history: InterpretRequest["history"] = [],
): InterpretRequest {
  const state = kitchen(items);
  return {
    kitchenId: state.kitchenId,
    userId: "u-vero",
    message: { id: "msg-1", text },
    state,
    version: state.version,
    history,
  };
}

/** Vero's pantry on the morning of the grocery trip (0026), after making pho. */
export const VERO_PANTRY: ItemSpec[] = [
  { name: "nước mắm (fish sauce)", location: "pantry", stock: "low" },
  { name: "jasmine rice", location: "pantry" },
  { name: "hoisin sauce", location: "pantry" },
  { name: "sriracha", location: "pantry" },
  { name: "pho (leftovers)", location: "fridge", daysAgo: 0 },
  { name: "limes", location: "fridge" },
  { name: "eggs", location: "fridge", stock: "low" },
  { name: "beef", location: "fridge" },
  { name: "star anise" },
];
