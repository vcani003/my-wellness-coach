/**
 * Kitchen state and the pure `apply(state, event)` (backend-data.md §3).
 * All kitchen state logic lives here. Undo, or a fix to this logic, rebuilds a kitchen by
 * replaying its events; projections are just this state written to tables.
 */
import type { Fact, Location, MealStatus, Quantity, ReviewKind, ShoppingSource, StockLevel } from "@/contracts/common";
import type { RecipeIngredient, ReviewEntry } from "@/contracts/operations";
import {
  CHANGESET_REVERTED,
  compact,
  splitEntityKey,
  type AuditFields,
  type ChangesetRevertedPayload,
  type EventEnvelope,
} from "@/shared/events/types";

// ─── Entities ─────────────────────────────────────────────────────────────────────────

export interface Item extends AuditFields {
  id: string;
  name: Fact<string>;
  standardName: string;
  quantity?: Fact<Quantity>;
  location?: Fact<Location>;
  frozen?: Fact<boolean>;
  opened?: Fact<boolean>;
  stock?: Fact<StockLevel>;
  occurredAt?: Fact<string>;
  addedAt: string;
  lastUsedAt?: string;
}

export interface Meal extends AuditFields {
  id: string;
  title: string;
  status: MealStatus;
  ideaId?: string;
  planPosition?: number;
  chosenAt: string;
  recipeId?: string;
  note?: string;
  cookedAt?: string;
}

export interface Recipe extends AuditFields {
  id: string;
  mealId: string;
  version: number;
  source: "user" | "ai";
  text: string;
  ingredients: RecipeIngredient[];
  steps: string[];
  basicsAssumed: string[];
}

export interface Tick extends AuditFields {
  mealId: string;
  ingredient: string;
  ingredientKey: string;
}

export interface Review extends AuditFields {
  id: string;
  kind: ReviewKind;
  mealId: string;
  items: ReviewEntry[];
  status: "pending" | "done" | "skipped";
}

export type ShoppingStatus = "open" | "removed" | "moved";

/** A shopping-list item (0027). Removed and moved ones stay, for history, Undo and the link to the kitchen item. */
export interface ShoppingItem extends AuditFields {
  id: string;
  name: Fact<string>;
  standardName: string;
  quantity?: Fact<Quantity>;
  store?: Fact<string>;
  source: ShoppingSource;
  /** List order: one more than the highest so far. Kept on merge. */
  position: number;
  status: ShoppingStatus;
  tickedAt?: string;
  tickedBy?: string;
  /** The kitchen item it became, once moved by "Done shopping". */
  movedToItemId?: string;
}

export interface KitchenEntities {
  items: Record<string, Item>;
  meals: Record<string, Meal>;
  recipes: Record<string, Recipe>;
  /** Keyed by `${mealId}|${ingredientKey}`; present only while ticked. */
  ticks: Record<string, Tick>;
  reviews: Record<string, Review>;
  shopping: Record<string, ShoppingItem>;
}

export type KitchenEntity = Item | Meal | Recipe | Tick | Review | ShoppingItem;

export const emptyKitchen = (): KitchenEntities => ({
  items: {},
  meals: {},
  recipes: {},
  ticks: {},
  reviews: {},
  shopping: {},
});

export const tickId = (mealId: string, ingredientKey: string) => `${mealId}|${ingredientKey}`;

// ─── Events ───────────────────────────────────────────────────────────────────────────

export const KITCHEN_EVENT = {
  itemAdded: "item.added",
  itemUpdated: "item.updated",
  itemUsed: "item.used",
  itemRemoved: "item.removed",
  mealChosen: "meal.chosen",
  mealTransitioned: "meal.transitioned",
  mealNoted: "meal.noted",
  recipeSaved: "recipe.saved",
  checklistTicked: "checklist.ticked",
  reviewQueued: "review.queued",
  reviewResolved: "review.resolved",
  shoppingAdded: "shopping.added",
  shoppingUpdated: "shopping.updated",
  shoppingTicked: "shopping.ticked",
  shoppingRemoved: "shopping.removed",
  shoppingMoved: "shopping.moved",
} as const;

type ItemFactFields = Pick<Item, "quantity" | "location" | "frozen" | "opened" | "occurredAt">;

