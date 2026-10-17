/**
 * One chat turn (backend-data.md §6, ai.md §1): interpret → apply → reply, streamed as the
 * canonical turn events. The order is fixed: `ack` first, `applied` before any `text`, and
 * `done` or `error` last. A turn whose only change is a recipe edit (0052) gets its `applied`
 * from the recipe step, so its reply waits until after the follow-ups to keep that order. The interpreter only proposes; `applyProposedChange` decides.
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
 *
 * More than 5 removals in one message (0045 KOS16, `./bulk-remove.ts`) are held, not applied: the
 * reply asks "Remove them all?" and keeps the change with it. A plain yes as the next message
 * applies exactly that change (one change set, one Undo), a plain no changes nothing, and both skip
 * the interpreter (no model call). Anything else is read as a new message.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import type { ApplyResult } from "@/contracts/apply-result";
import type { StreamEvent } from "@/contracts/stream";
import { saveAssistantMessage, saveUserMessage } from "@/domains/chat/commands";
import { getPendingConfirm, getRecentTurns } from "@/domains/chat/queries";
import { applyProposedChange, chooseMealTap, undo } from "@/domains/kitchen/commands";
import {
  getKitchenState,
  getKitchenVersion,
  getLatestIdeaSet,
  getMealProfileContext,
  getRecipe,
  getWeekNeeds,
  wasApplied,
} from "@/domains/kitchen/queries";
import { todayIn } from "@/shared/plan-dates";
import { weekNeedsAddedReply, weekNeedsAnswer } from "./week-plan";
import type { KitchenScope } from "@/shared/membership";
import { msg } from "@/shared/messages";
import {
  KEPT_REPLY,
  STALE_REPLY,
  bulkConfirmFor,
  readConfirmAnswer,
  readPending,
  toPending,
  type PendingBulkRemove,
} from "./bulk-remove";
import {
  FOLLOW_UP_FAILED_REPLY,
  afterUndo,
  foldMealSteps,
  recipeParts,
  recipeStep,
  runFollowUps,
  withoutIdeaRefineDraft,
  withoutRecipeAnnouncement,
} from "./follow-ups";
import type { InterpretRequest, Interpreter } from "./interpreter";
import { notConfiguredMealAI, type MealAI } from "./meals";
import { guardQuestionRemovals } from "./question-guard";
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
  /**
   * The person's device time zone (IANA), for "today" in the dated plan (0045 KOS1): relative days
   * and the plan window count from it. Absent or unknown → UTC.
   */
  timeZone?: string;
  /** Injected clock for tests. */
  now?: Date;
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
  const progress = { applied: false };
  try {
    const history = await bestEffort("load recent turns", [], () =>
      getRecentTurns(db, scope, { excludeClientMessageId: input.clientMessageId }),
    );
    // KOS16: was your last reply "Remove them all?" (a retry leaves itself out, so it still finds it).
    const held = await bestEffort("load held change", null, async () => {
      const found = await getPendingConfirm(db, scope, { excludeClientMessageId: input.clientMessageId });
      return found ? readPending(found.pending) : null;
    });
    await bestEffort("save user message", undefined, () =>
      saveUserMessage(db, scope, { clientMessageId: input.clientMessageId, text: input.text }),
    );
    yield { type: "ack", turnId, messageId: input.clientMessageId };

    const answer = held ? readConfirmAnswer(input.text) : null;
    if (held && answer) {
      yield* answerHeld(deps, input, { turnId, held, answer, history, progress });
      return;
    }
    yield { type: "status", phase: "interpreting" };

    const state = await getKitchenState(db, scope);
    // The message's own day in the person's time zone (0045 KOS1).
    const today = todayIn(input.timeZone, input.now ?? new Date());
    // The idea cards this user was last shown, in card order, so "the second one" resolves.
    const shown = await bestEffort("load idea cards", null, () => getLatestIdeaSet(db, scope));
    // Every member's allergies (0019), so a general staples guess leaves them out (0054 SS6).
    const allergies = await bestEffort("load allergies", [] as NonNullable<InterpretRequest["allergies"]>, async () => {
      const profile = await getMealProfileContext(db, scope);
      const names = new Map(profile.members.map((m) => [m.userId, m.name]));
      return profile.restrictions
        .filter((r) => r.kind === "allergy")
        .map((r) => ({ subject: r.subject.value, who: names.get(r.userId) ?? "a member" }));
    });
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
      ...(allergies.length ? { allergies } : {}),
      today,
    };
    // 0059 PF2: a question never removes anything, whatever the interpreter proposed.
    const guarded = guardQuestionRemovals(await interpreter.interpret(req), input.text);
    const interpretation = guarded.result;
    if (guarded.dropped.length > 0) {
      console.warn("ai.guard: dropped removals asked as a question", { count: guarded.dropped.length, types: guarded.dropped.map((o) => o.type) });
    }
    const folded = foldMealSteps(interpretation.proposal?.operations ?? [], interpretation.followUps ?? [], input.text);
    let proposal = interpretation.proposal ? { ...interpretation.proposal, operations: folded.operations } : null;

    // KOS12: "add what we need for this week's meals" goes on the list in the same change set;
    // "what do we need this week?" is answered from the same list (code, never the model).
    const weekNeeds = interpretation.weekNeeds
      ? await bestEffort("read the week's needs", null, () => getWeekNeeds(db, scope, { today }))
      : null;
    if (interpretation.weekNeeds?.add && weekNeeds) {
      const evidence = input.text.trim().slice(0, 2000);
      const adds = weekNeeds.items
        .filter((i) => !i.onList)
        .slice(0, 50)
        .map((i, n) => ({
          opId: `${input.clientMessageId}:week${n + 1}`,
          type: "shopping.add" as const,
          source: "week-plan" as const,
          evidence,
          fields: { name: { value: i.name, basis: "said" as const, confidence: "high" as const } },
        }));
      if (adds.length) {
        proposal = proposal
          ? { ...proposal, operations: [...proposal.operations, ...adds].slice(0, 50) }
          : {
              proposalId: input.clientMessageId,
              kitchenId: scope.kitchenId,
              basedOnVersion: state.version,
              source: { via: "chat" as const, messageId: input.clientMessageId },
              operations: adds,
            };
      }
    }

    // KOS16: more than 5 removals are held and asked about, never applied here.
    const bulk = proposal && proposal.operations.length > 0 ? bulkConfirmFor(proposal.operations, state) : null;
    if (proposal && bulk) {
      const { reply: question, ...confirm } = bulk;
      const newId = randomUUID();
      // Not best-effort: without the held change a yes couldn't apply it, so a failed save is an
      // error that says nothing changed (the outer catch), and Try again asks again.
      const assistantMessageId = await saveAssistantMessage(db, scope, {
        id: newId,
        clientMessageId: input.clientMessageId,
        text: question,
        result: null,
        pendingConfirm: toPending(confirm, {
          version: state.version,
          sourceMessageId: input.clientMessageId,
          messageText: input.text,
          operations: proposal.operations,
          followUps: folded.followUps,
        }),
      });
      yield { type: "status", phase: "writing" };
      yield { type: "text", delta: question };
      yield { type: "confirm", ...confirm };
      yield { type: "done", turnId, assistantMessageId };
      return;
    }

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
        { messageText: input.text, timeZone: input.timeZone, ...(input.now ? { now: input.now } : {}) },
      );
      if (!outcome.ok) {
        yield { type: "error", reason: outcome.error.reason, changed: false, retryable: outcome.error.retryable };
        return;
      }
      result = outcome.result;
      yield { type: "applied", result };
      progress.applied = true;
      // An Undo can put back an older recipe: it's shown again and its idea card follows it (0051 IR1, IR2; 0052).
      if (proposal.operations.some((op) => op.type === "changeset.revert")) {
        yield* afterUndo({ db, scope, meals: deps.meals ?? notConfiguredMealAI }, result);
      }
    }

    if (proposal?.clarification) yield { type: "clarification", ...proposal.clarification };
    yield { type: "status", phase: "writing" };
    let reply = interpretation.reply;
    if (result && guarded.dropped.length > 0) {
      // The draft was written with the dropped removal in mind: say only what saved (no model call).
      reply = replyFromReceipt(result);
    } else if (result && (result.rejected.length > 0 || result.applied.length === 0)) {
      reply = interpreter.reword ? await interpreter.reword(req, interpretation, result) : replyFromReceipt(result);
    }
    if (interpretation.weekNeeds) {
      // KOS12: written by code from the week's needs and what saved.
      const weekLine = !weekNeeds
        ? FOLLOW_UP_FAILED_REPLY
        : interpretation.weekNeeds.add
          ? weekNeedsAddedReply(weekNeeds, result)
          : weekNeedsAnswer(weekNeeds);
      const others = (interpretation.proposal?.operations.length ?? 0) > 0;
      reply = others && reply ? `${reply} ${weekLine}` : weekLine;
    }
    reply = withoutIdeaRefineDraft(withoutRecipeAnnouncement(reply, folded.followUps), folded.followUps, result);
    // 0052: a recipe edit with nothing else saved brings this turn's receipt (`applied`), which
    // must come before any text: the reply waits for it.
    const hasRecipe = (mealId: string) => state.meals.some((m) => m.id === mealId && m.recipe);
    const waitForReceipt = !result && folded.followUps.some((f) => f.kind === "recipe" && "mealId" in f.meal && hasRecipe(f.meal.mealId));
    if (reply && !waitForReceipt) yield { type: "text", delta: reply };
    // 0054 SS6: the staples the answer named, for its "Add these to my list" button.
    if (interpretation.staples?.items.length) yield { type: "staples", items: interpretation.staples.items };

    // Meals: generated after the save, never before (§6).
    const newId = randomUUID();
    let fullReply = waitForReceipt ? "" : reply;
    const pending = waitForReceipt ? reply : "";
    if (folded.followUps.length > 0) {
      const lines = yield* receiptOf(runFollowUps(
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
      ), (r) => {
        result = r;
      });
      if (pending) lines.unshift(pending);
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
    yield { type: "error", reason: msg("SAVE_FAILED"), changed: progress.applied, retryable: true };
  }
}

