/**
 * Who is making this request, and in which kitchen.
 *
 * Identity comes from the backend (`getCurrentUser`): the interim access-code session in
 * production, or the dev-only "acting as" switch locally (DEV_ACTING_AS, e.g. `demo-vero`).
 * The kitchen is the first one the user is a member of (MVP 1: one kitchen per person, 0006).
 * Email sign-in replaces the access code later; this file's shape stays.
 */
import "server-only";
import { connection } from "next/server";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { kitchens, rateLimits } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listMembers, requireMember, type KitchenScope, type Member } from "@/shared/membership";
import { scenarioKitchenId, seedScenario } from "../../scripts/scenarios";
import { firstKitchenId } from "./account/settings";
import { getDb } from "./db";
import { isDevActingAsOn } from "./dev-mode";

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

/**
 * Reset the local demo kitchen to its seed (dev only; used by the dev bar and e2e tests). It also
 * clears the demo members' chat rate-limit counters, so a full e2e run (or an afternoon of local
 * testing) doesn't hit "60 messages an hour" (C12) on a kitchen that's meant to be thrown away.
 */
export async function resetDemoKitchen(): Promise<void> {
  if (!isDevActingAsOn()) throw new Error("Dev mode is off");
  const db = await getDb();
  await ensureDemoKitchen(db);
  await seedScenario(db, "demo");
  const members = await listMembers(db, DEV_KITCHEN_ID);
  const keys = members.flatMap((m) => [`chat:hour:${m.userId}`, `chat:day:${m.userId}`]);
  if (keys.length) await db.delete(rateLimits).where(inArray(rateLimits.key, keys));
}

export async function getSession(): Promise<Session | null> {
  // Per-request, never prerendered (Cache Components): wait for the real request before any
  // database work. Cookies alone aren't enough, because runtime prefetching can see cookies.
  await connection();
  const devActingAs = isDevActingAsOn();
  const db = await getDb();
  if (devActingAs) await ensureDemoKitchen(db);
  const user = await getCurrentUser();
  if (!user) return null;
  const kitchenId = await firstKitchenId(db, user.id);
  if (!kitchenId) return null;
  const members = await listMembers(db, kitchenId);
  const me = members.find((m) => m.userId === user.id);
  if (!me) return null;
  return { userId: me.userId, displayName: me.displayName, kitchenId, members, devActingAs };
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
