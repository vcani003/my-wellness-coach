/**
 * The Kitchen domain's interface for OTHER domains (backend-data.md §5). A future assistant
 * (e.g. Fitness) reads Kitchen only through this file, never through its tables or prompts.
 * The UI and AI code use `commands` and `queries` instead.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { changeSets, itemBatches } from "@/db/schema";
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

/**
 * Of these change sets, the ones the person in `scope` could still undo: their own, saved, not
 * an undo, and not undone since. Used to redraw saved chat receipts (P2 a). A later change to
 * the same items can still block the Undo when it's tapped (`UNDO_CONFLICT`).
 */
export async function getStillUndoable(db: Queryable, scope: KitchenScope, changeSetIds: string[]): Promise<Set<string>> {
  if (changeSetIds.length === 0) return new Set();
  const rows = await db
    .select({ id: changeSets.id })
    .from(changeSets)
    .where(
      and(
        eq(changeSets.kitchenId, scope.kitchenId),
        eq(changeSets.actorId, scope.userId),
        inArray(changeSets.id, changeSetIds),
        isNotNull(changeSets.version),
        isNull(changeSets.revertsChangeSetId),
        isNull(changeSets.revertedByChangeSetId),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Of these batch IDs, the ones still open that nobody has answered "Still have them" for (0025).
 * Used to redraw a saved chat receipt's batch choice only while it still needs asking.
 */
export async function getUnansweredBatchIds(db: Queryable, scope: KitchenScope, batchIds: string[]): Promise<Set<string>> {
  if (batchIds.length === 0) return new Set();
  const rows = await db
    .select({ id: itemBatches.id })
    .from(itemBatches)
    .where(
      and(
        eq(itemBatches.kitchenId, scope.kitchenId),
        inArray(itemBatches.id, batchIds),
        isNull(itemBatches.closedAt),
        isNull(itemBatches.keptAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
