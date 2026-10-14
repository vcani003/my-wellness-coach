/**
 * Who is making this request, and in which kitchen.
 *
 * MILESTONE 2 STAND-IN: there's no sign-in yet (the sign-in milestone replaces this file's body
 * with Better Auth). In local development the "acting as" cookie picks Vero or Levi in the
 * `demo` kitchen; anywhere else there is no session, so every route refuses.
 */
import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { kitchens } from "@/db/schema";
import { listMembers, requireMember, type KitchenScope, type Member } from "@/shared/membership";
import { scenarioKitchenId, seedScenario } from "../../scripts/scenarios";
import { getDb } from "./db";
import { DEV_ACTING_AS_COOKIE, isDevActingAsOn } from "./dev-mode";

export interface Session {
  userId: string;
  displayName: string;
  kitchenId: string;
  members: Member[];
  /** True while the dev "acting as" switch is what identifies you. */
  devActingAs: boolean;
}

export const DEV_KITCHEN_ID = scenarioKitchenId("demo");

const g = globalThis as typeof globalThis & { __demoSeed?: Promise<void> };

/** Seed the local demo kitchen the first time it's needed (dev only). */
async function ensureDemoKitchen(db: Db): Promise<void> {
  g.__demoSeed ??= (async () => {
    const [row] = await db.select({ id: kitchens.id }).from(kitchens).where(eq(kitchens.id, DEV_KITCHEN_ID));
    if (!row) await seedScenario(db, "demo");
  })().catch((error: unknown) => {
    g.__demoSeed = undefined;
    throw error;
  });
  return g.__demoSeed;
}

/** Reset the local demo kitchen to its seed (dev only; used by the dev bar and e2e tests). */
export async function resetDemoKitchen(): Promise<void> {
  if (!isDevActingAsOn()) throw new Error("Dev mode is off");
  const db = await getDb();
  await ensureDemoKitchen(db);
  await seedScenario(db, "demo");
}

export async function getSession(): Promise<Session | null> {
  // Per-request, never prerendered (Cache Components): wait for the real request before any
  // database work. Cookies alone aren't enough, because runtime prefetching can see cookies.
  await connection();
  const wanted = (await cookies()).get(DEV_ACTING_AS_COOKIE)?.value;
  if (!isDevActingAsOn()) return null;
  const db = await getDb();
  await ensureDemoKitchen(db);
  const members = await listMembers(db, DEV_KITCHEN_ID);
  if (members.length === 0) return null;
  const me = members.find((m) => m.userId === wanted) ?? members[0];
  return { userId: me.userId, displayName: me.displayName, kitchenId: DEV_KITCHEN_ID, members, devActingAs: true };
}

/** The membership-checked scope for a kitchen, or null (not signed in / not a member). */
export async function getScope(kitchenId: string): Promise<{ db: Db; scope: KitchenScope; session: Session } | null> {
  const session = await getSession();
  if (!session) return null;
  const db = await getDb();
  try {
    return { db, scope: await requireMember(db, session.userId, kitchenId), session };
  } catch {
    return null;
  }
}
