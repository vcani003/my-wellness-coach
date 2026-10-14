/**
 * Real users and the shared kitchen (0006, 0026). Idempotent: run it as often as you like; it
 * only creates what's missing and never changes or deletes existing rows.
 *
 * The user IDs here are the names in `ACCESS_CODES` (`vero=<code>,levi=<code>`). Adding Levi is
 * just adding his code to `ACCESS_CODES`; his user and membership already exist after this runs.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { kitchens, memberships, users } from "@/db/schema";

export const REAL_USERS = [
  { id: "vero", displayName: "Vero" },
  { id: "levi", displayName: "Levi" },
] as const;

export const HOME_KITCHEN = { id: "home", name: "Home" } as const;

export interface BootstrapReport {
  createdUsers: string[];
  createdKitchen: boolean;
  createdMemberships: string[];
}

export async function bootstrap(db: Db): Promise<BootstrapReport> {
  return db.transaction(async (tx) => {
    const ids = REAL_USERS.map((u) => u.id);
    const existing = await tx.select({ id: users.id, isTest: users.isTest }).from(users).where(inArray(users.id, ids));
    if (existing.some((u) => u.isTest)) throw new Error("Refusing: a real user ID belongs to a test account");
    const [kitchen] = await tx.select({ isTest: kitchens.isTest }).from(kitchens).where(eq(kitchens.id, HOME_KITCHEN.id));
    if (kitchen?.isTest) throw new Error(`Refusing: kitchen "${HOME_KITCHEN.id}" is a test kitchen`);

    const createdUsers = await tx
      .insert(users)
      .values(REAL_USERS.map((u) => ({ ...u, isTest: false })))
      .onConflictDoNothing()
      .returning({ id: users.id });
    const createdKitchen = await tx
      .insert(kitchens)
      .values({ ...HOME_KITCHEN, isTest: false })
      .onConflictDoNothing()
      .returning({ id: kitchens.id });
    const createdMemberships = await tx
      .insert(memberships)
      .values(ids.map((userId) => ({ kitchenId: HOME_KITCHEN.id, userId })))
      .onConflictDoNothing()
      .returning({ userId: memberships.userId });

    return {
      createdUsers: createdUsers.map((r) => r.id),
      createdKitchen: createdKitchen.length > 0,
      createdMemberships: createdMemberships.map((r) => r.userId),
    };
  });
}
