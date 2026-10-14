/**
 * The Kitchen domain's interface for OTHER domains (backend-data.md §5). A future assistant
 * (e.g. Fitness) reads Kitchen only through this file, never through its tables or prompts.
 * The UI and AI code use `commands` and `queries` instead.
 */
import type { Queryable } from "@/db/client";
import type { KitchenScope } from "@/shared/membership";
import { readKitchenState } from "./queries";

export interface KitchenSummary {
  kitchenId: string;
  version: number;
  /** Names of the items currently in the kitchen. */
  itemNames: string[];
  /** Titles in the meal plan, in order. */
  planTitles: string[];
}

export async function getSummary(db: Queryable, scope: KitchenScope): Promise<KitchenSummary> {
  const state = await readKitchenState(db, scope.kitchenId);
  const titles = new Map(state.meals.map((m) => [m.id, m.title]));
  return {
    kitchenId: state.kitchenId,
    version: state.version,
    itemNames: state.items.map((i) => i.name.value),
    planTitles: state.plan.map((id) => titles.get(id) ?? ""),
  };
}
