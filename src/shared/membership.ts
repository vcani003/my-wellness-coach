/**
 * Per-kitchen authorisation (backend-data.md §7). All kitchen data access takes a `KitchenScope`,
 * and the only way to get one is `requireMember`, so forgetting the check fails at compile time.
 */
import { and, eq } from "drizzle-orm";
import { kitchens, memberships, users } from "@/db/schema";
import type { Queryable } from "@/db/client";

declare const scopeBrand: unique symbol;

export type KitchenScope = {
  readonly kitchenId: string;
  readonly userId: string;
  readonly isTestKitchen: boolean;
  readonly [scopeBrand]: true;
};

export class NotAMemberError extends Error {
  readonly code = "NOT_ALLOWED" as const;
  constructor() {
    // Same message whether the kitchen doesn't exist or you aren't in it: don't leak which.
    super("Not a member of this kitchen");
    this.name = "NotAMemberError";
  }
}

/**
 * Resolve `userId` + `kitchenId` to a scope, or throw `NotAMemberError`.
 * Tester accounts (0021) are also refused for non-test kitchens here, on top of the DB trigger.
 */
export async function requireMember(db: Queryable, userId: string, kitchenId: string): Promise<KitchenScope> {
  const rows = await db
    .select({ kitchenIsTest: kitchens.isTest, userIsTest: users.isTest })
    .from(memberships)
    .innerJoin(kitchens, eq(kitchens.id, memberships.kitchenId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.kitchenId, kitchenId)))
    .limit(1);
  const row = rows[0];
  if (!row || (row.userIsTest && !row.kitchenIsTest)) throw new NotAMemberError();
  return { kitchenId, userId, isTestKitchen: row.kitchenIsTest } as KitchenScope;
}

export interface Member {
  userId: string;
  displayName: string;
}

export async function listMembers(db: Queryable, kitchenId: string): Promise<Member[]> {
  return db
    .select({ userId: memberships.userId, displayName: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.kitchenId, kitchenId))
    .orderBy(memberships.createdAt);
}
