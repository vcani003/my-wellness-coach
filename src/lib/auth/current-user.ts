/**
 * Who is making this request? (backend-data.md §7, interim access-code gate.)
 *
 * `getCurrentUser()` is what route handlers, server actions and server components call. It
 * re-checks the session cookie itself rather than trusting the proxy, because a Server Function
 * can be reached on a path the proxy matcher doesn't cover. Returns null when signed out.
 *
 * The dev-only "acting as" switch: with `DEV_ACTING_AS=<userId>` (never in production; the
 * server refuses to start), the gate is skipped and you are that user. A `dev_acting_as`
 * cookie, set by a dev switch in the UI, picks another user.
 */
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, type Queryable } from "@/db/client";
import { users } from "@/db/schema";
import { devActingAsEnabled, env, type Env } from "@/lib/env";
import { sessionCookieName, verifySession } from "./session";

export const DEV_ACTING_AS_COOKIE = "dev_acting_as";

export interface CurrentUser {
  id: string;
  displayName: string;
}

export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED" as const;
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

async function loadUser(db: Queryable, id: string, allowTest: boolean, epoch?: number): Promise<CurrentUser | null> {
  const [row] = await db
    .select({ id: users.id, displayName: users.displayName, isTest: users.isTest, sessionEpoch: users.sessionEpoch })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!row || (row.isTest && !allowTest)) return null;
  // "Sign out everywhere" (0017): a cookie from another session generation no longer counts.
  if (epoch !== undefined && epoch !== row.sessionEpoch) return null;
  return { id: row.id, displayName: row.displayName };
}

/** The testable core of `getCurrentUser`: no Next.js request APIs. */
export async function resolveCurrentUser(
  db: Queryable,
  e: Env,
  input: { sessionToken?: string; devActingAs?: string },
  now: Date = new Date(),
): Promise<CurrentUser | null> {
  if (devActingAsEnabled(e)) {
    return loadUser(db, input.devActingAs || e.DEV_ACTING_AS!, true);
  }
  if (!e.SESSION_SECRET || !e.ACCESS_CODES) return null;
  const session = verifySession(
    { secret: e.SESSION_SECRET, accessCodes: e.ACCESS_CODES, production: e.NODE_ENV === "production" },
    input.sessionToken,
    now,
  );
  if (!session) return null;
  // Tester accounts never hold a real session (0021). A deleted person has no row (D1).
  return loadUser(db, session.userId, false, session.epoch);
}

/** The signed-in user, or null. Server only. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const e = env();
  const jar = await cookies();
  return resolveCurrentUser(await getDb(), e, {
    sessionToken: jar.get(sessionCookieName(e.NODE_ENV === "production"))?.value,
    devActingAs: jar.get(DEV_ACTING_AS_COOKIE)?.value,
  });
}

/** The signed-in user, or throw `UnauthenticatedError` (answer 401). */
export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}