/**
 * The answer to "Remove them all?" (0045 KOS16). No model call either way.
 * - no: nothing changes.
 * - yes: exactly the held change, as one change set (one receipt, one Undo, 0007), then its
 *   follow-ups. If the kitchen changed since Lumi asked (anyone, any change), nothing is removed
 *   and she says so, so a yes never removes something added or changed in the meantime. A retried
 *   yes that already applied gets the same result back (this message is the idempotency key).
 */
async function* answerHeld(
  deps: ChatTurnDeps,
  input: ChatTurnInput,
  ctx: {
    turnId: string;
    held: PendingBulkRemove;
    answer: "yes" | "no";
    history: InterpretRequest["history"];
    progress: { applied: boolean };
  },
): AsyncGenerator<StreamEvent> {
  const { db, scope } = deps;
  const { held } = ctx;
  let result: ApplyResult | null = null;
  let reply = KEPT_REPLY;
  if (ctx.answer === "yes") {
    const version = await getKitchenVersion(db, scope);
    const fresh = version === held.version || (await wasApplied(db, scope, input.clientMessageId));
    reply = STALE_REPLY;
    if (fresh) {
      yield { type: "status", phase: "saving" };
      const outcome = await applyProposedChange(
        db,
        scope,
        {
          proposalId: input.clientMessageId,
          kitchenId: scope.kitchenId,
          // The version Lumi asked at: a change racing this yes is refused (STALE_TARGET), never applied blind.
          basedOnVersion: held.version,
          source: { via: "chat", messageId: held.sourceMessageId },
          operations: held.operations,
        },
        { messageText: held.messageText, timeZone: input.timeZone, ...(input.now ? { now: input.now } : {}) },
      );
      if (!outcome.ok) {
        yield { type: "error", reason: outcome.error.reason, changed: false, retryable: outcome.error.retryable };
        return;
      }
      result = outcome.result;
      yield { type: "applied", result };
      ctx.progress.applied = true;
      reply = replyFromReceipt(result);
    }
  }
  yield { type: "status", phase: "writing" };
  yield { type: "text", delta: reply };

  const newId = randomUUID();
  let fullReply = reply;
  if (result && held.followUps.length > 0) {
    const lines = yield* runFollowUps(
      { db, scope, meals: deps.meals ?? notConfiguredMealAI },
      {
        id: input.clientMessageId,
        source: { via: "chat", messageId: held.sourceMessageId },
        text: held.messageText,
        history: [...ctx.history, { role: "user", text: input.text }],
        assistantMessageId: newId,
      },
      held.followUps,
      result,
    );
    for (const line of lines) {
      const delta = `\n\n${line}`;
      fullReply += delta;
      yield { type: "text", delta };
    }
  }
  const assistantMessageId = await bestEffort("save reply", newId, () =>
    saveAssistantMessage(db, scope, { id: newId, clientMessageId: input.clientMessageId, text: fullReply, result }),
  );
  yield { type: "done", turnId: ctx.turnId, assistantMessageId };
}

