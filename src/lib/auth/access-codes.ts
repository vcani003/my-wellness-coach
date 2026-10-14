/**
 * Interim access codes (backend-data.md §7, "Interim access-code gate"). Until email sign-in
 * (0017) exists, each real user unlocks the app with a personal code from the `ACCESS_CODES`
 * environment variable: `vero=<code>,levi=<code>`. The name before `=` is the user's ID, as
 * created by `npm run db:bootstrap`. Pure node:crypto, no database: the proxy uses it too.
 *
 * Error messages here never include a code.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MIN_CODE_LENGTH = 12;

export interface AccessCode {
  userId: string;
  code: string;
}

/** Parse `name=code,name=code`. Throws a value-free message on any problem. */
export function parseAccessCodes(raw: string): AccessCode[] {
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (entries.length === 0) throw new Error("must list at least one name=code");
  const seenUsers = new Set<string>();
  const seenCodes = new Set<string>();
  return entries.map((entry, i) => {
    const eq = entry.indexOf("=");
    const userId = eq > 0 ? entry.slice(0, eq).trim() : "";
    const code = eq > 0 ? entry.slice(eq + 1).trim() : "";
    const where = `entry ${i + 1}`;
    if (!/^[a-z0-9-]+$/.test(userId)) throw new Error(`${where} must look like name=code, with a lowercase name`);
    if (code.length < MIN_CODE_LENGTH) throw new Error(`${where} (${userId}): code must be at least ${MIN_CODE_LENGTH} characters`);
    if (seenUsers.has(userId)) throw new Error(`${where}: ${userId} is listed twice`);
    if (seenCodes.has(code)) throw new Error(`${where} (${userId}): two people share one code`);
    seenUsers.add(userId);
    seenCodes.add(code);
    return { userId, code };
  });
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Which user does this code unlock? Constant-time: both sides are hashed to equal length, and
 * every configured code is compared, with no early exit, so timing doesn't reveal a near miss.
 */
export function matchAccessCode(codes: AccessCode[], attempt: string): string | null {
  const a = digest(attempt.trim());
  let match: string | null = null;
  for (const c of codes) {
    if (timingSafeEqual(a, digest(c.code)) && match === null) match = c.userId;
  }
  return match;
}

/**
 * A short, secret-keyed fingerprint of a user's current code, stored in the session cookie.
 * Changing or removing someone's code in `ACCESS_CODES` therefore signs them out everywhere.
 */
export function codeFingerprint(secret: string, code: string): string {
  return createHmac("sha256", secret).update(`code:${code}`).digest("base64url").slice(0, 22);
}
