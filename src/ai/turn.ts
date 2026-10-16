/**
 * One chat turn (backend-data.md §6, ai.md §1): interpret → apply → reply, streamed as the
 * canonical turn events. The order is fixed: `ack` first, `applied` before any `text`, and
 * `done` or `error` last. The interpreter only proposes; `applyProposedChange` decides.
 * The draft reply is sent only if every operation applied; otherwise `reword`, or a reply built
 * from the receipt.
 *
 * Follow-ups (meals, P2 d) run after the reply's first line, in order: ideas, the recipe and
 * "Update your kitchen" (`./follow-ups.ts`). A meal step on a just-chosen idea is folded into
 * the main proposal, so "plan the omelette" is one change set.
 *
 * Chat is saved (P2 a): the user's message on arrival, the reply and its receipt at `done`. The
 * interpreter's recent turns come from those saved messages, never from the client. Saving and
 * loading are best-effort: a failure is logged and the turn carries on (0018).
 */
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import type { ApplyResult } from "@/contracts/apply-result";
import type { StreamEvent } from "@/contracts/stream";
import { saveAssistantMessage, saveUserMessage } from "@/domains/chat/commands";
import { getRecentTurns } from "@/domains/chat/queries";
import { applyProposedChange, chooseMealTap } from "@/domains/kitchen/commands";
import { getKitchenState, getLatestIdeaSet, getRecipe } from "@/domains/kitchen/queries";
import type { KitchenScope } from "@/shared/membership";
import { msg } from "@/shared/messages";
import { foldMealSteps, recipeParts, recipeStep, runFollowUps, withoutIdeaRefineDraft, withoutRecipeAnnouncement } from "./follow-ups";
import type { InterpretRequest, Interpreter } from "./interpreter";
import { notConfiguredMealAI, type MealAI } from "./meals";
import { replyFromReceipt } from "./receipt-reply";

export interface ChatTurnInput {
  /** Client-made ID: the idempotency key, so "Try again" can never apply twice. */
  clientMessageId: string;
  text: string;
  /**
   * Ignored: the recent turns now come from the saved chat (P2 a). Still accepted so older
   * clients keep working.
   */
  history?: InterpretRequest["history"];
}

export interface ChatTurnDeps {
  db: Db;
  scope: KitchenScope;
  interpreter: Interpreter;
  /** Ideas and recipes (`getMealAI`). Absent = they reply "not set up" (never silently fake). */
  meals?: MealAI;
}

export async function* handleChatTurn(deps: ChatTurnDeps, input: ChatTurnInput): AsyncGenerator<StreamEvent> {
  const { db, scope, interpreter } = deps;
  const turnId = randomUUID();
  let appliedSent = false;
  try {
    const history = await bestEffort("load recent turns", [], () =>
      getRecentTurns(db, scope, { excludeClientMessageId: input.clientMessageId }),
    );
    await bestEffort("save user message", undefined, () =>
      saveUserMessage(db, scope, { clientMessageId: input.clientMessageId, text: input.text }),
    );
    yield { type: "ack", turnId, messageId: input.clientMessageId };
    yield { type: "status", phase: "interpreting" };

    const state = await getKitchenState(db, scope);
    // The idea cards this user was last shown, in card order, so "the second one" resolves.
    const shown = await bestEffort("load idea cards", null, () => getLatestIdeaSet(db, scope));
    const req: InterpretRequest = {
      kitchenId: scope.kitchenId,
      userId: scope.userId,
      message: { id: input.clientMessageId, text: input.text },
      state,
      version: state.version,
      history,
      ...(shown
        ? {
            ideas: shown.ideas.map((i) => ({
              ideaId: i.ideaId,
              name: i.name,
              uses: i.uses.flatMap((id) => state.items.find((item) => item.id === id)?.name.value ?? []),
              missing: i.missing,
            })),
          }
        : {}),
    };
    const interpretation = await interpreter.interpret(req);
    const folded = foldMealSteps(interpretation.proposal?.operations ?? [], interpretation.followUps ?? [], input.text);
    const proposal = interpretation.proposal ? { ...interpretation.proposal, operations: folded.operations } : null;

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
    reply = withoutIdeaRefineDraft(withoutRecipeAnnouncement(reply, folded.followUps), folded.followUps, result);
    if (reply) yield { type: "text", delta: reply };

    // Meals: generated after the save, never before (§6).
    const newId = randomUUID();
    let fullReply = reply;
    if (folded.followUps.length > 0) {
      const lines = yield* runFollowUps(
        { db, scope, meals: deps.meals ?? notConfiguredMealAI },
        {
          id: input.clientMessageId,
          source: { via: "chat", messageId: input.clientMessageId },
          text: input.text,
          history: [...history, { role: "user", text: input.text }],
          assistantMessageId: newId,
        },
        folded.followUps,
        result,
      );
      for (const line of lines) {
        const delta = fullReply ? `\n\n${line}` : line;
        fullReply += delta;
        yield { type: "text", delta };
      }
    }

    const assistantMessageId = await bestEffort("save reply", newId, () =>
      saveAssistantMessage(db, scope, { id: newId, clientMessageId: input.clientMessageId, text: fullReply, result }),
    );
    yield { type: "done", turnId, assistantMessageId };
  } catch (error) {
    console.error("chat.turn: failed", { turnId, error });
    yield { type: "error", reason: msg("SAVE_FAILED"), changed: appliedSent, retryable: true };
  }
}

