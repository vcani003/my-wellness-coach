/**
 * Saved chat history (backend-data.md §6, P2 a): `GET /api/chat/history`.
 * Only ever the caller's own messages in that kitchen (H2, 0017).
 */
import { z } from "zod";
import { ActorRef, Id } from "./common";
import { AppliedOp, ApplyResult } from "./apply-result";

/** A receipt as saved with the message: the ApplyResult without `state`. Server-side only. */
export const StoredReceipt = ApplyResult.omit({ state: true });
export type StoredReceipt = z.infer<typeof StoredReceipt>;

/**
 * Your answer to one of the receipt's batch choices (0025), found again on every read so a
 * reloaded receipt matches the live one (tester re-run 2026-10-14, step 28): "Those are gone"
 * (`gone`, from `closeBatch`) or "Still have them" (`keep`, from `keepOlderBatch`). It belongs to
 * the offer with this `itemId` and `newBatchId`. Draw `applied` in place of the buttons; while
 * `undoable`, the receipt's one Undo undoes this answer first (`changeSetId`). Answers undone since
 * are left out (the choice is back), as are answers given in chat or by someone else.
 */
export const BatchAnswer = z.object({
  itemId: Id,
  newBatchId: Id,
  choice: z.enum(["gone", "keep"]),
  changeSetId: Id,
  applied: z.array(AppliedOp),
  undoable: z.boolean(),
});
export type BatchAnswer = z.infer<typeof BatchAnswer>;

/**
 * A saved turn's receipt: the stored one, with its undo status worked out again on every read
 * (never trusted from the saved copy).
 * - `undoable`: true only for your own change set that saved something, isn't an undo, and hasn't
 *   been undone since. An Undo that a later change blocks is still refused when tapped
 *   (`UNDO_CONFLICT`), as everywhere else.
 * - `undone`: true once anyone has undone this change set. Draw it as undone (struck through,
 *   "Undone"), with no Undo button.
 * - `undoneBy` / `undoneAt`: who undid it and when; present when `undone` (left out only if that
 *   undo can't be found, 0018).
 * - `batchAnswers`: see `BatchAnswer`. An answered offer stays in `applied[].batchOffers` with
 *   its answer; an unanswered one stays only while it still needs asking.
 */
export const ChatReceipt = StoredReceipt.extend({
  undone: z.boolean(),
  undoneBy: ActorRef.optional(),
  undoneAt: z.iso.datetime({ offset: true }).optional(),
  /** Answers given on this receipt's batch choices; absent when there are none. */
  batchAnswers: z.array(BatchAnswer).optional(),
});
export type ChatReceipt = z.infer<typeof ChatReceipt>;

export const ChatHistoryMessage = z.object({
  id: Id,
  /** The turn's `clientMessageId` (the same on its user and assistant messages). */
  clientMessageId: Id,
  role: z.enum(["user", "assistant"]),
  /** Plain text, exactly as typed, pasted or replied. Never render it as HTML. */
  text: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Assistant messages whose turn applied something; otherwise null. */
  receipt: ChatReceipt.nullable(),
});
export type ChatHistoryMessage = z.infer<typeof ChatHistoryMessage>;

export const ChatHistoryPage = z.object({
  /** Oldest first within the page. The first request returns the newest page. */
  messages: z.array(ChatHistoryMessage),
  /** Pass as `before` to get the next older page; null when there's nothing older. */
  nextCursor: z.string().nullable(),
});
export type ChatHistoryPage = z.infer<typeof ChatHistoryPage>;
