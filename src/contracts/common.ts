/**
 * Shared building blocks for the contract (backend-data.md §6).
 * Imported by the AI, UI and domain code; keep it free of server-only imports.
 */
import { z } from "zod";

export const Id = z.string().min(1).max(200);

/** Where a fact came from: the user said it, the AI concluded it, or it's an assumed basic (0010). */
export const Basis = z.enum(["said", "inferred", "assumed"]);
export type Basis = z.infer<typeof Basis>;

/** Buckets are more consistent from the AI than percentages. */
export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

/**
 * `Fact<T> = { value, basis, confidence }`.
 * A field that is absent (or null, if the model's schema needs every key) means unknown.
 */
export function fact<T extends z.ZodType>(value: T) {
  return z.object({ value, basis: Basis, confidence: Confidence });
}
export type Fact<T> = { value: T; basis: Basis; confidence: Confidence };

/** Optional fact: absent or null both mean "unknown" (never a made-up default, 0011). */
export function optionalFact<T extends z.ZodType>(value: T) {
  return fact(value).nullish();
}

/** Translatable system text: `code` + `params`; `text` is the English fallback (0015). */
export const Msg = z.object({
  code: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  text: z.string(),
});
export type Msg = z.infer<typeof Msg>;

/** "2 lbs" stays as said; numbers only when obvious (0015). */
export const Quantity = z.object({
  asSaid: z.string().min(1),
  amount: z.number().finite().nonnegative().optional(),
  unit: z.string().min(1).optional(),
});
export type Quantity = z.infer<typeof Quantity>;

export const Location = z.enum(["fridge", "freezer", "pantry"]);
export type Location = z.infer<typeof Location>;

export const StockLevel = z.enum(["low", "out"]);
export type StockLevel = z.infer<typeof StockLevel>;

/**
 * Which of an item's open batches (0025): the oldest (used first by default) or the newest
 * ("the new eggs"). An exact `batchId` can be given instead.
 */
export const BatchWhich = z.enum(["oldest", "newest"]);
export type BatchWhich = z.infer<typeof BatchWhich>;

/** Most open batches an item holds; adding one more closes the oldest (0025). */
export const MAX_OPEN_BATCHES = 3;

/** Meal lifecycle statuses (0013). Allowed moves live in one transitions table in the kitchen domain. */
export const MealStatus = z.enum(["chosen", "planned", "cooking", "done", "cancelled"]);
export type MealStatus = z.infer<typeof MealStatus>;

export const RestrictionKind = z.enum(["allergy", "diet"]);
export type RestrictionKind = z.infer<typeof RestrictionKind>;

export const ReviewKind = z.enum(["add-to-kitchen", "after-cooking"]);
export type ReviewKind = z.infer<typeof ReviewKind>;

/** Where a To review card came from: a meal's sheet, or the shopping list's "Done shopping" sheet (0027). */
export const ReviewOrigin = z.enum(["meal", "shopping-list"]);
export type ReviewOrigin = z.infer<typeof ReviewOrigin>;

/**
 * How a shopping-list item got on the list (0027): said in chat, a staples answer, a recipe's
 * "Need" items, or the "Add to shopping list" offer after marking something Out or Low (SL3).
 */
export const ShoppingSource = z.enum(["chat", "staples", "recipe", "stock-offer"]);
export type ShoppingSource = z.infer<typeof ShoppingSource>;

/** Computed by code from current profiles on every read; never stored. */
export const AllergenFlag = z.object({
  ingredient: z.string(),
  userId: Id,
  subject: z.string(),
  note: z.string().optional(),
});
export type AllergenFlag = z.infer<typeof AllergenFlag>;

/**
 * A reference that may point at a row that no longer exists (0018).
 * Missing rows come back as `{ id, missing: true }`; the UI shows its fallback.
 */
export const MissingRef = z.object({ id: Id, missing: z.literal(true) });
export type MissingRef = z.infer<typeof MissingRef>;

/**
 * Who did something. An unknown person comes back as a MissingRef ("Someone"); someone who
 * deleted their data (D1, 0015) as `{ id, missing: true, former: true }`, shown as "a former member".
 */
export const FormerMemberRef = z.object({ id: Id, missing: z.literal(true), former: z.literal(true) });
export type FormerMemberRef = z.infer<typeof FormerMemberRef>;
export const ActorRef = z.union([z.object({ id: Id, name: z.string() }), FormerMemberRef, MissingRef]);
export type ActorRef = z.infer<typeof ActorRef>;

export const MealRef = z.union([z.object({ id: Id, title: z.string() }), MissingRef]);
export type MealRef = z.infer<typeof MealRef>;

export const ItemRef = z.union([z.object({ id: Id, name: z.string() }), MissingRef]);
export type ItemRef = z.infer<typeof ItemRef>;

/** Every current-state row carries these (backend-data.md §4). ISO 8601 timestamps. */
export const Audit = {
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: ActorRef,
  updatedAt: z.iso.datetime({ offset: true }),
  updatedBy: ActorRef,
};
