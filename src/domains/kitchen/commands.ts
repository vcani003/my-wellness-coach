/**
 * Kitchen writes (backend-data.md §3, §6). There is one write path: `applyProposedChange`.
 *
 * In one transaction it:
 *  1. locks the kitchen row (`SELECT … FOR UPDATE`), so `seq` and `version` never collide;
 *  2. returns the stored result if this `proposalId` was already applied (idempotent retry);
 *  3. re-checks the proposal against the latest state: operations that name an ID changed
 *     since `basedOnVersion` are rejected with STALE_TARGET;
 *  4. validates each operation and saves the valid ones as events, updating the projections
 *     and the kitchen version in the same transaction.
 * Any failure rolls everything back: the kitchen is unchanged.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { changeSets, itemBatches, kitchens, mealIdeas, meals, users } from "@/db/schema";
import type { Db, Queryable } from "@/db/client";
import { ApplyResult, type ApplyResult as ApplyResultT } from "@/contracts/apply-result";
import type { Msg, Quantity, ShoppingSource } from "@/contracts/common";
import type { Operation } from "@/contracts/operations";
import { ProposedChange } from "@/contracts/proposed-change";
import type { MealIdea, UpdateKitchenPrompt } from "@/contracts/stream";
import { standardName } from "@/shared/text";
import { msg } from "@/shared/messages";
import { listMembers, type KitchenScope } from "@/shared/membership";
import { appendEvents, eventExistsInStreams, loadChangeSetEvents, loadStream } from "@/shared/events/store";
import { kitchenStream, streamKind, userStream } from "@/shared/events/types";
import { loadProfiles, persistProfileEntities, replaceProfiles } from "@/shared/profile/store";
import { emptyProfileState, getProfileEntity, replayProfile } from "@/shared/profile/state";
import { getKitchenEntity, replay } from "./state";
import { loadKitchenEntities, persistKitchenEntities, replaceKitchenProjections } from "./store";
import { SOFT_SUMMARY_CODES, planProposal, touchedKeys, type RevertPlan } from "./validate";
import { getRecipe, ideaFlags, itemNames, readKitchenState } from "./queries";
import { PLACES_SORT_ACTION, placesSortProposalId, planPlacesSort, sortedReply, type PlannedMove } from "./sort-places";

export type ApplyOutcome =
  | { ok: true; result: ApplyResultT }
  | { ok: false; error: { reason: Msg; retryable: boolean } };

export interface ApplyOptions {
  /** The chat message's text, for evidence and paste checks (required to save profile facts via chat). */
  messageText?: string;
  /** Injected clock for tests. */
  now?: Date;
}

type StoredResult = Omit<ApplyResultT, "state">;

