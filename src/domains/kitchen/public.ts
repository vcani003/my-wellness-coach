/**
 * The Kitchen domain's interface for OTHER domains (backend-data.md §5). A future assistant
 * (e.g. Fitness) reads Kitchen only through this file, never through its tables or prompts.
 * The UI and AI code use `commands` and `queries` instead.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { changeSets, itemBatches } from "@/db/schema";
import type { ActorRef } from "@/contracts/common";
import { actorRef, loadNames } from "@/shared/identity";
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

/** How a saved receipt's change set stands now (P2 a): computed on every read, never stored. */
export interface UndoStatus {
  /** The person in `scope` could still undo it: their own, saved, not an undo, not undone since. */
  undoable: boolean;
  /**
   * Set once anyone has undone it: who and when (from the undo's own change set). `by`/`at` are
   * left out only if that undo can't be found; it still counts as undone.
   */
  undone: { by?: ActorRef; at?: string } | null;
}

/**
 * The undo status of each of these change sets, by ID. Used to redraw saved chat receipts, so an
 * undone one reads as undone after a reload. IDs from another kitchen are simply absent. A later
 * change to the same items can still block the Undo when it's tapped (`UNDO_CONFLICT`).
 */
export async function getUndoStatus(
  db: Queryable,
  scope: KitchenScope,
  changeSetIds: string[],
): Promise<Map<string, UndoStatus>> {
  const out = new Map<string, UndoStatus>();
  if (changeSetIds.length === 0) return out;
  const rows = await db
    .select({
      id: changeSets.id,
      actorId: changeSets.actorId,
      version: changeSets.version,
      revertsChangeSetId: changeSets.revertsChangeSetId,
      revertedByChangeSetId: changeSets.revertedByChangeSetId,
    })
    .from(changeSets)
    .where(and(eq(changeSets.kitchenId, scope.kitchenId), inArray(changeSets.id, [...new Set(changeSetIds)])));
  const undoIds = rows.flatMap((r) => (r.revertedByChangeSetId ? [r.revertedByChangeSetId] : []));
  const undos = undoIds.length
    ? await db
        .select({ id: changeSets.id, actorId: changeSets.actorId, createdAt: changeSets.createdAt })
        .from(changeSets)
        .where(and(eq(changeSets.kitchenId, scope.kitchenId), inArray(changeSets.id, undoIds)))
    : [];
  const undoById = new Map(undos.map((u) => [u.id, u]));
  const names = await loadNames(
    db,
    undos.map((u) => u.actorId),
  );
  for (const r of rows) {
    const undo = r.revertedByChangeSetId ? undoById.get(r.revertedByChangeSetId) : undefined;
    const undone = r.revertedByChangeSetId !== null;
    out.set(r.id, {
      undoable: r.actorId === scope.userId && r.version !== null && r.revertsChangeSetId === null && !undone,
      // An undo row we can't find still counts as undone; it just can't say who (0018).
      undone: undone ? (undo ? { by: actorRef(undo.actorId, names), at: undo.createdAt.toISOString() } : {}) : null,
    });
  }
  return out;
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
