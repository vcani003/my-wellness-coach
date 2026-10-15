/**
 * Kitchen state and the pure `apply(state, event)` (backend-data.md §3).
 * All kitchen state logic lives here. Undo, or a fix to this logic, rebuilds a kitchen by
 * replaying its events; projections are just this state written to tables.
 */
import type { Fact, ItemCategory, Location, MealStatus, Quantity, ReviewKind, ReviewOrigin, ShoppingSource, StockLevel } from "@/contracts/common";
import type { RecipeIngredient, ReviewEntry } from "@/contracts/operations";
import {
  CHANGESET_REVERTED,
  compact,
  splitEntityKey,
  type AuditFields,
  type ChangesetRevertedPayload,
  type EventEnvelope,
} from "@/shared/events/types";
import {
  addBatch,
  compactBatch,
  deriveItem,
  ensureBatches,
  openBatches,
  withBatch,
  type Batch,
  type BatchCloseReason,
  type BatchFacts,
} from "./batches";

export type { Batch } from "./batches";

// ─── Entities ─────────────────────────────────────────────────────────────────────────

/**
 * A kitchen item: one row on the Kitchen list. Its batches (0025) are the source of truth for
 * quantity, location, frozen, opened, stock and age; the item's own copies of those fields are
 * derived from them (`deriveItem`) and kept for older readers (0028).
 */
export interface Item extends AuditFields {
  id: string;
  name: Fact<string>;
  standardName: string;
  /**
   * What kind of thing it is (CAT1). Item-level, not per batch. Absent = saved before categories:
   * readers use `effectiveCategory` (the remembered choice or the keyword guess), never stored.
   */
  category?: Fact<ItemCategory>;
  /** Every batch, open and closed, in the order added. */
  batches: Batch[];
  /** Derived: the most recent "defrosted on" among the open batches. */
  defrostedOn?: Fact<string>;
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
  /** Who marked it Done (0040 RB5). Absent on rows from before migration 0011: read `updatedBy`. */
  cookedBy?: string;
  /** Who wrote `note` (0040 RBX3). Absent on rows from before migration 0011: read as the cook. */
  noteBy?: string;
  /** "Make again" (0040 C): the Done meal this one repeats. */
  madeAgainFromMealId?: string;
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
  /** "Make again" (0040 C): the cooked version this was copied from. */
  copiedFromRecipeId?: string;
}

export interface Tick extends AuditFields {
  mealId: string;
  ingredient: string;
  ingredientKey: string;
}

