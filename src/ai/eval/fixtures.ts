/** Small KitchenState builders for the AI unit tests and the eval set. */
import type { ItemCategory, Location, StockLevel } from "@/contracts/common";
import { KitchenState, type ItemRow } from "@/contracts/kitchen-state";
import { standardName } from "@/shared/text";
import type { Restriction } from "@/shared/profile/state";
import type { InterpretRequest } from "../interpreter";
import type { MealContext, MealIdeasInput } from "../meals/types";

export const NOW = new Date("2026-10-14T16:00:00.000Z");
const actor = { id: "u-vero", name: "Vero" };

export interface ItemSpec {
  name: string;
  location?: Location;
  stock?: StockLevel;
  frozen?: boolean;
  quantity?: string;
  daysAgo?: number;
  /** Open batches (0025), as days ago, oldest first: `[12, 0]` = "2 batches (Oct 2, today)". */
  batches?: number[];
  /** "Defrosted on" (0025), days ago. */
  defrostedDaysAgo?: number;
  /** CAT1: its category, as the kitchen's guess (inferred) unless `categorySaid`. */
  category?: ItemCategory;
  categorySaid?: boolean;
}

const daysBack = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

export function item(spec: ItemSpec, index: number): ItemRow {
  const at = daysBack(spec.batches?.[0] ?? spec.daysAgo ?? 1);
  const f = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
  const id = `item-${index + 1}`;
  const defrostedOn = spec.defrostedDaysAgo !== undefined ? { value: daysBack(spec.defrostedDaysAgo), basis: "inferred" as const, confidence: "high" as const } : undefined;
  const batches = spec.batches?.map((days, b) => {
    const added = daysBack(days);
    return {
      id: b === 0 ? id : `${id}-b${b + 1}`,
      addedAt: added,
      ...(spec.location && { location: f(spec.location) }),
      ...(spec.frozen !== undefined && { frozen: f(spec.frozen) }),
      ...(spec.stock === "low" && { stock: f("low" as const) }),
      ...(defrostedOn && b === spec.batches!.length - 1 && { defrostedOn }),
      createdAt: added,
      createdBy: actor,
      updatedAt: added,
      updatedBy: actor,
    };
  });
  return {
    id,
    name: f(spec.name),
    standardName: standardName(spec.name),
    ...(spec.category && {
      category: spec.categorySaid ? f(spec.category) : { value: spec.category, basis: "inferred" as const, confidence: "medium" as const },
    }),
    ...(spec.location && { location: f(spec.location) }),
    ...(spec.stock && { stock: f(spec.stock) }),
    ...(spec.frozen !== undefined && { frozen: f(spec.frozen) }),
    ...(spec.quantity && { quantity: f({ asSaid: spec.quantity }) }),
    ...(defrostedOn && { defrostedOn }),
    ...(batches && { batches }),
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
  meals: ReturnType<typeof mealInProgress>[] = [],
): InterpretRequest {
  const state = meals.length ? KitchenState.parse({ ...kitchen(items, 3, list), meals }) : kitchen(items, 3, list);
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

// ─── Meal ideas and recipes (ai.md §5, 0019, 0025) ─────────────────────────────────────

/** Vero's named dish from her local test (MI1), exactly as typed. */
export const NAMED_DISH_MESSAGE =
  "i was thinking a chicken curry, with coconutt milk, lemon grass, kaffir. I have a curry base seasoning packet. i also have potatoes";

/** Her kitchen for it: chicken thighs bought twice (0025), so the older batch goes first. */
export const CURRY_KITCHEN: ItemSpec[] = [
  { name: "chicken thighs", location: "fridge", batches: [3, 0] },
  { name: "jasmine rice", location: "pantry" },
];

/** Ana's kitchen for the cook-along curry (step 1–5 journey): no coconut milk, no garam masala. */
export const COOK_ALONG_KITCHEN: ItemSpec[] = [
  { name: "chicken breasts", location: "fridge", daysAgo: 1 },
  { name: "onions", location: "pantry" },
  { name: "garlic", location: "pantry" },
  { name: "ginger", location: "fridge" },
  { name: "canned chopped tomatoes", location: "pantry" },
  { name: "Greek yogurt", location: "fridge" },
  { name: "basmati rice", location: "pantry" },
];

/** Ben's everyday kitchen for cook-along routing and the pasta journey: no cream, no parmesan. */
export const PASTA_KITCHEN: ItemSpec[] = [
  { name: "penne", location: "pantry" },
  { name: "spinach", location: "fridge", daysAgo: 1 },
  { name: "milk", location: "fridge" },
  { name: "cheddar", location: "fridge" },
  { name: "garlic", location: "pantry" },
  { name: "canned chopped tomatoes", location: "pantry" },
  { name: "beef mince", location: "fridge", daysAgo: 1 },
  { name: "honey", location: "pantry" },
];

/** A meal in progress with a recipe (so "recipe_change" has something to refine). */
export function mealInProgress(id: string, title: string, status: "chosen" | "cooking" = "chosen") {
  const at = new Date(NOW.getTime() - 600_000).toISOString();
  return {
    id,
    title,
    status,
    chosenAt: at,
    recipe: { id: `${id}-recipe`, version: 1, source: "ai" as const },
    allergenFlags: [],
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
  };
}

export const MEMBERS = [
  { userId: "u-vero", name: "Vero" },
  { userId: "u-levi", name: "Levi" },
];

/** A profile restriction as the shared profile stores it (0019). */
export function restriction(spec: {
  userId: string;
  subject: string;
  note?: string;
  kind?: "allergy" | "diet";
}): Restriction {
  const at = NOW.toISOString();
  const f = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });
  return {
    id: `r-${spec.userId}-${standardName(spec.subject)}`,
    userId: spec.userId,
    kind: spec.kind ?? "allergy",
    subject: f(spec.subject),
    subjectKey: standardName(spec.subject),
    ...(spec.note ? { note: f(spec.note) } : {}),
    createdAt: at,
    createdBy: spec.userId,
    updatedAt: at,
    updatedBy: spec.userId,
  };
}