/** Pass a generator's events through, handing any `applied` result to `onApplied` (0052). */
async function* receiptOf<R>(gen: AsyncGenerator<StreamEvent, R>, onApplied: (result: ApplyResult) => void): AsyncGenerator<StreamEvent, R> {
  let next = await gen.next();
  while (!next.done) {
    if (next.value.type === "applied") onApplied(next.value.result);
    yield next.value;
    next = await gen.next();
  }
  return next.value;
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

/**
 * The receipt's Undo button (`undoChange` server action, 0007, 0052): undo the change set (only
 * your own, H3/0017), then what the chat Undo also does (`afterUndo`): a recipe the Undo put back
 * replaces the one shown, and idea cards follow their recipes. Those events come back with the
 * result so the UI applies them like a stream's. A failure there is logged; the Undo stands (0018).
 */
export async function undoWithFollow(
  deps: { db: Db; scope: KitchenScope },
  args: { changeSetId: string; tapId: string; basedOnVersion: number },
): Promise<{ outcome: Awaited<ReturnType<typeof undo>>; events: StreamEvent[] }> {
  const outcome = await undo(deps.db, deps.scope, args);
  const events: StreamEvent[] = [];
  if (!outcome.ok || outcome.result.applied.length === 0) return { outcome, events };
  for await (const e of afterUndo({ ...deps, meals: notConfiguredMealAI }, outcome.result)) events.push(e);
  return { outcome, events };
}