export interface ItemAddedPayload extends ItemFactFields {
  itemId: string;
  name: Fact<string>;
  standardName: string;
}
export interface ItemUpdatedPayload {
  itemId: string;
  set: Partial<ItemFactFields & { name: Fact<string>; standardName: string }>;
  /** Fields set back to unknown. `stock` is cleared when an item is added again. */
  clear: (keyof ItemFactFields | "stock")[];
}
export interface ItemUsedPayload {
  itemId: string;
  stock?: Fact<StockLevel>;
  amountUsed?: Fact<Quantity>;
  /** undefined = quantity unchanged; null = now unknown; else the computed remainder. */
  quantityAfter?: Fact<Quantity> | null;
  /** Set when recorded by finishing a meal (0013): used in this meal, amount unknown. */
  mealId?: string;
}
export interface ItemRemovedPayload {
  itemId: string;
  reason?: Fact<string>;
}
export interface MealChosenPayload {
  mealId: string;
  title: string;
  ideaId?: string;
  /** false when an existing meal is chosen again (it becomes the most recently chosen). */
  isNew: boolean;
}
export interface MealTransitionedPayload {
  mealId: string;
  from: MealStatus;
  to: MealStatus;
  /** Set when the meal enters the plan; null when it leaves it. */
  planPosition?: number | null;
  note?: string;
}
export interface MealNotedPayload {
  mealId: string;
  note: string;
}
export interface RecipeSavedPayload {
  recipeId: string;
  mealId: string;
  version: number;
  source: "user" | "ai";
  text: string;
  ingredients: RecipeIngredient[];
  steps: string[];
  basicsAssumed: string[];
}
export interface ChecklistTickedPayload {
  mealId: string;
  ingredient: string;
  ingredientKey: string;
  ticked: boolean;
}
export interface ReviewQueuedPayload {
  reviewId: string;
  kind: ReviewKind;
  mealId: string;
  items: ReviewEntry[];
}
export interface ReviewResolvedPayload {
  reviewId: string;
  outcome: "done" | "skipped";
}

export interface ShoppingAddedPayload {
  shoppingItemId: string;
  name: Fact<string>;
  standardName: string;
  quantity?: Fact<Quantity>;
  store?: Fact<string>;
  source: ShoppingSource;
  position: number;
}
type ShoppingFactFields = Pick<ShoppingItem, "name" | "standardName" | "quantity" | "store">;
export interface ShoppingUpdatedPayload {
  shoppingItemId: string;
  set: Partial<ShoppingFactFields>;
  /** Fields set back to unknown. */
  clear: ("quantity" | "store")[];
}
export interface ShoppingTickedPayload {
  shoppingItemId: string;
  ticked: boolean;
}
export interface ShoppingRemovedPayload {
  shoppingItemId: string;
}
export interface ShoppingMovedPayload {
  shoppingItemId: string;
  /** The kitchen item it was added to (or restocked), in the same change set. */
  itemId: string;
}

/** Entity keys a kitchen event touches (`item:<id>` …), for Undo conflicts and STALE_TARGET. */
export function kitchenTouchedKeys(event: EventEnvelope): string[] {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case KITCHEN_EVENT.itemAdded:
    case KITCHEN_EVENT.itemUpdated:
    case KITCHEN_EVENT.itemUsed:
    case KITCHEN_EVENT.itemRemoved:
      return [`item:${p.itemId as string}`];
    case KITCHEN_EVENT.mealChosen:
    case KITCHEN_EVENT.mealTransitioned:
    case KITCHEN_EVENT.mealNoted:
      return [`meal:${p.mealId as string}`];
    case KITCHEN_EVENT.recipeSaved:
      return [`recipe:${p.recipeId as string}`, `meal:${p.mealId as string}`];
    case KITCHEN_EVENT.checklistTicked:
      return [`tick:${tickId(p.mealId as string, p.ingredientKey as string)}`];
    case KITCHEN_EVENT.reviewQueued:
    case KITCHEN_EVENT.reviewResolved:
      return [`review:${p.reviewId as string}`];
    case KITCHEN_EVENT.shoppingAdded:
    case KITCHEN_EVENT.shoppingUpdated:
    case KITCHEN_EVENT.shoppingTicked:
    case KITCHEN_EVENT.shoppingRemoved:
    case KITCHEN_EVENT.shoppingMoved:
      return [`shopping:${p.shoppingItemId as string}`];
    case CHANGESET_REVERTED:
      return Object.keys((event.payload as ChangesetRevertedPayload).restore);
    default:
      return [];
  }
}

const COLLECTION = {
  item: "items",
  meal: "meals",
  recipe: "recipes",
  tick: "ticks",
  review: "reviews",
  shopping: "shopping",
} as const satisfies Record<string, keyof KitchenEntities>;

