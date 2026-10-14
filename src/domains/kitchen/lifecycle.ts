/**
 * The meal lifecycle (0013) as ONE transitions table. Changing the lifecycle is an edit here,
 * with no migration: statuses are stored as plain text and old events stay valid.
 *
 *   idea → chosen → (planned) → cooking → done
 *                          ↘──────────↘─────→ cancelled
 */
import type { MealStatus } from "@/contracts/common";

export const MEAL_TRANSITIONS: Readonly<Record<MealStatus, readonly MealStatus[]>> = {
  chosen: ["planned", "cooking", "cancelled"],
  planned: ["cooking", "cancelled"],
  // Several meals can be cooking at once (0013).
  cooking: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export function canTransition(from: MealStatus, to: MealStatus): boolean {
  return MEAL_TRANSITIONS[from].includes(to);
}

/** Statuses shown in the Meal plan list (cooking first, then planned). */
export const PLAN_STATUSES: readonly MealStatus[] = ["cooking", "planned"];
/** Statuses that are still "live" (in KitchenState.meals). */
export const ACTIVE_STATUSES: readonly MealStatus[] = ["chosen", "planned", "cooking"];