async function prepareRevert(tx: Queryable, scope: KitchenScope, changeSetId: string): Promise<RevertPlan> {
  const [cs] = await tx
    .select()
    .from(changeSets)
    .where(and(eq(changeSets.id, changeSetId), eq(changeSets.kitchenId, scope.kitchenId)))
    .limit(1);
  if (!cs || cs.version === null) return { ok: false, code: "UNKNOWN_TARGET" };
  // Undo covers only your own changes (H3, 0017).
  if (cs.actorId !== scope.userId) return { ok: false, code: "NOT_ALLOWED" };
  if (cs.revertsChangeSetId) return { ok: false, code: "UNDO_OF_UNDO" };
  if (cs.revertedByChangeSetId) return { ok: false, code: "ALREADY_UNDONE" };

  // Refused if a later change set touched the same things. A later change that was itself
  // undone (and that undo) no longer counts.
  const later = await tx
    .select()
    .from(changeSets)
    .where(and(eq(changeSets.kitchenId, scope.kitchenId), isNotNull(changeSets.version), gt(changeSets.version, cs.version)));
  const laterIds = new Set(later.map((l) => l.id));
  const mine = new Set(cs.touched);
  // A soft change ("Still have them", 0025) never blocks undoing the purchase it answered.
  const isSoft = (l: (typeof later)[number]) => {
    const applied = (l.result as StoredResult | null)?.applied ?? [];
    return applied.length > 0 && applied.every((a) => SOFT_SUMMARY_CODES.has(a.summary.code));
  };
  const conflict = later
    .filter((l) => !l.revertedByChangeSetId && !(l.revertsChangeSetId && laterIds.has(l.revertsChangeSetId)))
    .filter((l) => !isSoft(l))
    .some((l) => l.touched.some((key) => mine.has(key)));
  if (conflict) return { ok: false, code: "UNDO_CONFLICT" };

  // Each touched entity goes back to its value just before the change set, per stream.
  const csEvents = await loadChangeSetEvents(tx, cs.id);
  const restoreByStream: Record<string, Record<string, unknown>> = {};
  for (const stream of new Set(csEvents.map((e) => e.stream))) {
    const own = csEvents.filter((e) => e.stream === stream);
    const firstSeq = Math.min(...own.map((e) => e.seq));
    const before = (await loadStream(tx, stream)).filter((e) => e.seq < firstSeq);
    const keys = new Set(own.flatMap(touchedKeys));
    const restore: Record<string, unknown> = {};
    if (streamKind(stream) === "kitchen") {
      const state = replay(before);
      for (const key of keys) restore[key] = getKitchenEntity(state, key);
    } else {
      const state = replayProfile(before, emptyProfileState());
      for (const key of keys) restore[key] = getProfileEntity(state, key);
    }
    restoreByStream[stream] = restore;
  }
  return { ok: true, restoreByStream };
}

/**
 * Validate and apply a ProposedChange. Never throws: a malformed proposal, a mismatched kitchen
 * or a database failure come back as `{ ok: false }`, with nothing changed.
 */
