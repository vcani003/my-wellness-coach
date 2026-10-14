/**
 * Settings reads and the profile buttons (P2 b; 0015, 0017, 0019): users, membership and the
 * shared profile; the buttons go through the Kitchen domain's one write path.
 *
 * - `getSettingsView`: you, your kitchen and its members, your allergies and preferences with
 *   provenance (AI7: "Added by Vero" until you verify).
 * - `verifyRestriction` / `removeRestriction`: owner only (0019). Both build a one-step
 *   ProposedChange and go through the one write path, so they're receipts with Undo like any tap.
 */
import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { Db, Queryable } from "@/db/client";
import { kitchens, memberships, users } from "@/db/schema";
import type { SettingsRestriction, SettingsView } from "@/contracts/settings";
import { applyProposedChange, type ApplyOutcome } from "@/domains/kitchen/commands";
import { countAccounts, MAX_ACCOUNTS } from "@/lib/auth/invites";
import { actorRef, loadNames } from "@/shared/identity";
import { listMembers, type KitchenScope } from "@/shared/membership";
import { msg } from "@/shared/messages";
import { loadProfiles } from "@/shared/profile/store";

/** Your first kitchen (MVP 1: one per person, 0006), as `getSession` picks it. */
export async function firstKitchenId(db: Queryable, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ kitchenId: memberships.kitchenId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  return row?.kitchenId ?? null;
}

const KIND_ORDER = { allergy: 0, diet: 1 } as const;

export async function getSettingsView(db: Queryable, userId: string): Promise<SettingsView | null> {
  const [me] = await db.select({ id: users.id, name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  if (!me) return null;

  const kitchenId = await firstKitchenId(db, userId);
  const [kitchen] = kitchenId
    ? await db
        .select({ id: kitchens.id, name: kitchens.name, isTest: kitchens.isTest, version: kitchens.version })
        .from(kitchens)
        .where(eq(kitchens.id, kitchenId))
        .limit(1)
    : [];
  const members = kitchen ? await listMembers(db, kitchen.id) : [];
  // Who has set a passphrase (SU1 Rec): only whether, never the hash.
  const withPassphrase = members.length
    ? new Set(
        (
          await db
            .select({ id: users.id, hash: users.passphraseHash })
            .from(users)
            .where(inArray(users.id, members.map((m) => m.userId)))
        )
          .filter((u) => u.hash !== null)
          .map((u) => u.id),
      )
    : new Set<string>();

  const profile = await loadProfiles(db, [userId]);
  const restrictions = Object.values(profile.restrictions).sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.createdAt.localeCompare(b.createdAt),
  );
  const names = await loadNames(db, restrictions.map((r) => r.createdBy));

  return {
    me,
    kitchen: kitchen ?? null,
    members: members.map((m) => ({ id: m.userId, name: m.displayName, isYou: m.userId === userId, hasPassphrase: withPassphrase.has(m.userId) })),
    accountsFull: (await countAccounts(db)) >= MAX_ACCOUNTS,
    restrictions: restrictions.map(
      (r): SettingsRestriction => ({
        id: r.id,
        kind: r.kind,
        subject: r.subject.value,
        ...(r.note ? { note: r.note.value } : {}),
        addedBy: actorRef(r.createdBy, names),
        addedAt: r.createdAt,
        addedByYou: r.createdBy === userId,
        verified: Boolean(r.verifiedAt),
        ...(r.verifiedAt ? { verifiedAt: r.verifiedAt } : {}),
      }),
    ),
    preferences: Object.values(profile.preferences)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => ({ id: p.id, statement: p.statement.value, savedAt: p.createdAt })),
  };
}

async function currentVersion(db: Queryable, kitchenId: string): Promise<number> {
  const [k] = await db.select({ version: kitchens.version }).from(kitchens).where(eq(kitchens.id, kitchenId)).limit(1);
  return k?.version ?? 0;
}

const notFound = (): ApplyOutcome => ({ ok: false, error: { reason: msg("UNKNOWN_TARGET"), retryable: false } });

/** "Keep" on a restriction someone else added for you (AI7). Someone else's → NOT_ALLOWED. */
export async function verifyRestriction(db: Db, scope: KitchenScope, args: { tapId: string; restrictionId: string }): Promise<ApplyOutcome> {
  return applyProposedChange(db, scope, {
    proposalId: args.tapId,
    kitchenId: scope.kitchenId,
    basedOnVersion: await currentVersion(db, scope.kitchenId),
    source: { via: "button", action: "profile.restriction.verify" },
    operations: [{ opId: "verify", type: "profile.restriction.verify", target: { restrictionId: args.restrictionId } }],
  });
}

/**
 * "Remove" on one of your allergies or diets. Only its owner may (0019): the rule is the
 * validator's (NOT_ALLOWED), not this function's. Unknown, or not in this kitchen's profiles → UNKNOWN_TARGET.
 */
export async function removeRestriction(db: Db, scope: KitchenScope, args: { tapId: string; restrictionId: string }): Promise<ApplyOutcome> {
  const memberIds = (await listMembers(db, scope.kitchenId)).map((m) => m.userId);
  const r = (await loadProfiles(db, memberIds)).restrictions[args.restrictionId];
  if (!r) return notFound();
  return applyProposedChange(db, scope, {
    proposalId: args.tapId,
    kitchenId: scope.kitchenId,
    basedOnVersion: await currentVersion(db, scope.kitchenId),
    source: { via: "button", action: "profile.restriction.remove" },
    operations: [
      { opId: "remove", type: "profile.restriction.remove", forUserId: r.userId, fields: { kind: r.kind, subject: r.subject } },
    ],
  });
}
