/**
 * Real users and the shared kitchen (0006, 0026). Idempotent: run it as often as you like; it
 * only creates what's missing and never changes or deletes existing rows. Someone who deleted
 * their data (D1) is skipped, never recreated (`skippedDeleted`).
 *
 * The user IDs here are the names in `ACCESS_CODES` (`vero=<code>,levi=<code>`). Adding Levi is
 * just adding his code to `ACCESS_CODES`; his user and membership already exist after this runs.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deletedUsers, kitchens, memberships, users } from "@/db/schema";

export const REAL_USERS = [
  { id: "vero", displayName: "Vero" },
  { id: "levi", displayName: "Levi" },
] as const;

export const HOME_KITCHEN = { id: "home", name: "Home" } as const;

export interface BootstrapReport {
  createdUsers: string[];
  createdKitchen: boolean;
  createdMemberships: string[];
  /** Real users who deleted their data: not recreated (the database also refuses it). */
  skippedDeleted: string[];
}

export async function bootstrap(db: Db): Promise<BootstrapReport> {
  return db.transaction(async (tx) => {
    const gone = new Set(
      (await tx.select({ id: deletedUsers.id }).from(deletedUsers).where(inArray(deletedUsers.id, REAL_USERS.map((u) => u.id)))).map(
        (r) => r.id,
      ),
    );
    const wanted = REAL_USERS.filter((u) => !gone.has(u.id));
    const ids = wanted.map((u) => u.id);
    const existing = await tx.select({ id: users.id, isTest: users.isTest }).from(users).where(inArray(users.id, ids));
    if (existing.some((u) => u.isTest)) throw new Error("Refusing: a real user ID belongs to a test account");
    const [kitchen] = await tx.select({ isTest: kitchens.isTest }).from(kitchens).where(eq(kitchens.id, HOME_KITCHEN.id));
    if (kitchen?.isTest) throw new Error(`Refusing: kitchen "${HOME_KITCHEN.id}" is a test kitchen`);

    // Everyone deleted: nothing to set up (and don't recreate their deleted kitchen).
    if (ids.length === 0) return { createdUsers: [], createdKitchen: false, createdMemberships: [], skippedDeleted: [...gone] };

    const createdUsers = await tx
      .insert(users)
      .values(wanted.map((u) => ({ ...u, isTest: false })))
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
      skippedDeleted: [...gone],
    };
  });
}