export async function applyProposedChange(
  db: Db,
  scope: KitchenScope,
  input: unknown,
  options: ApplyOptions = {},
): Promise<ApplyOutcome> {
  const parsed = ProposedChange.safeParse(input);
  if (!parsed.success) {
    console.error("kitchen.apply: invalid proposal", { issues: parsed.error.issues });
    return { ok: false, error: { reason: msg("INVALID_PROPOSAL"), retryable: false } };
  }
  const proposal = parsed.data;
  if (proposal.kitchenId !== scope.kitchenId) {
    return { ok: false, error: { reason: msg("NOT_ALLOWED"), retryable: false } };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [kitchen] = await tx
        .select({ version: kitchens.version })
        .from(kitchens)
        .where(eq(kitchens.id, scope.kitchenId))
        .for("update");
      if (!kitchen) throw new Error("kitchen vanished");

      const [existing] = await tx
        .select({ result: changeSets.result })
        .from(changeSets)
        .where(and(eq(changeSets.kitchenId, scope.kitchenId), eq(changeSets.proposalId, proposal.proposalId)))
        .limit(1);
      if (existing) {
        return { ...(existing.result as StoredResult), state: await readKitchenState(tx, scope.kitchenId) };
      }

      const members = await listMembers(tx, scope.kitchenId);
      const memberIds = members.map((m) => m.userId);
      const [entities, profiles] = await Promise.all([
        loadKitchenEntities(tx, scope.kitchenId),
        loadProfiles(tx, memberIds),
      ]);

      // Re-check against the latest state: what changed since the proposal's version?
      const staleKeys = new Set<string>();
      if (proposal.basedOnVersion < kitchen.version) {
        const since = await tx
          .select({ touched: changeSets.touched })
          .from(changeSets)
          .where(and(eq(changeSets.kitchenId, scope.kitchenId), gt(changeSets.version, proposal.basedOnVersion)));
        for (const row of since) for (const key of row.touched) staleKeys.add(key);
      }

      const ideaIds = proposal.operations.flatMap((op) =>
        op.type === "meal.choose" && "ideaId" in op.target ? [op.target.ideaId] : [],
      );
      const ideaRows = ideaIds.length
        ? await tx
            .select({ id: mealIdeas.id, name: mealIdeas.name })
            .from(mealIdeas)
            .where(and(eq(mealIdeas.kitchenId, scope.kitchenId), inArray(mealIdeas.id, ideaIds)))
        : [];

      const reverts = new Map<string, RevertPlan>();
      for (const op of proposal.operations) {
        if (op.type === "changeset.revert" && !reverts.has(op.target.changeSetId)) {
          reverts.set(op.target.changeSetId, await prepareRevert(tx, scope, op.target.changeSetId));
        }
      }

      const knownEventIds = new Set<string>();
      const streams = [kitchenStream(scope.kitchenId), ...memberIds.map(userStream)];
      for (const op of proposal.operations) {
        if (op.corrects && (await eventExistsInStreams(tx, op.corrects, streams))) knownEventIds.add(op.corrects);
      }

      const changeSetId = randomUUID();
      const now = (options.now ?? new Date()).toISOString();
      const plan = planProposal(proposal, {
        kitchenId: scope.kitchenId,
        actorId: scope.userId,
        via: proposal.source.via,
        now,
        changeSetId,
        source: proposal.source,
        messageText: options.messageText,
        members: new Map(members.map((m) => [m.userId, m.displayName])),
        kitchen: entities,
        profiles,
        staleKeys,
        ideas: new Map(ideaRows.map((r) => [r.id, { name: r.name }])),
        reverts,
        knownEventIds,
        newId: randomUUID,
      });

      const saved = plan.events.length > 0;
      const newVersion = saved ? kitchen.version + 1 : kitchen.version;
      if (saved) {
        // Lock profile streams too (kitchen first, then users by id: one order, no deadlocks).
        const profileUsers = [...new Set(plan.events.filter((e) => streamKind(e.stream) === "user").map((e) => e.stream.slice(5)))].sort();
        if (profileUsers.length) {
          await tx.select({ id: users.id }).from(users).where(inArray(users.id, profileUsers)).orderBy(asc(users.id)).for("update");
        }
        await appendEvents(tx, plan.events);
        const kitchenKeys = plan.touched.filter((k) => !k.startsWith("restriction:") && !k.startsWith("preference:"));
        const profileKeys = plan.touched.filter((k) => k.startsWith("restriction:") || k.startsWith("preference:"));
        await persistKitchenEntities(tx, scope.kitchenId, plan.kitchen, kitchenKeys);
        await persistProfileEntities(tx, plan.profiles, profileKeys);
        await tx.update(kitchens).set({ version: newVersion }).where(eq(kitchens.id, scope.kitchenId));
      }

      const isUndo = proposal.operations.some((op) => op.type === "changeset.revert") && plan.reverted.length > 0;
      const softOnly = plan.applied.length > 0 && plan.applied.every((a) => SOFT_SUMMARY_CODES.has(a.summary.code));
      const stored: StoredResult = {
        changeSetId,
        newVersion,
        undoable: saved && !isUndo && !softOnly,
        ...(saved && isUndo ? { undoBlockedReason: msg("UNDO_OF_UNDO") } : {}),
        applied: plan.applied,
        rejected: plan.rejected,
      };
      await tx.insert(changeSets).values({
        id: changeSetId,
        kitchenId: scope.kitchenId,
        proposalId: proposal.proposalId,
        actorId: scope.userId,
        via: proposal.source.via,
        version: saved ? newVersion : null,
        touched: plan.touched,
        summaries: plan.applied.filter((a) => a.refs.length > 0).map((a) => a.summary),
        result: stored,
        revertsChangeSetId: plan.reverted[0] ?? null,
        revertedByChangeSetId: null,
        createdAt: new Date(now),
      });
      if (plan.reverted.length) {
        await tx
          .update(changeSets)
          .set({ revertedByChangeSetId: changeSetId })
          .where(and(eq(changeSets.kitchenId, scope.kitchenId), inArray(changeSets.id, plan.reverted)));
      }
      return { ...stored, state: await readKitchenState(tx, scope.kitchenId) };
    });

    const checked = ApplyResult.safeParse(result);
    if (!checked.success) {
      // Saved, but the result doesn't match the contract: a bug. Log it; still report what saved.
      console.error("kitchen.apply: result failed the contract", { issues: checked.error.issues });
    }
    return { ok: true, result };
  } catch (error) {
    console.error("kitchen.apply: failed, nothing saved", { proposalId: proposal.proposalId, error });
    return { ok: false, error: { reason: msg("SAVE_FAILED"), retryable: true } };
  }
}

