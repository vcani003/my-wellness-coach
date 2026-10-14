"use server";
/**
 * Batch buttons (0025; backend-data.md §6): the receipt's one-tap choice after buying something
 * you already had, "You also had eggs from Oct 2: **Still have them** · **Those are gone**".
 * The choice comes from `ApplyResult.applied[].batchOffers`; pass the offer's `itemId` and the
 * `older[].batchId`s you're answering for.
 *
 * - `closeBatch {kitchenId, tapId, basedOnVersion, itemId, batchIds}` → "Those are gone": they
 *   close (history keeps them; the item is Out once its last batch closes, 0011). Undoable.
 * - `keepOlderBatch {…same}` → "Still have them": they stay and the choice is dismissed. A soft
 *   change: not undoable, and it never blocks undoing the purchase.
 *
 * Each re-checks the session and membership and goes through the same validate → apply path as
 * chat. `tapId` makes a double tap harmless. Never throws to the UI (0018).
 */
import { z } from "zod";
import type { ApplyResult } from "@/contracts/apply-result";
import { Id, type Msg } from "@/contracts/common";
import { closeBatches, keepBatches } from "@/domains/kitchen/commands";
import { getScope } from "@/server/session";
import { msg } from "@/shared/messages";

export type BatchActionResult = { ok: true; result: ApplyResult } | { ok: false; reason: Msg; retryable: boolean };

const BatchInput = z.object({
  kitchenId: Id,
  tapId: Id,
  basedOnVersion: z.number().int().nonnegative(),
  itemId: Id,
  batchIds: z.array(Id).min(1).max(3),
});
export type BatchInput = z.input<typeof BatchInput>;

async function run(input: unknown, command: typeof closeBatches): Promise<BatchActionResult> {
  const parsed = BatchInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: msg("INVALID_PROPOSAL"), retryable: false };
  try {
    const ctx = await getScope(parsed.data.kitchenId);
    if (!ctx) return { ok: false, reason: msg("NOT_ALLOWED"), retryable: false };
    const outcome = await command(ctx.db, ctx.scope, parsed.data);
    return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, ...outcome.error };
  } catch (error) {
    console.error("batches: action failed", { error });
    return { ok: false, reason: msg("SAVE_FAILED"), retryable: true };
  }
}

/** "Those are gone". */
export async function closeBatch(input: BatchInput): Promise<BatchActionResult> {
  return run(input, closeBatches);
}

/** "Still have them" (dismiss). */
export async function keepOlderBatch(input: BatchInput): Promise<BatchActionResult> {
  return run(input, keepBatches);
}