/** Levi's seafood allergy, in his own words (0019, AI7). */
export const LEVI_SEAFOOD = restriction({
  userId: "u-levi",
  subject: "seafood",
  note: "I can eat crab and shrimp if my medicine is on hand",
});

/** Vero's kitchen this week: beef pho leftovers, her pantry, and the MD Oriental list, bought. */
export const VERO_WEEK: ItemSpec[] = [
  ...VERO_PANTRY.map((i) => (i.name === "pho (leftovers)" ? { ...i, daysAgo: 2 } : i)),
  ...VERO_LIST.map((l) => ({ name: l.name, location: l.name === "oatmilk" ? ("fridge" as const) : undefined, daysAgo: 1 })),
];

/** A household kitchen where Levi is allergic to seafood and shrimp was defrosted yesterday. */
export const SHRIMP_KITCHEN: ItemSpec[] = [
  { name: "shrimp", location: "fridge", frozen: false, daysAgo: 3, defrostedDaysAgo: 1 },
  { name: "jasmine rice", location: "pantry" },
  { name: "eggs", location: "fridge", daysAgo: 2 },
  { name: "spinach", location: "fridge", daysAgo: 1 },
  { name: "limes", location: "fridge", daysAgo: 1 },
];

export function mealContext(
  items: ItemSpec[],
  opts: { restrictions?: Restriction[]; userId?: string } = {},
): MealContext {
  const state = kitchen(items);
  return {
    kitchenId: state.kitchenId,
    userId: opts.userId ?? "u-vero",
    state,
    members: MEMBERS,
    restrictions: opts.restrictions ?? [],
  };
}

export function ideasInput(
  items: ItemSpec[],
  request: string | null,
  opts: { restrictions?: Restriction[]; userId?: string; count?: number } = {},
): MealIdeasInput {
  return {
    ...mealContext(items, opts),
    request: request === null ? null : { messageId: "msg-ideas", text: request },
    ...(opts.count ? { count: opts.count } : {}),
  };
}
