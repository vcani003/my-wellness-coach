/**
 * KitchenState and its rows (backend-data.md §6). Every row has createdAt/By, updatedAt/By.
 * Rows are checked against these schemas on the way out; a row that fails is left out and logged (0018).
 */
import { z } from "zod";
import {
  AllergenFlag,
  Audit,
  Id,
  Location,
  MealRef,
  MealStatus,
  Quantity,
  ReviewKind,
  StockLevel,
  fact,
  ItemRef,
} from "./common";
import { ReviewEntry } from "./operations";

const isoDate = z.iso.datetime({ offset: true });

export const ItemRow = z.object({
  id: Id,
  name: fact(z.string()),
  /** Internal standard name used for matching (0015). */
  standardName: z.string(),
  quantity: fact(Quantity).optional(),
  /** Absent = "Not sure where". */
  location: fact(Location).optional(),
  frozen: fact(z.boolean()).optional(),
  opened: fact(z.boolean()).optional(),
  /** `low` = "Running low". `out` items are not in KitchenState.items (history keeps them). */
  stock: fact(StockLevel).optional(),
  /** For "added X days ago": when the user said it happened, else when it was recorded. */
  addedAt: isoDate,
  lastUsedAt: isoDate.optional(),
  ...Audit,
});
export type ItemRow = z.infer<typeof ItemRow>;

export const RecipeSummary = z.object({ id: Id, version: z.number().int(), source: z.enum(["user", "ai"]) });

export const MealRow = z.object({
  id: Id,
  title: z.string(),
  status: MealStatus,
  ideaId: Id.optional(),
  /** Position in the plan; set while planned or cooking. */
  planPosition: z.number().int().optional(),
  chosenAt: isoDate,
  recipe: RecipeSummary.optional(),
  /** After-cooking note, stored as said (0013). */
  note: z.string().optional(),
  cookedAt: isoDate.optional(),
  allergenFlags: z.array(AllergenFlag),
  ...Audit,
});
export type MealRow = z.infer<typeof MealRow>;

export const TickRow = z.object({
  meal: MealRef,
  ingredient: z.string(),
  ...Audit,
});
export type TickRow = z.infer<typeof TickRow>;

export const ReviewRow = z.object({
  id: Id,
  kind: ReviewKind,
  meal: MealRef,
  items: z.array(ReviewEntry),
  status: z.enum(["pending", "done", "skipped"]),
  ...Audit,
});
export type ReviewRow = z.infer<typeof ReviewRow>;

export const KitchenState = z.object({
  kitchenId: Id,
  version: z.number().int().nonnegative(),
  /** Current items: everything except `stock: out`. */
  items: z.array(ItemRow),
  /** Meals that are chosen, planned or cooking (done/cancelled stay in history). */
  meals: z.array(MealRow),
  /** Meal IDs in plan order: cooking first, then planned (0013). */
  plan: z.array(Id),
  /** Ticked ingredients, shared by the kitchen (0013, M6). */
  ticks: z.array(TickRow),
  /** Pending To review cards. */
  toReview: z.array(ReviewRow),
});
export type KitchenState = z.infer<typeof KitchenState>;

export const RecipeView = z.object({
  id: Id,
  meal: MealRef,
  version: z.number().int(),
  source: z.enum(["user", "ai"]),
  text: z.string(),
  ingredients: z.array(
    z.object({ name: z.string(), basic: z.boolean().optional(), item: ItemRef.optional() }),
  ),
  steps: z.array(z.string()),
  basicsAssumed: z.array(z.string()),
  allergenFlags: z.array(AllergenFlag),
  ...Audit,
});
export type RecipeView = z.infer<typeof RecipeView>;