/** Undo a change set (a server action builds this one-operation proposal). */
export function undo(db: Db, scope: KitchenScope, args: { changeSetId: string; tapId: string; basedOnVersion: number }) {
  return applyProposedChange(db, scope, {
    proposalId: args.tapId,
    kitchenId: scope.kitchenId,
    basedOnVersion: args.basedOnVersion,
    source: { via: "button", action: "undo" },
    operations: [{ opId: "undo", type: "changeset.revert", target: { changeSetId: args.changeSetId } }],
  });
}

// ─── Sorting "Not sure where" once (0041) ─────────────────────────────────────────────

export { placesSortProposalId } from "./sort-places";

export type PlacesSortOutcome =
  | { ran: false }
  | {
      ran: true;
      result: ApplyResultT;
      moves: PlannedMove[];
      /** Open batches still with no place (genuinely ambiguous, or past the move limit). */
      unplaced: number;
      /** The one-line chat message ("I sorted 9 items …"); "" when nothing moved. */
      reply: string;
      /** True when this caller's load made the change set (so the receipt and Undo are theirs, 0017). */
      mine: boolean;
    };

/**
 * Put this kitchen's unplaced items where they usually go, **once per kitchen** (0041; see
 * `sort-places.ts`): one change set with the fixed key `placesSortProposalId`, which is also the
 * "done" mark, so it never runs again (not after an Undo either) and two loads at once apply it
 * once. Cheap when there's nothing to do: one small query, plus one while unplaced items remain.
 * Throws only on a database failure (the caller isolates it, 0018).
 */
export async function applyPlacesSortOnce(db: Db, scope: KitchenScope, options: { now?: Date } = {}): Promise<PlacesSortOutcome> {
  const [unplacedRow] = await db
    .select({ id: itemBatches.id })
    .from(itemBatches)
    .where(and(eq(itemBatches.kitchenId, scope.kitchenId), isNull(itemBatches.closedAt), isNull(itemBatches.location)))
    .limit(1);
  if (!unplacedRow) return { ran: false };
  const proposalId = placesSortProposalId(scope.kitchenId);
  const done = () =>
    db
      .select({ actorId: changeSets.actorId })
      .from(changeSets)
      .where(and(eq(changeSets.kitchenId, scope.kitchenId), eq(changeSets.proposalId, proposalId)))
      .limit(1);
  if ((await done()).length) return { ran: false };

  const [kitchen] = await db.select({ version: kitchens.version }).from(kitchens).where(eq(kitchens.id, scope.kitchenId));
  if (!kitchen) return { ran: false };
  const { moves, unplaced } = planPlacesSort(await loadKitchenEntities(db, scope.kitchenId));
  const operations: Operation[] = moves.map((m, n) => ({
    opId: `sort-${n + 1}`,
    type: "item.update",
    target: { itemId: m.itemId, batchId: m.batchId },
    fields: { location: m.location },
  }));
  // Even with nothing to move, the (empty) change set is saved: it's the "already sorted" mark.
  const outcome = await applyProposedChange(
    db,
    scope,
    { proposalId, kitchenId: scope.kitchenId, basedOnVersion: kitchen.version, source: { via: "button", action: PLACES_SORT_ACTION }, operations },
    options.now ? { now: options.now } : {},
  );
  if (!outcome.ok) return { ran: false };
  const appliedIds = new Set(outcome.result.applied.map((a) => a.opId));
  const applied = moves.filter((_, n) => appliedIds.has(`sort-${n + 1}`));
  const left = unplaced + (moves.length - applied.length);
  const [row] = await done();
  return {
    ran: true,
    result: outcome.result,
    moves: applied,
    unplaced: left,
    reply: applied.length ? sortedReply(applied, left) : "",
    mine: row?.actorId === scope.userId,
  };
}

