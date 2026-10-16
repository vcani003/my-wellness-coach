/**
 * Saving chat messages (backend-data.md §6, P2 a). Private per person (H2, 0017): every row
 * carries the user and kitchen from the membership-checked scope.
 *
 * Idempotent: one row per role per turn (`clientMessageId`), so "Try again" saves nothing twice.
 * These functions may throw; the chat turn catches and logs, so a failed save never breaks a
 * turn (0018).
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { chatMessages } from "@/db/schema";
import type { ApplyResult } from "@/contracts/apply-result";
import type { StoredReceipt } from "@/contracts/chat-history";
import type { KitchenScope } from "@/shared/membership";

export interface SaveMessageArgs {
  clientMessageId: string;
  text: string;
  now?: Date;
}

/** Save the user's message as it arrives. A retry of the same turn changes nothing. */
export async function saveUserMessage(db: Queryable, scope: KitchenScope, args: SaveMessageArgs): Promise<void> {
  await db
    .insert(chatMessages)
    .values({
      id: randomUUID(),
      kitchenId: scope.kitchenId,
      userId: scope.userId,
      role: "user",
      text: args.text,
      clientMessageId: args.clientMessageId,
      createdAt: args.now ?? new Date(),
    })
    .onConflictDoNothing();
}

/**
 * Save the assistant's reply and its receipt when the turn is done. Returns the saved message's
 * ID: a fresh one, or the first attempt's when this turn was already saved.
 */
export async function saveAssistantMessage(
  db: Queryable,
  scope: KitchenScope,
  args: SaveMessageArgs & {
    id: string;
    result: ApplyResult | null;
    /** A held bulk removal this reply asks about (0045 KOS16); stored as given, read by the AI turn. */
    pendingConfirm?: unknown;
  },
): Promise<string> {
  const receipt: StoredReceipt | null = args.result ? withoutState(args.result) : null;
  const inserted = await db
    .insert(chatMessages)
    .values({
      id: args.id,
      kitchenId: scope.kitchenId,
      userId: scope.userId,
      role: "assistant",
      text: args.text,
      clientMessageId: args.clientMessageId,
      changeSetId: receipt?.changeSetId ?? null,
      receipt,
      pendingConfirm: args.pendingConfirm ?? null,
      createdAt: args.now ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: chatMessages.id });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.kitchenId, scope.kitchenId),
        eq(chatMessages.userId, scope.userId),
        eq(chatMessages.clientMessageId, args.clientMessageId),
        eq(chatMessages.role, "assistant"),
      ),
    );
  return existing?.id ?? args.id;
}

function withoutState(result: ApplyResult): StoredReceipt {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { state, ...rest } = result;
  return rest;
}
