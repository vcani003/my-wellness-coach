/**
 * "Cooked before" (0040 A1, RB1–RB5, RB9): the kitchen's Done meals, one row per dish.
 * Read with `GET /api/kitchens/:id/past-meals?q=&limit=` (backend-data.md §6).
 */
import { z } from "zod";
import { ActorRef, AllergenFlag, Id } from "./common";
import { MealNote, RecipeSummary } from "./kitchen-state";

const isoDate = z.iso.datetime({ offset: true });

/**
 * One dish (RB3): every Done meal whose title folds to the same text (case and accents ignored)
 * is one row, "made 2×, last 15 Oct". `mealId` is the latest cook, the one to open
 * (`getRecipe(mealId)` gives its cooked recipe) and to "Make again" from.
 */
export const PastMeal = z.object({
  /** The latest cook of this dish. */
  mealId: Id,
  /** The latest cook's title, as said. */
  title: z.string(),
  timesCooked: z.number().int().positive(),
  lastCookedAt: isoDate,
  /** Who marked the latest cook Done (RB5: household members see each other's). */
  lastCookedBy: ActorRef,
  /** The latest cook's cooked recipe version; absent when it was cooked without a recipe. */
  recipe: RecipeSummary.optional(),
  /**
   * Over the title and the latest cook's ingredients, from **today's** allergies (RB8, 0019):
   * an old recipe that now clashes is listed, and flagged.
   */
  allergenFlags: z.array(AllergenFlag),
  /** The latest cook's after-cooking note and who wrote it (RBX3). */
  note: MealNote.optional(),
  /**
   * RBX1: a "made again" copy of this dish that's still chosen, planned or cooking. Show "Open in
   * your plan" (this meal) instead of Make again, which would be refused with `ALREADY_MAKING`.
   */
  activeCopyMealId: Id.optional(),
});
export type PastMeal = z.infer<typeof PastMeal>;

/** `GET /api/kitchens/:id/past-meals` body: newest first. */
export const PastMealsPage = z.object({ meals: z.array(PastMeal) });
export type PastMealsPage = z.infer<typeof PastMealsPage>;

export const PAST_MEALS_DEFAULT_LIMIT = 20;
export const PAST_MEALS_MAX_LIMIT = 100;