// ─── Shopping list buttons (0027) ─────────────────────────────────────────────────────
// Each builds a one-step ProposedChange and goes through the same validate → apply path as chat.

/** What every button command needs: `tapId` makes a double tap harmless. */
export interface TapArgs {
  tapId: string;
  basedOnVersion: number;
}

function tap(db: Db, scope: KitchenScope, args: TapArgs, action: string, operations: Operation[]) {
  return applyProposedChange(db, scope, {
    proposalId: args.tapId,
    kitchenId: scope.kitchenId,
    basedOnVersion: args.basedOnVersion,
    source: { via: "button", action },
    operations,
  });
}

const said = <T>(value: T) => ({ value, basis: "said" as const, confidence: "high" as const });

// ─── Batches (0025) ───────────────────────────────────────────────────────────────────

/** "Those are gone" on a receipt's batch choice: these batches of one item close, one change set. */
export function closeBatches(db: Db, scope: KitchenScope, args: TapArgs & { itemId: string; batchIds: string[] }) {
  return tap(
    db,
    scope,
    args,
    "batch.close",
    [...new Set(args.batchIds)].map((batchId, n) => ({
      opId: `close-${n + 1}`,
      type: "item.batch.close",
      target: { itemId: args.itemId, batchId },
    })),
  );
}

/** "Still have them": the older batches stay, and the choice is dismissed (a soft change). */
export function keepBatches(db: Db, scope: KitchenScope, args: TapArgs & { itemId: string; batchIds: string[] }) {
  return tap(
    db,
    scope,
    args,
    "batch.keep",
    [...new Set(args.batchIds)].map((batchId, n) => ({
      opId: `keep-${n + 1}`,
      type: "item.batch.keep",
      target: { itemId: args.itemId, batchId },
    })),
  );
}

/** One-tap adds: a staples answer, a recipe's "Need" items, the Out/Low offer (SL3). Merges like chat. */
export function addShoppingItems(
  db: Db,
  scope: KitchenScope,
  args: TapArgs & { source: ShoppingSource; items: { name: string; quantity?: Quantity; store?: string }[] },
) {
  return tap(
    db,
    scope,
    args,
    "shopping.add",
    args.items.map((i, n) => ({
      opId: `add-${n + 1}`,
      type: "shopping.add",
      source: args.source,
      fields: {
        name: said(i.name),
        ...(i.quantity ? { quantity: said(i.quantity) } : {}),
        ...(i.store ? { store: said(i.store) } : {}),
      },
    })),
  );
}

export function tickShoppingItem(db: Db, scope: KitchenScope, args: TapArgs & { shoppingItemId: string; ticked: boolean }) {
  return tap(db, scope, args, args.ticked ? "shopping.tick" : "shopping.untick", [
    { opId: "tick", type: "shopping.tick", target: { shoppingItemId: args.shoppingItemId }, ticked: args.ticked },
  ]);
}

export function removeShoppingItem(db: Db, scope: KitchenScope, args: TapArgs & { shoppingItemId: string }) {
  return tap(db, scope, args, "shopping.remove", [
    { opId: "remove", type: "shopping.remove", target: { shoppingItemId: args.shoppingItemId } },
  ]);
}

