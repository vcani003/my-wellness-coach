/**
 * Session cookie for the interim access-code gate (backend-data.md §7). A signed token, not a
 * database row: `base64url(payload).base64url(HMAC-SHA256(SESSION_SECRET, payload))`.
 *
 * - **Rolling 1 year (0017, FE1):** the cookie lasts a year and is re-issued at most once a day
 *   while in use, so a regular user is never asked again.
 * - **Revoking:** "Sign out everywhere" (0017) bumps the person's `users.session_epoch`; the
 *   cookie carries the epoch it was issued under, and `resolveCurrentUser` rejects an older one.
 *   Also: change that person's code in `ACCESS_CODES` (signs out just them), or change
 *   `SESSION_SECRET` (signs out everyone).
 * - httpOnly, Secure (production), SameSite=Lax, path `/`; `__Host-` prefix in production.
 *
 * Pure node:crypto, no database, so `src/proxy.ts` can check it on every request. The epoch needs
 * the database, so the proxy only carries it forward; each handler's `getCurrentUser()` checks it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { codeFingerprint, parseAccessCodes } from "./access-codes";

export const SESSION_MAX_AGE_S = 365 * 24 * 60 * 60;
/** Re-issue (roll) the cookie when it was issued more than this long ago. */
export const SESSION_REFRESH_AFTER_S = 24 * 60 * 60;

export interface SessionConfig {
  secret: string;
  accessCodes: string;
  production: boolean;
}

export interface Session {
  userId: string;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expires at, seconds since epoch. */
  exp: number;
  /** The session generation it was issued under (`users.session_epoch`). */
  epoch: number;
}

interface Payload {
  v: 1;
  u: string;
  k: string;
  iat: number;
  exp: number;
  /** Session epoch. Absent in cookies issued before migration 0007, which count as 0. */
  e?: number;
}

export const sessionCookieName = (production: boolean) => (production ? "__Host-kitchen_session" : "kitchen_session");

export function sessionCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}

const sign = (secret: string, data: string) => createHmac("sha256", secret).update(`session:${data}`).digest("base64url");

const nowS = (now: Date) => Math.floor(now.getTime() / 1000);

/**
 * A new token for `userId` under session `epoch`, or null if that user has no access code (can't
 * hold a session).
 */
export function issueSession(cfg: SessionConfig, userId: string, now: Date, epoch = 0): string | null {
  const entry = parseAccessCodes(cfg.accessCodes).find((c) => c.userId === userId);
  if (!entry) return null;
  const iat = nowS(now);
  const payload: Payload = { v: 1, u: userId, k: codeFingerprint(cfg.secret, entry.code), iat, exp: iat + SESSION_MAX_AGE_S, e: epoch };
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${data}.${sign(cfg.secret, data)}`;
}

/**
 * Check a token: signature, expiry, and that the user's code hasn't changed since. Returns null
 * for anything wrong (missing, tampered, expired, revoked); never throws on bad input. Pass the
 * user's `currentEpoch` (from the database) to also refuse a cookie signed out everywhere.
 */
export function verifySession(cfg: SessionConfig, token: string | undefined, now: Date, currentEpoch?: number): Session | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const data = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(cfg.secret, data), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (p?.v !== 1 || typeof p.u !== "string" || typeof p.k !== "string") return null;
  if (typeof p.iat !== "number" || typeof p.exp !== "number" || p.exp <= nowS(now)) return null;
  const epoch = p.e ?? 0;
  if (!Number.isInteger(epoch) || epoch < 0) return null;

  let codes;
  try {
    codes = parseAccessCodes(cfg.accessCodes);
  } catch {
    return null;
  }
  const entry = codes.find((c) => c.userId === p.u);
  if (!entry) return null;
  const k = Buffer.from(codeFingerprint(cfg.secret, entry.code));
  const pk = Buffer.from(p.k);
  if (k.length !== pk.length || !timingSafeEqual(k, pk)) return null;
  // "Sign out everywhere": a cookie from an older (or any other) session generation is refused.
  if (currentEpoch !== undefined && epoch !== currentEpoch) return null;
  return { userId: p.u, iat: p.iat, exp: p.exp, epoch };
}

/** Rolling session: time to re-issue? */
export function shouldRefresh(session: Session, now: Date): boolean {
  return nowS(now) - session.iat >= SESSION_REFRESH_AFTER_S;
}