export function getKitchenEntity(state: KitchenEntities, key: string): KitchenEntity | null {
  const { kind, id } = splitEntityKey(key);
  const coll = COLLECTION[kind as keyof typeof COLLECTION];
  if (!coll) return null;
  return (state[coll] as Record<string, KitchenEntity>)[id] ?? null;
}

// ─── apply ────────────────────────────────────────────────────────────────────────────

const stamp = (e: EventEnvelope) => ({ updatedAt: e.recordedAt, updatedBy: e.actor });
/** Normalise an ISO 8601 string to UTC milliseconds, as the database returns it. */
const toIso = (s: string) => new Date(s).toISOString();
const created = (e: EventEnvelope): AuditFields => ({
  createdAt: e.recordedAt,
  createdBy: e.actor,
  updatedAt: e.recordedAt,
  updatedBy: e.actor,
});

function put<K extends keyof KitchenEntities>(
  state: KitchenEntities,
  coll: K,
  id: string,
  value: KitchenEntities[K][string] | null,
): KitchenEntities {
  const next = { ...state[coll] } as Record<string, unknown>;
  if (value === null) delete next[id];
  else next[id] = compact(value as object);
  return { ...state, [coll]: next };
}

/**
 * Pure: the kitchen state after one event. Events that refer to a missing entity are ignored,
 * so replaying an odd history never throws (0018). Unknown event types are ignored too.
 */
