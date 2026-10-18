/** Fake meal actions (MealsContext) for UI tests: every server call is a spy that refuses unless stubbed. */
import { vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import type { MealActions } from "@/ui/widgets/meals/MealsContext";

export function fakeMealActions(overrides: Partial<MealActions> = {}): MealActions {
  const refused = async (): Promise<ActionResult> => ({ ok: false, reason: { code: "SAVE_FAILED", params: {}, text: "x" }, retryable: true });
  return {
    choose: vi.fn(async () => true),
    retryRecipe: vi.fn(async () => true),
    addToPlan: vi.fn(refused),
    setMealDate: vi.fn(refused),
    loadWeekNeeds: vi.fn(async () => null),
    addWeekNeedsToList: vi.fn(refused),
    startCooking: vi.fn(refused),
    cancel: vi.fn(refused),
    finishCooking: vi.fn(async () => ({ ok: false as const, reason: { code: "SAVE_FAILED", params: {}, text: "x" }, retryable: true })),
    submitUpdateKitchen: vi.fn(refused),
    updateKitchenLater: vi.fn(refused),
    skipUpdateKitchen: vi.fn(refused),
    tick: vi.fn(refused),
    addNeedsToList: vi.fn(refused),
    openRecipe: vi.fn(),
    closeRecipe: vi.fn(),
    useOwnRecipe: vi.fn(),
    showSaved: vi.fn(),
    ...overrides,
  };
}