/** "Done shopping" (SL2): the chosen ticked items go into the kitchen; unchosen ticked items stay. */
export function doneShopping(
  db: Db,
  scope: KitchenScope,
  args: TapArgs & { items: { shoppingItemId: string; fields?: Extract<Operation, { type: "shopping.done" }>["items"][number]["fields"] }[] },
) {
  return tap(db, scope, args, "shopping.done", [{ opId: "done", type: "shopping.done", items: args.items }]);
}

/**
 * "Do later" on the Done-shopping sheet (ux.md §10): the chosen list items wait in To review as one
 * "N items to add · Shopping list" card. The list itself doesn't change.
 */
export function queueShoppingReview(db: Db, scope: KitchenScope, args: TapArgs & { shoppingItemIds: string[] }) {
  return tap(db, scope, args, "review.queue", [
    {
      opId: "queue",
      type: "review.queue",
      kind: "add-to-kitchen",
      items: args.shoppingItemIds.map((shoppingItemId) => ({ shoppingItemId })),
    },
  ]);
}

/**
 * Close a To review card from its sheet. For a shopping-list card, Add (`done`) moves the chosen
 * items into the kitchen with "Done shopping"'s rules, in one change set (one Undo); Skip changes nothing else.
 */
export function resolveReview(
  db: Db,
  scope: KitchenScope,
  args: TapArgs & { reviewId: string; outcome: "done" | "skipped"; shoppingItemIds?: string[] },
) {
  return tap(db, scope, args, "review.resolve", [
    {
      opId: "resolve",
      type: "review.resolve",
      target: { reviewId: args.reviewId },
      outcome: args.outcome,
      ...(args.shoppingItemIds ? { items: args.shoppingItemIds.map((shoppingItemId) => ({ shoppingItemId })) } : {}),
    },
  ]);
}

// ─── Meal buttons (0005, 0013) ────────────────────────────────────────────────────────
// Same one write path as chat. `tapId` is the idempotency key, so a double tap is harmless.

/** Choose an idea card (creates the meal, status "chosen") or re-choose a live meal. */
export function chooseMealTap(db: Db, scope: KitchenScope, args: TapArgs & ({ ideaId: string } | { mealId: string })) {
  const target = "ideaId" in args ? { ideaId: args.ideaId } : { mealId: args.mealId };
  return tap(db, scope, args, "meal.choose", [{ opId: "choose", type: "meal.choose", target }]);
}

export function planMeal(db: Db, scope: KitchenScope, args: TapArgs & { mealId: string }) {
  return tap(db, scope, args, "meal.plan", [{ opId: "plan", type: "meal.plan", target: { mealId: args.mealId } }]);
}

/**
 * Start cooking, cancel, or "I made it" (done). Done records the recipe's in-kitchen ingredients
 * as used in this meal, amount unknown (0013); the refs of kind `item` are what "Update your
 * kitchen" asks about (see `updateKitchenPrompt`).
 */
export function moveMeal(db: Db, scope: KitchenScope, args: TapArgs & { mealId: string; to: "cooking" | "cancelled" | "done" }) {
  return tap(db, scope, args, `meal.${args.to}`, [
    { opId: args.to, type: "meal.transition", target: { mealId: args.mealId }, to: args.to },
  ]);
}

/** Shared recipe-checklist ticks (M6, 0013): the other member sees who ticked. */
export function tickIngredient(db: Db, scope: KitchenScope, args: TapArgs & { mealId: string; ingredient: string; ticked: boolean }) {
  return tap(db, scope, args, args.ticked ? "checklist.tick" : "checklist.untick", [
    { opId: "tick", type: "checklist.tick", target: { mealId: args.mealId }, ingredient: args.ingredient, ticked: args.ticked },
  ]);
}

export type AfterCookingStock = "have" | "low" | "out";

