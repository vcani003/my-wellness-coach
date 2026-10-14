/**
 * Reading saved chat (backend-data.md §6, P2 a). Only ever the caller's own messages in the
 * scope's kitchen (H2, 0017). Reads never throw because of a bad row (0018): a row that fails
 * the contract is left out and logged.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { chatMessages } from "@/db/schema";
import { ChatHistoryMessage, ChatReceipt, type ChatHistoryPage } from "@/contracts/chat-history";
import { getStillUndoable, getUnansweredBatchIds } from "@/domains/kitchen/public";
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
  const undoable = await getStillUndoable(db, scope, changeSetIds);
  const unanswered = await getUnansweredBatchIds(db, scope, offeredBatchIds(page)).catch((error) => {
    // Never crash (0018): without this, saved batch choices are just not redrawn.
    console.error("chat.read: couldn't check batch choices", { error });
    return new Set<string>();
  });

  const messages: ChatHistoryMessage[] = [];
  for (const r of page.reverse()) {
    const parsed = ChatHistoryMessage.safeParse(toMessage(r, undoable, unanswered));
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
    const parsed = r.receipt ? ChatReceipt.safeParse(r.receipt) : null;
    for (const a of parsed?.success ? parsed.data.applied : []) {
      for (const o of a.batchOffers ?? []) for (const b of o.older) ids.add(b.batchId);
    }
  }
  return [...ids];
}

function toMessage(r: Row, undoable: Set<string>, unanswered: Set<string>) {
  let receipt: ChatReceipt | null = null;
  if (r.receipt) {
    const parsed = ChatReceipt.safeParse(r.receipt);
    if (parsed.success) {
      const { undoBlockedReason, ...rest } = parsed.data;
      const still = undoable.has(parsed.data.changeSetId);
      // A batch choice is redrawn only while one of its older batches is open and unanswered.
      const applied = rest.applied.map((a) => {
        if (!a.batchOffers) return a;
        const { batchOffers, ...op } = a;
        const open = batchOffers
          .map((o) => ({ ...o, older: o.older.filter((b) => unanswered.has(b.batchId)) }))
          .filter((o) => o.older.length > 0);
        return open.length ? { ...op, batchOffers: open } : op;
      });
      receipt = { ...rest, applied, undoable: still, ...(undoBlockedReason && !still ? { undoBlockedReason } : {}) };
    } else {
      // A receipt we can't read: show the message without it rather than drop the reply.
      console.error("chat.read: unreadable receipt", { id: r.id, issues: parsed.error.issues });
    }
  }
  return {
    id: r.id,
    clientMessageId: r.clientMessageId,
    role: r.role,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
    receipt,
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
