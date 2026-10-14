/** Fake button actions (KitchenActionsContext) for UI tests: every call is a spy you can stub. */
import { vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import type { ApplyResult } from "@/contracts/apply-result";
import type { KitchenState } from "@/contracts/kitchen-state";
import type { KitchenActions } from "@/ui/sync/KitchenActionsContext";

let n = 0;
/** A saved result with one applied operation and the given state. */
export function saved(state: KitchenState, code = "NO_CHANGE"): ActionResult {
  const result: ApplyResult = {
    changeSetId: `cs-${++n}`,
    newVersion: state.version,
    undoable: true,
    applied: [{ opId: "op", summary: { code, params: {}, text: code }, refs: [] }],
    rejected: [],
    state,
  };
  return { ok: true, result };
}

export function fakeActions(overrides: Partial<KitchenActions> = {}): KitchenActions {
  const refused = async (): Promise<ActionResult> => ({ ok: false, reason: { code: "SAVE_FAILED", params: {}, text: "x" }, retryable: true });
  return {
    kitchenId: "k1",
    tickShopping: vi.fn(refused),
    removeShopping: vi.fn(refused),
    finishShopping: vi.fn(refused),
    queueShoppingForLater: vi.fn(refused),
    resolveReview: vi.fn(refused),
    undo: vi.fn(refused),
    closeBatch: vi.fn(refused),
    keepOlderBatch: vi.fn(refused),
    showOwn: vi.fn(),
    touched: vi.fn(),
    ...overrides,
  };
}