/**
 * "Update your kitchen" → Done (0013, M8): Running low / Out become `item.use` with that stock;
 * Still have some changes nothing. The optional note is saved on the meal as said. From a To
 * review card, pass its `reviewId` and the card closes in the same change set (one Undo for all).
 */
export function updateKitchenAfterCooking(
  db: Db,
  scope: KitchenScope,
  args: TapArgs & { mealId: string; items: { itemId: string; stock: AfterCookingStock }[]; note?: string; reviewId?: string },
) {
  const note = args.note?.trim();
  const ops: Operation[] = [
    ...(note ? [{ opId: "note", type: "meal.transition" as const, target: { mealId: args.mealId }, to: "done" as const, note }] : []),
    ...args.items
      .filter((i) => i.stock !== "have")
      .map((i, n) => ({
        opId: `use-${n + 1}`,
        type: "item.use" as const,
        target: { itemId: i.itemId },
        fields: { stock: said(i.stock as "low" | "out") },
      })),
    ...(args.reviewId
      ? [{ opId: "resolve", type: "review.resolve" as const, target: { reviewId: args.reviewId }, outcome: "done" as const }]
      : []),
  ];
  return tap(db, scope, args, "after-cooking.done", ops);
}

/** "Do later" on "Update your kitchen": the card waits in To review (0013). */
export function queueAfterCooking(db: Db, scope: KitchenScope, args: TapArgs & { mealId: string; items: { itemId: string; name: string }[] }) {
  return tap(db, scope, args, "review.queue", [
    { opId: "queue", type: "review.queue", kind: "after-cooking", mealId: args.mealId, items: args.items },
  ]);
}

/**
 * "Add Need items to shopping list" (0027): the recipe's ingredients that aren't in the kitchen
 * and aren't assumed basics, merged into the list like any add (source `recipe`). `names` limits
 * it to the ones chosen on screen. No recipe → UNKNOWN_TARGET.
 */
export async function addRecipeNeedsToShoppingList(
  db: Db,
  scope: KitchenScope,
  args: TapArgs & { mealId: string; names?: string[] },
): Promise<ApplyOutcome> {
  try {
    const recipe = await getRecipe(db, scope, args.mealId);
    if (!recipe) return { ok: false, error: { reason: msg("UNKNOWN_TARGET"), retryable: false } };
    const chosen = args.names ? new Set(args.names.map(standardName)) : null;
    const needs = recipe.ingredients
      .filter((i) => !i.item && !i.basic)
      .filter((i) => !chosen || chosen.has(standardName(i.name)))
      .slice(0, 50);
    return addShoppingItems(db, scope, { ...args, source: "recipe", items: needs.map((i) => ({ name: i.name })) });
  } catch (error) {
    console.error("kitchen.apply: couldn't add recipe needs", { error });
    return { ok: false, error: { reason: msg("SAVE_FAILED"), retryable: true } };
  }
}

/**
 * What "Update your kitchen" asks about after a meal is marked done: the kitchen items the done
 * transition recorded as used (its `item` refs), with their current names. Null if `opId` didn't
 * apply. Shared by chat (the `update-kitchen` stream event) and the "I made it" button.
 */
export async function updateKitchenPrompt(
  db: Queryable,
  scope: KitchenScope,
  result: ApplyResultT,
  mealId: string,
): Promise<UpdateKitchenPrompt | null> {
  const op = result.applied.find((a) => a.refs.some((r) => r.kind === "meal" && r.id === mealId) && a.summary.code === "MEAL_STATUS" && a.summary.params.status === "done");
  if (!op) return null;
  const [meal] = await db
    .select({ title: meals.title })
    .from(meals)
    .where(and(eq(meals.kitchenId, scope.kitchenId), eq(meals.id, mealId)))
    .limit(1);
  const ids = op.refs.filter((r) => r.kind === "item").map((r) => r.id);
  const names = await itemNames(db, scope.kitchenId, ids);
  return {
    mealId,
    title: meal?.title ?? "",
    items: ids.flatMap((id) => (names.has(id) ? [{ itemId: id, name: names.get(id)! }] : [])),
  };
}

