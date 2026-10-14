/** ApplyResult (backend-data.md §6). */
import { z } from "zod";
import { ActorRef, Id, Msg, Quantity, fact } from "./common";
import { KitchenState } from "./kitchen-state";

/**
 * Rejection reason codes. The first eight are the §6 list; the rest were added while building
 * (see the backend-data.md changelog).
 */
export const RejectionCode = z.enum([
  "UNKNOWN_ITEM",
  "AMBIGUOUS_ITEM",
  "EVIDENCE_NOT_FOUND",
  "NOT_SAID",
  "NOT_ALLOWED",
  "INVALID_TRANSITION",
  "ALREADY_OUT",
  "STALE_TARGET",
  // added in the build
  "UNKNOWN_TARGET",
  "UNDO_CONFLICT",
  "ALREADY_UNDONE",
  "INVALID_OPERATION",
  "UNDO_OF_UNDO",
  // shopping list (0027)
  "NOT_ON_LIST",
  "NOT_TICKED",
]);
// Batches (0025) add no codes: a bad batch ID → UNKNOWN_TARGET; a closed batch → ALREADY_OUT.
export type RejectionCode = z.infer<typeof RejectionCode>;

/** `shopping` = a shopping-list item; `removed` also covers one moved into the kitchen. */
export const RefKind = z.enum(["item", "meal", "recipe", "tick", "review", "profile", "shopping"]);
export type RefKind = z.infer<typeof RefKind>;

export const ChangeRef = z.object({
  kind: RefKind,
  id: Id,
  change: z.enum(["added", "updated", "removed"]),
  /** For an item: the batch this changed, when it was one batch (0025). */
  batchId: Id.optional(),
});
export type ChangeRef = z.infer<typeof ChangeRef>;

const isoDate = z.iso.datetime({ offset: true });

/**
 * A new batch went into an item that already had open ones (0025). The receipt offers one tap,
 * never a required question: "You also had eggs from Oct 2: **Still have them** · **Those are
 * gone**". "Those are gone" = `closeBatch {itemId, batchIds}`; "Still have them" =
 * `keepOlderBatch {itemId, batchIds}` (both in `src/app/batches/actions.ts`).
 * Show it only while `isBatchOfferOpen(offer, state)`.
 */
export const BatchOffer = z.object({
  itemId: Id,
  /** The item's name now. */
  name: z.string(),
  newBatchId: Id,
  /** The other open batches, oldest first. */
  older: z
    .array(z.object({ batchId: Id, addedAt: isoDate, quantity: fact(Quantity).optional() }))
    .min(1),
  /** A 4th batch closed the oldest one automatically (0025): it's in history, not on the list. */
  autoClosed: z.object({ batchId: Id, addedAt: isoDate }).optional(),
});
export type BatchOffer = z.infer<typeof BatchOffer>;

export const AppliedOp = z.object({
  opId: Id,
  summary: Msg,
  refs: z.array(ChangeRef),
  /** One per item that got a new batch next to older ones (item.add, shopping.done). */
  batchOffers: z.array(BatchOffer).optional(),
});
export type AppliedOp = z.infer<typeof AppliedOp>;

export const RejectedOp = z.object({ opId: Id, reason: Msg });
export type RejectedOp = z.infer<typeof RejectedOp>;

export const ApplyResult = z.object({
  changeSetId: Id,
  newVersion: z.number().int().nonnegative(),
  undoable: z.boolean(),
  undoBlockedReason: Msg.optional(),
  applied: z.array(AppliedOp),
  rejected: z.array(RejectedOp),
  /** Full current state; small at MVP size, so no refetch is needed. */
  state: KitchenState,
});
export type ApplyResult = z.infer<typeof ApplyResult>;

/**
 * Whether a receipt's batch choice still needs asking: some older batch is still open in `state`
 * and nobody has tapped "Still have them" for it since. Pure; the UI and the history read use it.
 */
export function isBatchOfferOpen(
  offer: BatchOffer,
  state: { items: { id: string; batches?: { id: string; keptAt?: string }[] }[] },
): boolean {
  const item = state.items.find((i) => i.id === offer.itemId);
  if (!item?.batches) return false;
  const open = new Map(item.batches.map((b) => [b.id, b]));
  return offer.older.some((o) => {
    const b = open.get(o.batchId);
    return b !== undefined && b.keptAt === undefined;
  });
}

/** One line of "Since your last visit" (`GET /api/kitchens/:id/changes?since=`). */
export const ChangeSetSummary = z.object({
  changeSetId: Id,
  version: z.number().int().nonnegative(),
  actor: ActorRef,
  via: z.enum(["chat", "button", "system"]),
  at: z.iso.datetime({ offset: true }),
  summaries: z.array(Msg),
  undone: z.boolean(),
});
export type ChangeSetSummary = z.infer<typeof ChangeSetSummary>;