/** Run a chat-history step; on failure log it and use the fallback, so the turn goes on (0018). */
async function bestEffort<T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`chat.history: couldn't ${what}`, { error });
    return fallback;
  }
}

export interface ChooseMealInput {
  /** The tap's ID: the idempotency key for the choose and its recipe. */
  clientMessageId: string;
  target: { ideaId: string } | { mealId: string };
}

/**
 * `POST /api/meals/choose` and the `chooseMeal` server action (0005, 0013, R2): apply
 * `meal.choose` from a tap, then the recipe: the saved one if the meal has it, otherwise a
 * suggested one, streamed and saved. Same events and order as a chat turn; nothing goes to chat,
 * so `done.assistantMessageId` is the turn ID.
 */
export async function* handleChooseMeal(
  deps: { db: Db; scope: KitchenScope; meals: MealAI },
  input: ChooseMealInput,
): AsyncGenerator<StreamEvent> {
  const { db, scope } = deps;
  const turnId = randomUUID();
  let appliedSent = false;
  try {
    yield { type: "ack", turnId, messageId: input.clientMessageId };
    yield { type: "status", phase: "saving" };
    const state = await getKitchenState(db, scope);
    const outcome = await chooseMealTap(db, scope, { tapId: input.clientMessageId, basedOnVersion: state.version, ...input.target });
    if (!outcome.ok) {
      yield { type: "error", reason: outcome.error.reason, changed: false, retryable: outcome.error.retryable };
      return;
    }
    const result = outcome.result;
    yield { type: "applied", result };
    appliedSent = true;
    const mealId = result.applied[0]?.refs.find((r) => r.kind === "meal")?.id;
    if (!mealId) {
      yield { type: "text", delta: replyFromReceipt(result) };
      yield { type: "done", turnId, assistantMessageId: turnId };
      return;
    }

    const meal = result.state.meals.find((m) => m.id === mealId);
    let reply = "";
    const existing = meal?.recipe ? await getRecipe(db, scope, mealId) : null;
    if (existing && meal) {
      for (const p of recipeParts(existing, meal.title)) yield { type: "recipe", mealId, part: p.part, data: p.data };
    } else {
      reply = yield* recipeStep(
        { db, scope, meals: deps.meals },
        { id: input.clientMessageId, source: { via: "button", action: "recipe.suggest" } },
        mealId,
      );
    }
    if (reply) yield { type: "text", delta: reply };
    yield { type: "done", turnId, assistantMessageId: turnId };
  } catch (error) {
    console.error("meals.choose: failed", { turnId, error });
    yield { type: "error", reason: msg("SAVE_FAILED"), changed: appliedSent, retryable: true };
  }
}
