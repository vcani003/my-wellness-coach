/**
 * Reading saved chat (backend-data.md §6, P2 a). Only ever the caller's own messages in the
 * scope's kitchen (H2, 0017). Reads never throw because of a bad row (0018): a row that fails
 * the contract is left out and logged.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { chatMessages } from "@/db/schema";
import { ChatHistoryMessage, StoredReceipt, type BatchAnswer, type ChatHistoryPage, type ChatReceipt } from "@/contracts/chat-history";
import { BulkConfirm } from "@/contracts/stream";
import {
  getBatchAnswers,
  getUndoStatus,
  getUnansweredBatchIds,
  type BatchAnswerChangeSet,
  type UndoStatus,
} from "@/domains/kitchen/public";
import type { KitchenScope } from "@/shared/membership";

export const HISTORY_PAGE_DEFAULT = 30;
export const HISTORY_PAGE_MAX = 100;
/** How many recent messages the interpreter sees (ai.md §2: this user's last 10 turns). */
export const INTERPRETER_HISTORY = 10;

type Row = typeof chatMessages.$inferSelect;
/** Same shape as the interpreter's `history` (src/ai/interpreter.ts). */
export type RecentTurn = { role: "user" | "assistant"; text: string };

const mine = (scope: KitchenScope) =>
  and(eq(chatMessages.kitchenId, scope.kitchenId), eq(chatMessages.userId, scope.userId));

/** The cursor is the oldest returned message's position; it's opaque to the client. */
function parseCursor(before: string | undefined): number | null {
  if (!before) return null;
  const n = Number(before);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** One page of your chat, newest page first (oldest first within the page). */
export async function listChatHistory(
  db: Queryable,
  scope: KitchenScope,
  opts: { before?: string; limit?: number } = {},
): Promise<ChatHistoryPage> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? HISTORY_PAGE_DEFAULT)), HISTORY_PAGE_MAX);
  const before = parseCursor(opts.before);
  const rows = await db
    .select()
    .from(chatMessages)
    .where(before === null ? mine(scope) : and(mine(scope), lt(chatMessages.seq, before)))
    .orderBy(desc(chatMessages.seq))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  const changeSetIds = page.flatMap((r) => (r.changeSetId ? [r.changeSetId] : []));
  const undo = await getUndoStatus(db, scope, changeSetIds);
  const offered = offeredBatchIds(page);
  const unanswered = await getUnansweredBatchIds(db, scope, offered).catch((error) => {
    // Never crash (0018): without this, saved batch choices are just not redrawn.
    console.error("chat.read: couldn't check batch choices", { error });
    return new Set<string>();
  });
  const answers = await getBatchAnswers(db, scope, offered)
    .then((found) => matchBatchAnswers(page, found))
    .catch((error) => {
      // Never crash (0018): without this, a receipt's answered choice just isn't redrawn.
      console.error("chat.read: couldn't find batch answers", { error });
      return new Map<string, BatchAnswer[]>();
    });

  const messages: ChatHistoryMessage[] = [];
  for (const r of page.reverse()) {
    const parsed = ChatHistoryMessage.safeParse(toMessage(r, undo, unanswered, answers));
    if (parsed.success) messages.push(parsed.data);
    else console.error("chat.read: dropped a message", { id: r.id, issues: parsed.error.issues });
  }
  const oldest = page[0];
  return { messages, nextCursor: hasMore && oldest ? String(oldest.seq) : null };
}

/** Older batch IDs offered in these receipts' "Still have them · Those are gone" choices (0025). */
function offeredBatchIds(rows: Row[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    const parsed = r.receipt ? StoredReceipt.safeParse(r.receipt) : null;
    for (const a of parsed?.success ? parsed.data.applied : []) {
      for (const o of a.batchOffers ?? []) for (const b of o.older) ids.add(b.batchId);
    }
  }
  return [...ids];
}

/**
 * Which receipt's batch choice each answer was given on, by receipt change set ID. Taps aren't
 * linked to a message when saved, so this is worked out: the receipt came before the answer
 * (lower version), offered every batch it answered for, for the same item, and hasn't been given
 * another answer. If several fit, the one whose offer is exactly those batches wins, then the
 * newest. (Only possible with 3+ eggs batches on several receipts; live, the tap was on one.)
 */
export function matchBatchAnswers(rows: Row[], found: BatchAnswerChangeSet[]): Map<string, BatchAnswer[]> {
  const slots: { receipt: string; version: number; itemId: string; newBatchId: string; older: Set<string>; taken: boolean }[] = [];
  for (const r of rows) {
    const parsed = r.receipt ? StoredReceipt.safeParse(r.receipt) : null;
    if (!parsed?.success) continue;
    for (const a of parsed.data.applied) {
      for (const o of a.batchOffers ?? []) {
        slots.push({
          receipt: parsed.data.changeSetId,
          version: parsed.data.newVersion,
          itemId: o.itemId,
          newBatchId: o.newBatchId,
          older: new Set(o.older.map((b) => b.batchId)),
          taken: false,
        });
      }
    }
  }
  const out = new Map<string, BatchAnswer[]>();
  for (const answer of [...found].sort((a, b) => b.version - a.version)) {
    const fits = slots.filter(
      (s) => !s.taken && s.itemId === answer.itemId && s.version < answer.version && answer.batchIds.every((id) => s.older.has(id)),
    );
    const exact = (s: (typeof slots)[number]) => (s.older.size === new Set(answer.batchIds).size ? 1 : 0);
    const slot = fits.sort((a, b) => exact(b) - exact(a) || b.version - a.version)[0];
    if (!slot) continue;
    slot.taken = true;
    const list = out.get(slot.receipt) ?? [];
    list.push({
      itemId: slot.itemId,
      newBatchId: slot.newBatchId,
      choice: answer.choice,
      changeSetId: answer.changeSetId,
      applied: answer.applied,
      undoable: answer.undoable,
    });
    out.set(slot.receipt, list);
  }
  return out;
}

