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
import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { changeSets, kitchens, mealIdeas, users } from "@/db/schema";
import type { Db, Queryable } from "@/db/client";
import { ApplyResult, type ApplyResult as ApplyResultT } from "@/contracts/apply-result";
import type { Msg, Quantity, ShoppingSource } from "@/contracts/common";
import type { Operation } from "@/contracts/operations";
import { ProposedChange } from "@/contracts/proposed-change";
import { MealIdea } from "@/contracts/stream";
import { msg } from "@/shared/messages";
import { listMembers, type KitchenScope } from "@/shared/membership";
import { appendEvents, eventExistsInStreams, loadChangeSetEvents, loadStream } from "@/shared/events/store";
import { kitchenStream, streamKind, userStream } from "@/shared/events/types";
import { loadProfiles, persistProfileEntities, replaceProfiles } from "@/shared/profile/store";
import { emptyProfileState, getProfileEntity, replayProfile } from "@/shared/profile/state";
import { computeAllergenFlags } from "@/shared/profile/allergens";
import { getKitchenEntity, replay } from "./state";
import { loadKitchenEntities, persistKitchenEntities, replaceKitchenProjections } from "./store";
import { planProposal, touchedKeys, type RevertPlan } from "./validate";
import { readKitchenState } from "./queries";

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
  const conflict = later
    .filter((l) => !l.revertedByChangeSetId && !(l.revertsChangeSetId && laterIds.has(l.revertsChangeSetId)))
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
      const stored: StoredResult = {
        changeSetId,
        newVersion,
        undoable: saved && !isUndo,
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

export interface NewMealIdea {
  ideaId?: string;
  name: string;
  why: string;
  uses: string[];
  missing: string[];
}

/**
 * Store a set of meal ideas so "Choose" / "Add that" points at a real idea (0005). Returns the
 * ideas as stream `idea` payloads, with allergen flags computed from current profiles.
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
  const out: MealIdea[] = [];
  for (const idea of set.ideas) {
    const ideaId = idea.ideaId ?? randomUUID();
    await db.insert(mealIdeas).values({
      id: ideaId,
      kitchenId: scope.kitchenId,
      setId,
      name: idea.name,
      why: idea.why,
      uses: idea.uses,
      missing: idea.missing,
      basedOnVersion: set.basedOnVersion,
      assistantMessageId: set.assistantMessageId ?? null,
      createdAt: now,
      createdBy: scope.userId,
    });
    out.push({
      ideaId,
      name: idea.name,
      why: idea.why,
      uses: idea.uses,
      missing: idea.missing,
      allergenFlags: computeAllergenFlags([idea.name, ...idea.missing], restrictions),
    });
  }
  return { setId, ideas: out };
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