export interface NewMealIdea {
  ideaId?: string;
  name: string;
  why: string;
  /** Kitchen item IDs; IDs that aren't in this kitchen are dropped. */
  uses: string[];
  missing: string[];
  /** Card order within the set. Default: its index in `ideas`. */
  position?: number;
}

/**
 * Store a set of meal ideas so "Choose" / "the second one" / "Add that" points at a real idea
 * (0005, 0013). Returns the ideas as stream `idea` payloads, with allergen flags computed from
 * current profiles over the name, the kitchen items used (by name) and the missing ones (0019).
 * Ideas can be recorded one at a time as they stream: pass the same `setId` and each `position`.
 */
export async function recordMealIdeas(
  db: Queryable,
  scope: KitchenScope,
  set: { setId?: string; basedOnVersion: number; assistantMessageId?: string; ideas: NewMealIdea[] },
): Promise<{ setId: string; ideas: MealIdea[] }> {
  const setId = set.setId ?? randomUUID();
  const now = new Date();
  const members = await listMembers(db, scope.kitchenId);
  const profiles = await loadProfiles(
    db,
    members.map((m) => m.userId),
  );
  const restrictions = Object.values(profiles.restrictions);
  const names = await itemNames(db, scope.kitchenId, set.ideas.flatMap((i) => i.uses));
  const out: MealIdea[] = [];
  for (const [index, idea] of set.ideas.entries()) {
    const ideaId = idea.ideaId ?? randomUUID();
    const uses = [...new Set(idea.uses)].filter((id) => names.has(id));
    await db.insert(mealIdeas).values({
      id: ideaId,
      kitchenId: scope.kitchenId,
      setId,
      name: idea.name,
      why: idea.why,
      uses,
      missing: idea.missing,
      basedOnVersion: set.basedOnVersion,
      assistantMessageId: set.assistantMessageId ?? null,
      position: idea.position ?? index,
      createdAt: now,
      createdBy: scope.userId,
    });
    out.push({
      ideaId,
      name: idea.name,
      why: idea.why,
      uses,
      missing: idea.missing,
      allergenFlags: ideaFlags({ name: idea.name, uses, missing: idea.missing }, names, restrictions),
    });
  }
  return { setId, ideas: out };
}

/**
 * Remove an idea set that failed part-way (a mid-stream refusal, ai.md): its cards can no longer
 * be chosen. Ideas aren't kitchen events, so this is a plain delete. A meal already chosen from
 * one keeps working (it doesn't need the idea row).
 */
export async function dropIdeaSet(db: Queryable, scope: KitchenScope, setId: string): Promise<void> {
  await db.delete(mealIdeas).where(and(eq(mealIdeas.kitchenId, scope.kitchenId), eq(mealIdeas.setId, setId)));
}

/**
 * Rebuild a kitchen's projections (and its members' profiles) from the event log, replacing
 * whatever is there. Used when a projection disagrees with its events, or after a fix to `apply`.
 */
export async function rebuildProjections(db: Db, scope: KitchenScope): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.select({ id: kitchens.id }).from(kitchens).where(eq(kitchens.id, scope.kitchenId)).for("update");
    const kitchen = replay(await loadStream(tx, kitchenStream(scope.kitchenId)));
    await replaceKitchenProjections(tx, scope.kitchenId, kitchen);
    const memberIds = (await listMembers(tx, scope.kitchenId)).map((m) => m.userId);
    let profiles = emptyProfileState();
    for (const id of memberIds) profiles = replayProfile(await loadStream(tx, userStream(id)), profiles);
    await replaceProfiles(tx, memberIds, profiles);
  });
}
