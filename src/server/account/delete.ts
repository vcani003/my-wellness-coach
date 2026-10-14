/**
 * "Delete my data" (D1, 0015; backend-data.md §7). The one deliberate exception to "never delete".
 *
 * In one transaction:
 * - **Removed:** your account, your chats (every kitchen), your profile (allergies, diets,
 *   preferences and their `user:<id>` event stream), the meal-idea cards you were shown, and your
 *   rate-limit counters.
 * - **Kept:** the kitchen events and change sets you made in a kitchen someone else is still in.
 *   They read back as "a former member" (`deleted_users` + `actorRef`), as do current-state rows
 *   you created or last changed. Other members' change sets that saved *your* profile facts (Vero
 *   adding your allergy) keep their place, but their summary no longer names the fact.
 * - **A kitchen is deleted** (with its events) only when you're its last member.
 * - Your ID goes into `deleted_users`, so it can't be recreated or unlocked again (interim auth).
 *
 * Only kitchens you're a member of are touched, so a real person never touches a test kitchen's
 * data or the other way round; a tester account (0021) is additionally refused if it somehow
 * belongs to a real kitchen. Locks: kitchens first, then the user row, the same order as apply.
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import {
  changeSets,
  deletedUsers,
  events,
  kitchens,
  mealIdeas,
  memberships,
  profilePreferences,
  profileRestrictions,
  rateLimits,
  users,
} from "@/db/schema";
import type { ApplyResult, Msg } from "@/contracts";
import { kitchenStream, userStream } from "@/shared/events/types";
import { msg } from "@/shared/messages";

export type DeleteOutcome =
  | { ok: true; deletedKitchenIds: string[]; keptKitchenIds: string[] }
  | { ok: false; reason: "not_found" | "failed" };

type StoredResult = Omit<ApplyResult, "state">;

export async function deleteMyData(db: Db, userId: string, now: Date = new Date()): Promise<DeleteOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const mine = await tx.select({ kitchenId: memberships.kitchenId }).from(memberships).where(eq(memberships.userId, userId));
      const kitchenIds = [...new Set(mine.map((m) => m.kitchenId))].sort();
      const locked = kitchenIds.length
        ? await tx
            .select({ id: kitchens.id, isTest: kitchens.isTest })
            .from(kitchens)
            .where(inArray(kitchens.id, kitchenIds))
            .orderBy(kitchens.id)
            .for("update")
        : [];
      const [user] = await tx
        .select({ id: users.id, isTest: users.isTest })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!user) return { ok: false as const, reason: "not_found" as const };
      if (user.isTest && locked.some((k) => !k.isTest)) {
        throw new Error("refusing: a tester account belongs to a real kitchen");
      }

      // Who else is in each kitchen?
      const others = kitchenIds.length
        ? await tx
            .select({ kitchenId: memberships.kitchenId, userId: memberships.userId })
            .from(memberships)
            .where(inArray(memberships.kitchenId, kitchenIds))
        : [];
      const shared = new Set(others.filter((m) => m.userId !== userId).map((m) => m.kitchenId));
      const deletedKitchenIds = kitchenIds.filter((id) => !shared.has(id));
      const keptKitchenIds = kitchenIds.filter((id) => shared.has(id));

      // Your profile facts, by every ID they ever had (so other people's summaries can drop them).
      const profileEvents = await tx.select({ payload: events.payload }).from(events).where(eq(events.stream, userStream(userId)));
      const profileKeys = new Set<string>();
      for (const e of profileEvents) {
        const p = e.payload as { restrictionId?: unknown; preferenceId?: unknown };
        if (typeof p.restrictionId === "string") profileKeys.add(`restriction:${p.restrictionId}`);
        if (typeof p.preferenceId === "string") profileKeys.add(`preference:${p.preferenceId}`);
      }

      // 1. Kitchens where you're the last member go entirely: rows cascade; events have no FK.
      if (deletedKitchenIds.length) {
        await tx.delete(events).where(inArray(events.stream, deletedKitchenIds.map(kitchenStream)));
        await tx.delete(kitchens).where(inArray(kitchens.id, deletedKitchenIds));
      }

      // 2. Shared kitchens stay. Your meal-idea cards were part of your private chat.
      if (keptKitchenIds.length) {
        await tx.delete(mealIdeas).where(and(inArray(mealIdeas.kitchenId, keptKitchenIds), eq(mealIdeas.createdBy, userId)));
        if (profileKeys.size) await scrubProfileSummaries(tx, keptKitchenIds, profileKeys);
      }

      // 3. Your profile.
      await tx.delete(events).where(eq(events.stream, userStream(userId)));
      await tx.delete(profileRestrictions).where(eq(profileRestrictions.userId, userId));
      await tx.delete(profilePreferences).where(eq(profilePreferences.userId, userId));
      await tx.delete(rateLimits).where(inArray(rateLimits.key, [`chat:hour:${userId}`, `chat:day:${userId}`]));

      // 4. The account: memberships and chats cascade. The tombstone first: the trigger then
      //    stops anything recreating this ID.
      await tx.insert(deletedUsers).values({ id: userId, deletedAt: now }).onConflictDoNothing();
      await tx.delete(users).where(eq(users.id, userId));

      return { ok: true as const, deletedKitchenIds, keptKitchenIds };
    });
  } catch (error) {
    console.error("account.delete: failed, nothing deleted", { error });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Change sets in shared kitchens that saved one of your profile facts (e.g. Vero saving your
 * allergy) keep their place in history, but their summary no longer repeats the fact.
 * Change sets are a ledger, not events, so rewriting a summary is allowed.
 */
async function scrubProfileSummaries(tx: Tx, kitchenIds: string[], keys: Set<string>) {
  const rows = await tx
    .select({ id: changeSets.id, touched: changeSets.touched, result: changeSets.result })
    .from(changeSets)
    .where(inArray(changeSets.kitchenId, kitchenIds));
  const ids = new Set([...keys].map((k) => k.slice(k.indexOf(":") + 1)));
  const replacement: Msg = msg("FORMER_MEMBER_PROFILE");
  for (const row of rows) {
    if (!row.touched.some((k) => keys.has(k))) continue;
    const result = row.result as StoredResult;
    const applied = result.applied.map((a) =>
      a.refs.some((r) => r.kind === "profile" && ids.has(r.id)) ? { ...a, summary: replacement } : a,
    );
    await tx
      .update(changeSets)
      .set({ result: { ...result, applied }, summaries: applied.filter((a) => a.refs.length > 0).map((a) => a.summary) })
      .where(eq(changeSets.id, row.id));
  }
}