export function apply(state: KitchenEntities, event: EventEnvelope): KitchenEntities {
  switch (event.type) {
    case KITCHEN_EVENT.itemAdded: {
      const p = event.payload as ItemAddedPayload;
      const item: Item = {
        id: p.itemId,
        name: p.name,
        standardName: p.standardName,
        quantity: p.quantity,
        location: p.location,
        frozen: p.frozen,
        opened: p.opened,
        occurredAt: p.occurredAt,
        addedAt: p.occurredAt ? toIso(p.occurredAt.value) : event.recordedAt,
        ...created(event),
      };
      return put(state, "items", item.id, item);
    }
    case KITCHEN_EVENT.itemUpdated: {
      const p = event.payload as ItemUpdatedPayload;
      const prev = state.items[p.itemId];
      if (!prev) return state;
      const next: Item = { ...prev, ...compact(p.set), ...stamp(event) };
      for (const field of p.clear) delete next[field];
      if (p.set.occurredAt) next.addedAt = toIso(p.set.occurredAt.value);
      return put(state, "items", next.id, next);
    }
    case KITCHEN_EVENT.itemUsed: {
      const p = event.payload as ItemUsedPayload;
      const prev = state.items[p.itemId];
      if (!prev) return state;
      const next: Item = { ...prev, lastUsedAt: event.recordedAt, ...stamp(event) };
      if (p.stock) next.stock = p.stock;
      if (p.quantityAfter === null) delete next.quantity;
      else if (p.quantityAfter) next.quantity = p.quantityAfter;
      return put(state, "items", next.id, next);
    }
    case KITCHEN_EVENT.itemRemoved: {
      const p = event.payload as ItemRemovedPayload;
      return put(state, "items", p.itemId, null);
    }
    case KITCHEN_EVENT.mealChosen: {
      const p = event.payload as MealChosenPayload;
      const prev = state.meals[p.mealId];
      if (prev) return put(state, "meals", p.mealId, { ...prev, chosenAt: event.recordedAt, ...stamp(event) });
      const meal: Meal = {
        id: p.mealId,
        title: p.title,
        status: "chosen",
        ideaId: p.ideaId,
        chosenAt: event.recordedAt,
        ...created(event),
      };
      return put(state, "meals", meal.id, meal);
    }
    case KITCHEN_EVENT.mealTransitioned: {
      const p = event.payload as MealTransitionedPayload;
      const prev = state.meals[p.mealId];
      if (!prev) return state;
      const next: Meal = { ...prev, status: p.to, ...stamp(event) };
      if (p.planPosition === null) delete next.planPosition;
      else if (p.planPosition !== undefined) next.planPosition = p.planPosition;
      if (p.to === "done") next.cookedAt = event.occurredAt ?? event.recordedAt;
      if (p.note !== undefined) next.note = p.note;
      return put(state, "meals", next.id, next);
    }
    case KITCHEN_EVENT.mealNoted: {
      const p = event.payload as MealNotedPayload;
      const prev = state.meals[p.mealId];
      if (!prev) return state;
      return put(state, "meals", prev.id, { ...prev, note: p.note, ...stamp(event) });
    }
    case KITCHEN_EVENT.recipeSaved: {
      const p = event.payload as RecipeSavedPayload;
      const recipe: Recipe = {
        id: p.recipeId,
        mealId: p.mealId,
        version: p.version,
        source: p.source,
        text: p.text,
        ingredients: p.ingredients,
        steps: p.steps,
        basicsAssumed: p.basicsAssumed,
        ...created(event),
      };
      let next = put(state, "recipes", recipe.id, recipe);
      const meal = next.meals[p.mealId];
      if (meal) next = put(next, "meals", meal.id, { ...meal, recipeId: recipe.id, ...stamp(event) });
      return next;
    }
    case KITCHEN_EVENT.checklistTicked: {
      const p = event.payload as ChecklistTickedPayload;
      const id = tickId(p.mealId, p.ingredientKey);
      if (!p.ticked) return put(state, "ticks", id, null);
      const prev = state.ticks[id];
      const tick: Tick = {
        mealId: p.mealId,
        ingredient: p.ingredient,
        ingredientKey: p.ingredientKey,
        ...(prev ? { createdAt: prev.createdAt, createdBy: prev.createdBy, ...stamp(event) } : created(event)),
      };
      return put(state, "ticks", id, tick);
    }
    case KITCHEN_EVENT.reviewQueued: {
      const p = event.payload as ReviewQueuedPayload;
      const review: Review = {
        id: p.reviewId,
        kind: p.kind,
        mealId: p.mealId,
        items: p.items,
        status: "pending",
        ...created(event),
      };
      return put(state, "reviews", review.id, review);
    }
    case KITCHEN_EVENT.reviewResolved: {
      const p = event.payload as ReviewResolvedPayload;
      const prev = state.reviews[p.reviewId];
      if (!prev) return state;
      return put(state, "reviews", prev.id, { ...prev, status: p.outcome, ...stamp(event) });
    }
    case KITCHEN_EVENT.shoppingAdded: {
      const p = event.payload as ShoppingAddedPayload;
      const entry: ShoppingItem = {
        id: p.shoppingItemId,
        name: p.name,
        standardName: p.standardName,
        quantity: p.quantity,
        store: p.store,
        source: p.source,
        position: p.position,
        status: "open",
        ...created(event),
      };
      return put(state, "shopping", entry.id, entry);
    }
    case KITCHEN_EVENT.shoppingUpdated: {
      const p = event.payload as ShoppingUpdatedPayload;
      const prev = state.shopping[p.shoppingItemId];
      if (!prev) return state;
      const next: ShoppingItem = { ...prev, ...compact(p.set), ...stamp(event) };
      for (const field of p.clear) delete next[field];
      return put(state, "shopping", next.id, next);
    }
    case KITCHEN_EVENT.shoppingTicked: {
      const p = event.payload as ShoppingTickedPayload;
      const prev = state.shopping[p.shoppingItemId];
      if (!prev) return state;
      const next: ShoppingItem = { ...prev, ...stamp(event) };
      if (p.ticked) {
        next.tickedAt = event.recordedAt;
        next.tickedBy = event.actor;
      } else {
        delete next.tickedAt;
        delete next.tickedBy;
      }
      return put(state, "shopping", next.id, next);
    }
    case KITCHEN_EVENT.shoppingRemoved: {
      const p = event.payload as ShoppingRemovedPayload;
      const prev = state.shopping[p.shoppingItemId];
      if (!prev) return state;
      return put(state, "shopping", prev.id, { ...prev, status: "removed", ...stamp(event) });
    }
    case KITCHEN_EVENT.shoppingMoved: {
      const p = event.payload as ShoppingMovedPayload;
      const prev = state.shopping[p.shoppingItemId];
      if (!prev) return state;
      return put(state, "shopping", prev.id, { ...prev, status: "moved", movedToItemId: p.itemId, ...stamp(event) });
    }
    case CHANGESET_REVERTED: {
      const p = event.payload as ChangesetRevertedPayload<KitchenEntity>;
      let next = state;
      for (const [key, value] of Object.entries(p.restore)) {
        const { kind, id } = splitEntityKey(key);
        const coll = COLLECTION[kind as keyof typeof COLLECTION];
        if (!coll) continue;
        // Restored rows read "updated by <whoever undid it>, just now".
        next = put(next, coll, id, value ? ({ ...value, ...stamp(event) } as never) : null);
      }
      return next;
    }
    default:
      return state;
  }
}

/** Replay a kitchen stream from scratch. */
export function replay(events: EventEnvelope[], initial: KitchenEntities = emptyKitchen()): KitchenEntities {
  return events.reduce(apply, initial);
}
