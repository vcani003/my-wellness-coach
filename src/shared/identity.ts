/**
 * Users and kitchens. Minimal placeholders until the sign-in milestone (Better Auth) owns users;
 * used by seeds and tests today.
 */
import { inArray } from "drizzle-orm";
import type { ActorRef } from "@/contracts/common";
import { deletedUsers, kitchens, memberships, users } from "@/db/schema";
import type { Queryable } from "@/db/client";

export async function createUser(
  db: Queryable,
  user: { id: string; displayName: string; email?: string; isTest?: boolean },
): Promise<void> {
  await db.insert(users).values({
    id: user.id,
    displayName: user.displayName,
    email: user.email ?? null,
    isTest: user.isTest ?? false,
  });
}

export async function createKitchen(
  db: Queryable,
  kitchen: { id: string; name: string; isTest?: boolean; memberIds: string[] },
): Promise<void> {
  await db.insert(kitchens).values({ id: kitchen.id, name: kitchen.name, isTest: kitchen.isTest ?? false });
  for (const userId of kitchen.memberIds) await addMember(db, kitchen.id, userId);
}

/** The database refuses a tester account in a non-test kitchen (0021). */
export async function addMember(db: Queryable, kitchenId: string, userId: string): Promise<void> {
  await db.insert(memberships).values({ kitchenId, userId });
}

/**
 * userId → display name, plus `former`: the IDs of people who deleted their data (D1), so their
 * old changes read as "a former member". Unknown IDs are simply absent from both.
 */
export type NameDirectory = ReadonlyMap<string, string> & { readonly former?: ReadonlySet<string> };

/** Who did it: a name, "a former member" (D1), or a missing reference ("Someone", 0018). */
export function actorRef(id: string, names: NameDirectory): ActorRef {
  const name = names.get(id);
  if (name !== undefined) return { id, name };
  return names.former?.has(id) ? { id, missing: true, former: true } : { id, missing: true };
}

export async function loadNames(db: Queryable, userIds: Iterable<string>): Promise<Map<string, string> & { former: Set<string> }> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return Object.assign(new Map<string, string>(), { former: new Set<string>() });
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  const names = new Map(rows.map((r) => [r.id, r.displayName]));
  const missing = ids.filter((id) => !names.has(id));
  const gone = missing.length
    ? await db.select({ id: deletedUsers.id }).from(deletedUsers).where(inArray(deletedUsers.id, missing))
    : [];
  return Object.assign(names, { former: new Set(gone.map((r) => r.id)) });
}
