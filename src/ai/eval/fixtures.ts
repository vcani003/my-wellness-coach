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

/** A shopping-list entry (0027): name, optional store and quantity, ticked or not. */
export interface ListSpec {
  name: string;
  store?: string;
  quantity?: string;
  ticked?: boolean;
}

export function listItem(spec: ListSpec, index: number) {
  const at = new Date(NOW.getTime() - 3_600_000).toISOString();
  const f = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
  return {
    id: `shop-${index + 1}`,
    name: f(spec.name),
    standardName: standardName(spec.name),
    ...(spec.quantity && { quantity: f({ asSaid: spec.quantity }) }),
    ...(spec.store && { store: f(spec.store) }),
    source: "chat" as const,
    ...(spec.ticked && { ticked: { by: actor, at } }),
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
  };
}

export function kitchen(items: ItemSpec[] = [], version = 3, list: ListSpec[] = []): KitchenState {
  return KitchenState.parse({
    kitchenId: "k-home",
    version,
    items: items.map(item),
    meals: [],
    plan: [],
    ticks: [],
    toReview: [],
    shoppingList: list.map(listItem),
  });
}

export function request(
  text: string,
  items: ItemSpec[] = [],
  history: InterpretRequest["history"] = [],
  list: ListSpec[] = [],
): InterpretRequest {
  const state = kitchen(items, 3, list);
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

/** The list after the first-test message (0026, 0027): MD Oriental ×8, Publix ×1. */
export const VERO_LIST: ListSpec[] = [
  { name: "garlic", store: "MD Oriental" },
  { name: "ginger", store: "MD Oriental" },
  { name: "green onion", store: "MD Oriental" },
  { name: "shallot", store: "MD Oriental" },
  { name: "culantro", store: "MD Oriental" },
  { name: "lemongrass", store: "MD Oriental" },
  { name: "sweet potato", store: "MD Oriental" },
  { name: "coconut milk", store: "MD Oriental" },
  { name: "oatmilk", store: "Publix" },
];

/** Vero's first real test message (0027): only the pho was saved. */
export const FIRST_TEST_MESSAGE =
  "I've made a beef pho. I need to shop for some staple pantry items and other ingredients for other dishes ill be making this week. " +
  "MD Oriental Market: garlic, ginger, green onion, shallot, culantro, lemongrass, sweet potato, ginger, coconut milk / Publix: oatmilk";
