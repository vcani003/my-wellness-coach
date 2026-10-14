/**
 * "Download my data" (0015; backend-data.md §7): one JSON file with
 * - you: your account;
 * - your profile: allergies, diets and preferences with provenance (who added each, verified),
 *   plus your profile's event history;
 * - your chats, in every kitchen (only yours: other members' chats are never included, H2);
 * - the meal-idea cards you were shown;
 * - each kitchen you belong to: its members, current state and full event history (shared data).
 *
 * Every kitchen is read through `requireMember`, so the file holds nothing you can't already see.
 */
import "server-only";
import { asc, eq } from "drizzle-orm";
import type { Queryable } from "@/db/client";
import { chatMessages, events, kitchens, mealIdeas, memberships, users } from "@/db/schema";
import { EXPORT_FORMAT, EXPORT_VERSION } from "@/contracts/settings";
import { getKitchenState } from "@/domains/kitchen/queries";
import { rowToEvent } from "@/shared/events/store";
import { kitchenStream, userStream } from "@/shared/events/types";
import { actorRef, loadNames } from "@/shared/identity";
import { listMembers, requireMember } from "@/shared/membership";
import { loadProfiles } from "@/shared/profile/store";

async function streamEvents(db: Queryable, stream: string) {
  const rows = await db.select().from(events).where(eq(events.stream, stream)).orderBy(asc(events.seq));
  return rows.map(rowToEvent);
}

/** Null when the user doesn't exist (e.g. just deleted). */
export async function buildExport(db: Queryable, userId: string, now: Date = new Date()) {
  const [me] = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!me) return null;

  const profile = await loadProfiles(db, [userId]);
  const restrictions = Object.values(profile.restrictions);
  const preferences = Object.values(profile.preferences);
  const names = await loadNames(db, [...restrictions, ...preferences].flatMap((r) => [r.createdBy, r.updatedBy]));

  const chats = await db
    .select({
      id: chatMessages.id,
      kitchenId: chatMessages.kitchenId,
      role: chatMessages.role,
      text: chatMessages.text,
      clientMessageId: chatMessages.clientMessageId,
      changeSetId: chatMessages.changeSetId,
      receipt: chatMessages.receipt,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(asc(chatMessages.seq));

  const ideas = await db
    .select({
      id: mealIdeas.id,
      kitchenId: mealIdeas.kitchenId,
      setId: mealIdeas.setId,
      name: mealIdeas.name,
      why: mealIdeas.why,
      missing: mealIdeas.missing,
      createdAt: mealIdeas.createdAt,
    })
    .from(mealIdeas)
    .where(eq(mealIdeas.createdBy, userId))
    .orderBy(asc(mealIdeas.createdAt), asc(mealIdeas.position));

  const mine = await db
    .select({ kitchenId: memberships.kitchenId, name: kitchens.name, isTest: kitchens.isTest, joinedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(kitchens, eq(kitchens.id, memberships.kitchenId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
  const kitchenExports = [];
  for (const k of mine) {
    const scope = await requireMember(db, userId, k.kitchenId);
    kitchenExports.push({
      id: k.kitchenId,
      name: k.name,
      isTest: k.isTest,
      joinedAt: k.joinedAt.toISOString(),
      members: (await listMembers(db, k.kitchenId)).map((m) => ({ id: m.userId, name: m.displayName })),
      state: await getKitchenState(db, scope),
      events: await streamEvents(db, kitchenStream(k.kitchenId)),
    });
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    you: { id: me.id, name: me.displayName, email: me.email, createdAt: me.createdAt.toISOString() },
    profile: {
      restrictions: restrictions.map((r) => ({
        id: r.id,
        kind: r.kind,
        subject: r.subject,
        ...(r.note ? { note: r.note } : {}),
        addedBy: actorRef(r.createdBy, names),
        addedAt: r.createdAt,
        verified: Boolean(r.verifiedAt),
        ...(r.verifiedAt ? { verifiedAt: r.verifiedAt } : {}),
        updatedBy: actorRef(r.updatedBy, names),
        updatedAt: r.updatedAt,
      })),
      preferences: preferences.map((p) => ({
        id: p.id,
        statement: p.statement,
        savedAt: p.createdAt,
        confirmedByMessageId: p.confirmedByMessageId,
      })),
      events: await streamEvents(db, userStream(userId)),
    },
    chats: chats.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    mealIdeas: ideas.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    kitchens: kitchenExports,
  };
}

export type AccountExport = NonNullable<Awaited<ReturnType<typeof buildExport>>>;