function toMessage(r: Row, undo: Map<string, UndoStatus>, unanswered: Set<string>, answers: Map<string, BatchAnswer[]>) {
  let receipt: ChatReceipt | null = null;
  if (r.receipt) {
    const parsed = StoredReceipt.safeParse(r.receipt);
    if (parsed.success) {
      const { undoBlockedReason, ...rest } = parsed.data;
      const status = undo.get(parsed.data.changeSetId);
      const still = status?.undoable ?? false;
      const undone = status?.undone ?? null;
      const batchAnswers = answers.get(parsed.data.changeSetId) ?? [];
      const answered = (o: { itemId: string; newBatchId: string }) =>
        batchAnswers.some((b) => b.itemId === o.itemId && b.newBatchId === o.newBatchId);
      // A batch choice is redrawn with its answer, or else only while one of its older batches is
      // open and unanswered.
      const applied = rest.applied.map((a) => {
        if (!a.batchOffers) return a;
        const { batchOffers, ...op } = a;
        const open = batchOffers
          .map((o) => (answered(o) ? o : { ...o, older: o.older.filter((b) => unanswered.has(b.batchId)) }))
          .filter((o) => o.older.length > 0);
        return open.length ? { ...op, batchOffers: open } : op;
      });
      receipt = {
        ...rest,
        applied,
        undoable: still,
        ...(undoBlockedReason && !still ? { undoBlockedReason } : {}),
        undone: undone !== null,
        ...(undone?.by ? { undoneBy: undone.by } : {}),
        ...(undone?.at ? { undoneAt: undone.at } : {}),
        ...(batchAnswers.length ? { batchAnswers } : {}),
      };
    } else {
      // A receipt we can't read: show the message without it rather than drop the reply.
      console.error("chat.read: unreadable receipt", { id: r.id, issues: parsed.error.issues });
    }
  }
  // A held bulk removal (0045 KOS16): only what was asked (kind, count, names), never the held change.
  const confirm = r.pendingConfirm ? BulkConfirm.safeParse(r.pendingConfirm) : null;
  return {
    id: r.id,
    clientMessageId: r.clientMessageId,
    role: r.role,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
    receipt,
    ...(confirm?.success ? { confirm: confirm.data } : {}),
  };
}

/**
 * The interpreter's recent turns, oldest first, from the database rather than the client.
 * Leaves out the turn being handled (`excludeClientMessageId`), so a retry doesn't see itself.
 */
export async function getRecentTurns(
  db: Queryable,
  scope: KitchenScope,
  opts: { excludeClientMessageId?: string; limit?: number } = {},
): Promise<RecentTurn[]> {
  const limit = opts.limit ?? INTERPRETER_HISTORY;
  const rows = await db
    .select({ role: chatMessages.role, text: chatMessages.text, clientMessageId: chatMessages.clientMessageId })
    .from(chatMessages)
    .where(mine(scope))
    .orderBy(desc(chatMessages.seq))
    .limit(limit + 2);
  return rows
    .filter((r) => r.clientMessageId !== opts.excludeClientMessageId)
    .slice(0, limit)
    .reverse()
    .flatMap((r): RecentTurn[] => (r.role === "user" || r.role === "assistant" ? [{ role: r.role, text: r.text }] : []));
}

/**
 * The held bulk removal (0045 KOS16) that a message from this user would answer: only when the
 * newest message in your chat (leaving out the turn being handled, so a retry still finds it) is a
 * reply that asked one. Anything said after it means it was passed over. Raw stored JSON; the AI
 * turn checks its shape. Your own chat only, so in a household only the asker can answer (0017).
 */
export async function getPendingConfirm(
  db: Queryable,
  scope: KitchenScope,
  opts: { excludeClientMessageId?: string } = {},
): Promise<{ clientMessageId: string; pending: unknown } | null> {
  const rows = await db
    .select({ role: chatMessages.role, clientMessageId: chatMessages.clientMessageId, pendingConfirm: chatMessages.pendingConfirm })
    .from(chatMessages)
    .where(mine(scope))
    .orderBy(desc(chatMessages.seq))
    .limit(3);
  const latest = rows.find((r) => r.clientMessageId !== opts.excludeClientMessageId);
  if (!latest || latest.role !== "assistant" || latest.pendingConfirm == null) return null;
  return { clientMessageId: latest.clientMessageId, pending: latest.pendingConfirm };
}
