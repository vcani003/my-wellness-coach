/**
 * Users and kitchens. Minimal placeholders until the sign-in milestone (Better Auth) owns users;
 * used by seeds and tests today.
 */
import { inArray } from "drizzle-orm";
import { kitchens, memberships, users } from "@/db/schema";
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

/** userId → display name. Unknown IDs (e.g. a deleted member) are simply absent. */
export async function loadNames(db: Queryable, userIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}
