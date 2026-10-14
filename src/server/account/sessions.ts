/**
 * Signing out (0017; backend-data.md §7, interim access-code gate).
 * - **Sign out:** clears this device's cookie only.
 * - **Sign out everywhere:** bumps `users.session_epoch`, so every cookie issued before (on any
 *   device) is refused by `getCurrentUser`, then clears this device's cookie too.
 * Changing someone's access code still signs them out everywhere, as before.
 */
import "server-only";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Queryable } from "@/db/client";
import { users } from "@/db/schema";
import { sessionCookieName, sessionCookieOptions } from "@/lib/auth/session";
import { env } from "@/lib/env";

/** The new epoch, or null if the user doesn't exist. */
export async function bumpSessionEpoch(db: Queryable, userId: string): Promise<number | null> {
  const [row] = await db
    .update(users)
    .set({ sessionEpoch: sql`${users.sessionEpoch} + 1` })
    .where(eq(users.id, userId))
    .returning({ epoch: users.sessionEpoch });
  return row?.epoch ?? null;
}

/**
 * Expire this device's session cookie. Same attributes as when it was set (Secure, path `/`),
 * which a `__Host-` cookie needs for the browser to accept the removal.
 */
export async function clearSessionCookie(): Promise<void> {
  const production = env().NODE_ENV === "production";
  (await cookies()).set(sessionCookieName(production), "", { ...sessionCookieOptions(production), maxAge: 0 });
}
