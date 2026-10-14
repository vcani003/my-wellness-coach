/** ApplyResult (backend-data.md §6). */
import { z } from "zod";
import { ActorRef, Id, Msg } from "./common";
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
]);
export type RejectionCode = z.infer<typeof RejectionCode>;

export const RefKind = z.enum(["item", "meal", "recipe", "tick", "review", "profile"]);
export type RefKind = z.infer<typeof RefKind>;

export const ChangeRef = z.object({
  kind: RefKind,
  id: Id,
  change: z.enum(["added", "updated", "removed"]),
});
export type ChangeRef = z.infer<typeof ChangeRef>;

export const AppliedOp = z.object({ opId: Id, summary: Msg, refs: z.array(ChangeRef) });
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