export interface Review extends AuditFields {
  id: string;
  kind: ReviewKind;
  origin: ReviewOrigin;
  /** Set for a meal's card; absent for a shopping-list one. */
  mealId?: string;
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

/**
 * A category the user said for a name (CAT1: "fish sauce goes under sauces"), remembered per
 * kitchen so future adds of that standard name default to it.
 */
export interface CategoryPref extends AuditFields {
  standardName: string;
  category: ItemCategory;
}

/**
 * A place the user said for a name (0041: "onions go in the pantry", or moving an item), remembered
 * per kitchen so future adds of that standard name go there. Mirrors `CategoryPref` (0032).
 */
export interface LocationPref extends AuditFields {
  standardName: string;
  location: Location;
}

export interface KitchenEntities {
  items: Record<string, Item>;
  meals: Record<string, Meal>;
  recipes: Record<string, Recipe>;
  /** Keyed by `${mealId}|${ingredientKey}`; present only while ticked. */
  ticks: Record<string, Tick>;
  reviews: Record<string, Review>;
  shopping: Record<string, ShoppingItem>;
  /** Keyed by standard name (CAT1). */
  categoryPrefs: Record<string, CategoryPref>;
  /** Keyed by standard name (0041). */
  locationPrefs: Record<string, LocationPref>;
}

export type KitchenEntity = Item | Meal | Recipe | Tick | Review | ShoppingItem | CategoryPref | LocationPref;

export const emptyKitchen = (): KitchenEntities => ({
  items: {},
  meals: {},
  recipes: {},
  ticks: {},
  reviews: {},
  shopping: {},
  categoryPrefs: {},
  locationPrefs: {},
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
  reviewUpdated: "review.updated",
  reviewResolved: "review.resolved",
  shoppingAdded: "shopping.added",
  shoppingUpdated: "shopping.updated",
  shoppingTicked: "shopping.ticked",
  shoppingRemoved: "shopping.removed",
  shoppingMoved: "shopping.moved",
  batchAdded: "item.batch.added",
  batchClosed: "item.batch.closed",
  batchKept: "item.batch.kept",
  batchDefrosted: "item.batch.defrosted",
  categoryRemembered: "item.category.remembered",
  locationRemembered: "item.location.remembered",
} as const;

type ItemFactFields = Pick<Item, "quantity" | "location" | "frozen" | "opened" | "occurredAt">;

export interface ItemAddedPayload extends ItemFactFields {
  itemId: string;
  name: Fact<string>;
  standardName: string;
  /** CAT1. Absent on events from before categories (read as the keyword guess). */
  category?: Fact<ItemCategory>;
  /** Its first batch. Absent (events from before batches) = the item's own ID. */
  batchId?: string;
}
export interface ItemUpdatedPayload {
  itemId: string;
  /** The batch the facts apply to. Absent (older events): the oldest open batch. */
  batchId?: string;
  /** `name`, `standardName` and `category` apply to the item; the rest to the batch. */
  set: Partial<ItemFactFields & { name: Fact<string>; standardName: string; category: Fact<ItemCategory> }>;
  /** Fields set back to unknown. `stock` is cleared when an item is added again. */
  clear: (keyof ItemFactFields | "stock")[];
}
export interface ItemUsedPayload {
  itemId: string;
  /**
   * The batch used. Absent (older events): `stock` applies to every open batch and the
   * quantity to the oldest.
   */
  batchId?: string;
  stock?: Fact<StockLevel>;
  amountUsed?: Fact<Quantity>;
  /** undefined = quantity unchanged; null = now unknown; else the computed remainder. */
  quantityAfter?: Fact<Quantity> | null;
  /** Set when recorded by finishing a meal (0013): used in this meal, amount unknown. */
  mealId?: string;
}
/** Buying something already in the kitchen adds a batch (0025). */
export interface BatchAddedPayload extends BatchFacts {
  itemId: string;
  batchId: string;
}
export interface BatchClosedPayload {
  itemId: string;
  batchId: string;
  /** `gone` = "Those are gone"; `replaced` = a 4th batch closed the oldest (0025). */
  reason: Exclude<BatchCloseReason, "used-up">;
}
/** "Still have them" (0025). */
export interface BatchKeptPayload {
  itemId: string;
  batchId: string;
}
export interface BatchDefrostedPayload {
  itemId: string;
  batchId: string;
  defrostedOn: Fact<string>;
  frozen: Fact<boolean>;
  /** Where it is after defrosting (DF1 Rec). Absent on older events, which leave the place as it was. */
  location?: Fact<Location>;
}
/** A category the user said, remembered for this standard name (CAT1). Its own event, so Undo restores it. */
export interface CategoryRememberedPayload {
  standardName: string;
  category: ItemCategory;
}
/** A place the user said, remembered for this standard name (0041). Its own event, so Undo restores it. */
export interface LocationRememberedPayload {
  standardName: string;
  location: Location;
}
export interface ItemRemovedPayload {
  itemId: string;
  reason?: Fact<string>;
}
export interface MealChosenPayload {
  mealId: string;
  title: string;
  ideaId?: string;
  /** A dish named in chat (MI1): the user's own words about it. History only, not projected. */
  notes?: string;
  /** false when an existing meal is chosen again (it becomes the most recently chosen). */
  isNew: boolean;
  /** "Make again" (0040 C): the Done meal this one repeats (`Meal.madeAgainFromMealId`). */
  fromMealId?: string;
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
  /** "Make again" (0040 C): the cooked version this was copied from. */
  copiedFromRecipeId?: string;
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
  /** Absent = "meal" (every event before the shopping-list card). */
  origin?: "shopping-list";
  mealId?: string;
  items: ReviewEntry[];
}
/** The shopping-list card's entries after "Do later" again: the new list replaces the old (0027). */
export interface ReviewUpdatedPayload {
  reviewId: string;
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
    case KITCHEN_EVENT.batchAdded:
    case KITCHEN_EVENT.batchClosed:
    case KITCHEN_EVENT.batchKept:
    case KITCHEN_EVENT.batchDefrosted:
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
    case KITCHEN_EVENT.reviewUpdated:
    case KITCHEN_EVENT.reviewResolved:
      return [`review:${p.reviewId as string}`];
    case KITCHEN_EVENT.shoppingAdded:
    case KITCHEN_EVENT.shoppingUpdated:
    case KITCHEN_EVENT.shoppingTicked:
    case KITCHEN_EVENT.shoppingRemoved:
    case KITCHEN_EVENT.shoppingMoved:
      return [`shopping:${p.shoppingItemId as string}`];
    case KITCHEN_EVENT.categoryRemembered:
      return [`catpref:${p.standardName as string}`];
    case KITCHEN_EVENT.locationRemembered:
      return [`locpref:${p.standardName as string}`];
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
  catpref: "categoryPrefs",
  locpref: "locationPrefs",
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
      const addedAt = p.occurredAt ? toIso(p.occurredAt.value) : event.recordedAt;
      const batch: Batch = compactBatch({
        id: p.batchId ?? p.itemId,
        addedAt,
        occurredAt: p.occurredAt,
        quantity: p.quantity,
        location: p.location,
        frozen: p.frozen,
        opened: p.opened,
        ...created(event),
      });
      const item = deriveItem({
        id: p.itemId,
        name: p.name,
        standardName: p.standardName,
        ...(p.category ? { category: p.category } : {}),
        addedAt,
        batches: [batch],
        ...created(event),
      });
      return put(state, "items", item.id, item);
    }
    case KITCHEN_EVENT.itemUpdated: {
      const p = event.payload as ItemUpdatedPayload;
      const found = state.items[p.itemId];
      if (!found) return state;
      const { name, standardName, category, ...facts } = p.set;
      let next: Item = {
        ...ensureBatches(found),
        ...(name ? { name } : {}),
        ...(standardName ? { standardName } : {}),
        ...(category ? { category } : {}),
        ...stamp(event),
      };
      const clear = p.clear.filter((f) => f !== "stock");
      // Older events: "added again" cleared `stock`, reopening an Out item (before batches).
      if (p.clear.includes("stock")) {
        const open = openBatches(next);
        const reopen = open.length ? open : [...next.batches].sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? "")).slice(-1);
        for (const b of reopen) {
          const { stock: _s, closedAt: _c, closedReason: _r, ...rest } = b;
          void [_s, _c, _r];
          next = withBatch(next, { ...rest, ...stamp(event) });
        }
      }
      if (Object.keys(compact(facts)).length > 0 || clear.length > 0) {
        const target = (p.batchId ? next.batches.find((b) => b.id === p.batchId) : undefined) ?? openBatches(next)[0] ?? next.batches.at(-1);
        if (target) {
          const b: Batch = { ...target, ...compact(facts), ...stamp(event) };
          for (const field of clear) delete b[field];
          if (facts.occurredAt) b.addedAt = toIso(facts.occurredAt.value);
          next = withBatch(next, b);
        }
      }
      return put(state, "items", next.id, deriveItem(next));
    }
    case KITCHEN_EVENT.itemUsed: {
      const p = event.payload as ItemUsedPayload;
      const found = state.items[p.itemId];
      if (!found) return state;
      let next: Item = { ...ensureBatches(found), ...stamp(event) };
      const open = openBatches(next);
      const one = p.batchId ? next.batches.find((b) => b.id === p.batchId) : open[0];
      const stockTargets = p.batchId ? (one ? [one] : []) : open;
      if (one) {
        const b: Batch = { ...one, lastUsedAt: event.recordedAt, ...stamp(event) };
        if (p.quantityAfter === null) delete b.quantity;
        else if (p.quantityAfter) b.quantity = p.quantityAfter;
        next = withBatch(next, b);
      }
      if (p.stock) {
        for (const t of stockTargets) {
          const b: Batch = { ...next.batches.find((x) => x.id === t.id)!, stock: p.stock, ...stamp(event) };
          if (p.stock.value === "out") {
            b.closedAt = event.recordedAt;
            b.closedReason = "used-up";
          }
          next = withBatch(next, b);
        }
      }
      return put(state, "items", next.id, deriveItem(next));
    }
    case KITCHEN_EVENT.batchAdded: {
      const p = event.payload as BatchAddedPayload;
      const found = state.items[p.itemId];
      if (!found) return state;
      const batch: Batch = compactBatch({
        id: p.batchId,
        addedAt: p.occurredAt ? toIso(p.occurredAt.value) : event.recordedAt,
        occurredAt: p.occurredAt,
        quantity: p.quantity,
        location: p.location,
        frozen: p.frozen,
        opened: p.opened,
        ...created(event),
      });
      return put(state, "items", p.itemId, addBatch({ ...ensureBatches(found), ...stamp(event) }, batch));
    }
    case KITCHEN_EVENT.batchClosed:
    case KITCHEN_EVENT.batchKept:
    case KITCHEN_EVENT.batchDefrosted: {
      const p = event.payload as BatchClosedPayload & Partial<BatchDefrostedPayload>;
      const found = state.items[p.itemId];
      if (!found) return state;
      const item = { ...ensureBatches(found), ...stamp(event) };
      const prev = item.batches.find((b) => b.id === p.batchId);
      if (!prev) return state;
      const b: Batch = { ...prev, ...stamp(event) };
      if (event.type === KITCHEN_EVENT.batchClosed) {
        b.closedAt = event.recordedAt;
        b.closedReason = p.reason;
      } else if (event.type === KITCHEN_EVENT.batchKept) {
        b.keptAt = event.recordedAt;
      } else {
        b.defrostedOn = p.defrostedOn;
        if (p.frozen) b.frozen = p.frozen;
        if (p.location) b.location = p.location;
      }
      return put(state, "items", item.id, withBatch(item, b));
    }
    case KITCHEN_EVENT.categoryRemembered: {
      const p = event.payload as CategoryRememberedPayload;
      const prev = state.categoryPrefs[p.standardName];
      const pref: CategoryPref = {
        standardName: p.standardName,
        category: p.category,
        ...(prev ? { createdAt: prev.createdAt, createdBy: prev.createdBy, ...stamp(event) } : created(event)),
      };
      return put(state, "categoryPrefs", p.standardName, pref);
    }
    case KITCHEN_EVENT.locationRemembered: {
      const p = event.payload as LocationRememberedPayload;
      const prev = state.locationPrefs?.[p.standardName];
      const pref: LocationPref = {
        standardName: p.standardName,
        location: p.location,
        ...(prev ? { createdAt: prev.createdAt, createdBy: prev.createdBy, ...stamp(event) } : created(event)),
      };
      return put(state, "locationPrefs", p.standardName, pref);
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
        ...(p.fromMealId ? { madeAgainFromMealId: p.fromMealId } : {}),
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
      if (p.to === "done") {
        next.cookedAt = event.occurredAt ?? event.recordedAt;
        next.cookedBy = event.actor;
      }
      if (p.note !== undefined) {
        next.note = p.note;
        next.noteBy = event.actor;
      }
      return put(state, "meals", next.id, next);
    }
    case KITCHEN_EVENT.mealNoted: {
      const p = event.payload as MealNotedPayload;
      const prev = state.meals[p.mealId];
      if (!prev) return state;
      return put(state, "meals", prev.id, { ...prev, note: p.note, noteBy: event.actor, ...stamp(event) });
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
        ...(p.copiedFromRecipeId ? { copiedFromRecipeId: p.copiedFromRecipeId } : {}),
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
        origin: p.origin ?? "meal",
        mealId: p.mealId,
        items: p.items,
        status: "pending",
        ...created(event),
      };
      return put(state, "reviews", review.id, review);
    }
    case KITCHEN_EVENT.reviewUpdated: {
      const p = event.payload as ReviewUpdatedPayload;
      const prev = state.reviews[p.reviewId];
      if (!prev) return state;
      return put(state, "reviews", prev.id, { ...prev, items: p.items, ...stamp(event) });
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
        // Restored rows read "updated by <whoever undid it>, just now". An item saved before
        // batches gets its one legacy batch (0025).
        const restored = value && coll === "items" ? ensureBatches(value as Item) : value;
        next = put(next, coll, id, restored ? ({ ...restored, ...stamp(event) } as never) : null);
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
