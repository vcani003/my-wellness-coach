/**
 * Saved chat history (backend-data.md §6, P2 a): `GET /api/chat/history`.
 * Only ever the caller's own messages in that kitchen (H2, 0017).
 */
import { z } from "zod";
import { Id } from "./common";
import { ApplyResult } from "./apply-result";

/**
 * A saved turn's receipt: the ApplyResult without `state` (the current state comes from
 * `/state`). `undoable` is worked out again on every read: true only for your own change set
 * that saved something, isn't an undo, and hasn't been undone since. An Undo that a later change
 * blocks is still refused when tapped (`UNDO_CONFLICT`), as everywhere else.
 */
export const ChatReceipt = ApplyResult.omit({ state: true });
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
