/**
 * Session cookie for the interim access-code gate (backend-data.md §7). A signed token, not a
 * database row: `base64url(payload).base64url(HMAC-SHA256(SESSION_SECRET, payload))`.
 *
 * - **Rolling 1 year (0017, FE1):** the cookie lasts a year and is re-issued at most once a day
 *   while in use, so a regular user is never asked again.
 * - **Revoking:** change that person's code in `ACCESS_CODES` (signs out just them), or change
 *   `SESSION_SECRET` (signs out everyone). "Sign out everywhere" arrives with Better Auth.
 * - httpOnly, Secure (production), SameSite=Lax, path `/`; `__Host-` prefix in production.
 *
 * Pure node:crypto, no database, so `src/proxy.ts` can check it on every request.
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
}

interface Payload {
  v: 1;
  u: string;
  k: string;
  iat: number;
  exp: number;
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

/** A new token for `userId`, or null if that user has no access code (can't hold a session). */
export function issueSession(cfg: SessionConfig, userId: string, now: Date): string | null {
  const entry = parseAccessCodes(cfg.accessCodes).find((c) => c.userId === userId);
  if (!entry) return null;
  const iat = nowS(now);
  const payload: Payload = { v: 1, u: userId, k: codeFingerprint(cfg.secret, entry.code), iat, exp: iat + SESSION_MAX_AGE_S };
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${data}.${sign(cfg.secret, data)}`;
}

/**
 * Check a token: signature, expiry, and that the user's code hasn't changed since. Returns null
 * for anything wrong (missing, tampered, expired, revoked); never throws on bad input.
 */
export function verifySession(cfg: SessionConfig, token: string | undefined, now: Date): Session | null {
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
  return { userId: p.u, iat: p.iat, exp: p.exp };
}

/** Rolling session: time to re-issue? */
export function shouldRefresh(session: Session, now: Date): boolean {
  return nowS(now) - session.iat >= SESSION_REFRESH_AFTER_S;
}
