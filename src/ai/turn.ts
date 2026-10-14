/**
 * One chat turn (backend-data.md §6, ai.md §1): interpret → apply → reply, streamed as the
 * canonical turn events. The order is fixed: `ack` first, `applied` before any `text`, and
 * `done` or `error` last. The interpreter only proposes; `applyProposedChange` decides.
 * The draft reply is sent only if every operation applied; otherwise `reword`, or a reply built
 * from the receipt.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import type { ApplyResult } from "@/contracts/apply-result";
import type { StreamEvent } from "@/contracts/stream";
import { applyProposedChange } from "@/domains/kitchen/commands";
import { getKitchenState } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { msg } from "@/shared/messages";
import type { InterpretRequest, Interpreter } from "./interpreter";
import { replyFromReceipt } from "./receipt-reply";

export interface ChatTurnInput {
  /** Client-made ID: the idempotency key, so "Try again" can never apply twice. */
  clientMessageId: string;
  text: string;
  /** Recent turns, oldest first (chats live on the device in this milestone). */
  history?: InterpretRequest["history"];
}

export async function* handleChatTurn(
  deps: { db: Db; scope: KitchenScope; interpreter: Interpreter },
  input: ChatTurnInput,
): AsyncGenerator<StreamEvent> {
  const { db, scope, interpreter } = deps;
  const turnId = randomUUID();
  let appliedSent = false;
  try {
    yield { type: "ack", turnId, messageId: input.clientMessageId };
    yield { type: "status", phase: "interpreting" };

    const state = await getKitchenState(db, scope);
    const req: InterpretRequest = {
      kitchenId: scope.kitchenId,
      userId: scope.userId,
      message: { id: input.clientMessageId, text: input.text },
      state,
      version: state.version,
      history: (input.history ?? []).slice(-10),
    };
    const interpretation = await interpreter.interpret(req);
    const proposal = interpretation.proposal;

    let result: ApplyResult | null = null;
    if (proposal && proposal.operations.length > 0) {
      yield { type: "status", phase: "saving" };
      // The idempotency key and source always come from this message, whatever was proposed.
      const outcome = await applyProposedChange(
        db,
        scope,
        {
          ...proposal,
          proposalId: input.clientMessageId,
          kitchenId: scope.kitchenId,
          source: { via: "chat", messageId: input.clientMessageId },
        },
        { messageText: input.text },
      );
      if (!outcome.ok) {
        yield { type: "error", reason: outcome.error.reason, changed: false, retryable: outcome.error.retryable };
        return;
      }
      result = outcome.result;
      yield { type: "applied", result };
      appliedSent = true;
    }

    if (proposal?.clarification) yield { type: "clarification", ...proposal.clarification };
    yield { type: "status", phase: "writing" };
    let reply = interpretation.reply;
    if (result && (result.rejected.length > 0 || result.applied.length === 0)) {
      reply = interpreter.reword ? await interpreter.reword(req, interpretation, result) : replyFromReceipt(result);
    }
    yield { type: "text", delta: reply };
    yield { type: "done", turnId, assistantMessageId: randomUUID() };
  } catch (error) {
    console.error("chat.turn: failed", { turnId, error });
    yield { type: "error", reason: msg("SAVE_FAILED"), changed: appliedSent, retryable: true };
  }
}
