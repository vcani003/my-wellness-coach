/**
 * Invite links, reset links and passphrase sign-in (SU1 Rec; backend-data.md §7).
 *
 * - **Invite (join):** a member makes a single-use link, valid 24 hours. Whoever opens it picks a
 *   name and a passphrase, gets a new account in that kitchen, and is signed in. Refused when the
 *   app already has 4 real accounts (0006). Someone who deleted their data (D2) comes back this
 *   way only, as a fresh account with a new ID.
 * - **Reset:** a member makes a single-use link for another member (or themselves) of the same
 *   kitchen. Opening it sets a new passphrase and signs that person out everywhere else.
 * - **Sign-in:** name (case-insensitive) + passphrase. One generic failure for a wrong name or a
 *   wrong passphrase, with the same timing.
 *
 * Only an SHA-256 of each link's random token (32 bytes) is stored. Every step is rate-limited
 * before any passphrase is checked. Pure functions of `(db, env, input, now)`: the server
 * actions in `src/app/{join,reset,unlock,settings}` wrap them and set the cookie.
 * Nothing here logs or returns a passphrase or a token (except the new link, once, to its maker).
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db, Queryable } from "@/db/client";
import { invites, kitchens, memberships, users } from "@/db/schema";
import type { Env } from "@/lib/env";
import { checkAuthRateLimit, type AuthAttempt } from "@/lib/rate-limit";
import { matchAccessCode, parseAccessCodes } from "./access-codes";
import {
  burnPassphraseCheck,
  DEFAULT_SCRYPT,
  hashPassphrase,
  nameProblem,
  normalizeName,
  passphraseProblem,
  verifyPassphrase,
  type ScryptParams,
} from "./passphrase";
import { issueSession } from "./session";

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** 0006: at most 4 real accounts. Tester accounts (0021, staging only) aren't counted. */
export const MAX_ACCOUNTS = 4;

export type InvitePurpose = "join" | "reset";

/**
 * Error keys, for `en.json` (the UI owns the wording).
 * - `invalidLink`: unknown, used, expired or no longer valid. One key for all, on purpose.
 * - `full`: the app already has 4 accounts (0006).
 * - `nameTaken` / `nameInvalid`; `passphraseTooShort` (under 12) / `passphraseTooLong` (over 256).
 * - `wrong`: sign-in failed, or the current passphrase/code didn't match. Never says which part.
 * - `tooMany` (+ `minutes`), `notAllowed`, `notConfigured`, `failed` (try again later).
 */
export type AuthErrorKey =
  | "invalidLink"
  | "full"
  | "nameTaken"
  | "nameInvalid"
  | "passphraseTooShort"
  | "passphraseTooLong"
  | "wrong"
  | "tooMany"
  | "notAllowed"
  | "notConfigured"
  | "failed";

export interface AuthFailure {
  ok: false;
  error: { key: AuthErrorKey; minutes?: number };
}

const fail = (key: AuthErrorKey, minutes?: number): AuthFailure => ({ ok: false, error: minutes ? { key, minutes } : { key } });

export interface AuthOptions {
  /** scrypt cost for new hashes (tests use a cheaper one). */
  scrypt?: ScryptParams;
}

// ─── Tokens ────────────────────────────────────────────────────────────────────────────

/** Hex SHA-256 of a link token: what the database stores. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A new random link token (32 bytes, base64url: 43 characters) and its hash. */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export const linkPath = (purpose: InvitePurpose, token: string) => `/${purpose}/${token}`;

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

// ─── Helpers ───────────────────────────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(readonly key: AuthErrorKey) {
    super(key);
  }
}

/** Postgres unique violation (23505), however the driver wraps it. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code === "23505") return true;
  }
  return false;
}

async function limited(db: Db, e: Env, attempt: AuthAttempt, now: Date): Promise<AuthFailure | null> {
  const r = await checkAuthRateLimit(db, attempt, e.SESSION_SECRET!, now);
  return r.ok ? null : fail("tooMany", Math.max(1, Math.ceil(r.retryAfterSeconds / 60)));
}

const sessionCfg = (e: Env) => ({ secret: e.SESSION_SECRET!, accessCodes: e.ACCESS_CODES, production: e.NODE_ENV === "production" });

async function isMember(db: Queryable, kitchenId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.kitchenId, kitchenId), eq(memberships.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** Real accounts in the app (0006's cap). */
async function countAccounts(db: Queryable): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users).where(eq(users.isTest, false));
  return Number(row?.n ?? 0);
}

/** Is this name used by any real account? Case-insensitive. */
async function nameInUse(db: Queryable, name: string, exceptUserId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.displayName}) = lower(${name})`, eq(users.isTest, false)))
    .limit(2);
  return rows.some((r) => r.id !== exceptUserId);
}

interface InviteRow {
  id: string;
  kitchenId: string;
  createdBy: string;
  tokenHash: string;
  targetUserId: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  kitchenIsTest: boolean;
}

/**
 * The live invite for this token and purpose, or null: unknown, wrong purpose, used, expired,
 * a test kitchen, or its maker (or target) is no longer a member. `lock` holds the row until
 * the transaction ends, so two people can't use one link at once.
 */
async function findLiveInvite(db: Queryable, token: string, purpose: InvitePurpose, now: Date, lock = false): Promise<InviteRow | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const hash = hashInviteToken(token);
  const q = db
    .select({
      id: invites.id,
      kitchenId: invites.kitchenId,
      createdBy: invites.createdBy,
      tokenHash: invites.tokenHash,
      targetUserId: invites.targetUserId,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      kitchenIsTest: kitchens.isTest,
    })
    .from(invites)
    .innerJoin(kitchens, eq(kitchens.id, invites.kitchenId))
    .where(and(eq(invites.tokenHash, hash), eq(invites.purpose, purpose)))
    .limit(1);
  const [row] = lock ? await q.for("update", { of: invites }) : await q;
  if (!row) return null;
  // Belt and braces: the lookup was by hash; compare again in constant time.
  const a = Buffer.from(row.tokenHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (row.usedAt || row.expiresAt.getTime() <= now.getTime() || row.kitchenIsTest) return null;
  if (!(await isMember(db, row.kitchenId, row.createdBy))) return null;
  if (purpose === "reset" && (!row.targetUserId || !(await isMember(db, row.kitchenId, row.targetUserId)))) return null;
  return row;
}

async function markUsed(tx: Queryable, inviteId: string, usedBy: string, now: Date): Promise<void> {
  const done = await tx
    .update(invites)
    .set({ usedAt: now, usedBy })
    .where(and(eq(invites.id, inviteId), sql`${invites.usedAt} is null`))
    .returning({ id: invites.id });
  if (done.length === 0) throw new Refusal("invalidLink");
}

function passphraseFailure(passphrase: string): AuthFailure | null {
  const p = passphraseProblem(passphrase);
  return p === "tooShort" ? fail("passphraseTooShort") : p === "tooLong" ? fail("passphraseTooLong") : null;
}

// ─── Making links ──────────────────────────────────────────────────────────────────────

export type CreateLinkResult = { ok: true; path: string; expiresAt: string } | AuthFailure;

/**
 * A new invite (`join`) or reset link, made by `userId` for `kitchenId`. The raw token is in
 * `path` and nowhere else; show it once. Reset: `targetUserId` must be in the same kitchen.
 */
export async function createLink(
  db: Db,
  e: Env,
  input: { userId: string; kitchenId: string; purpose: InvitePurpose; targetUserId?: string },
  now: Date = new Date(),
): Promise<CreateLinkResult> {
  if (!e.SESSION_SECRET) return fail("notConfigured");
  const [kitchen] = await db.select({ isTest: kitchens.isTest }).from(kitchens).where(eq(kitchens.id, input.kitchenId)).limit(1);
  // Only members, only real kitchens (tester kitchens never mint real accounts, 0021).
  if (!kitchen || kitchen.isTest || !(await isMember(db, input.kitchenId, input.userId))) return fail("notAllowed");
  if (input.purpose === "reset") {
    if (!input.targetUserId || !(await isMember(db, input.kitchenId, input.targetUserId))) return fail("notAllowed");
  } else if ((await countAccounts(db)) >= MAX_ACCOUNTS) {
    return fail("full");
  }
  const tooMany = await limited(db, e, { kind: "create", userId: input.userId }, now);
  if (tooMany) return tooMany;

  const { token, tokenHash } = newInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  await db.insert(invites).values({
    id: randomUUID(),
    kitchenId: input.kitchenId,
    createdBy: input.userId,
    tokenHash,
    purpose: input.purpose,
    targetUserId: input.purpose === "reset" ? input.targetUserId! : null,
    expiresAt,
    createdAt: now,
  });
  return { ok: true, path: linkPath(input.purpose, token), expiresAt: expiresAt.toISOString() };
}

// ─── Opening a link (the page, before the form) ──────────────────────────────────────

export type LinkInfo =
  | { ok: true; purpose: InvitePurpose; kitchenName: string; invitedBy: string; forName?: string; expiresAt: string }
  | { ok: false };

/** What the `/join/<token>` or `/reset/<token>` page shows. `{ok: false}` = "This link no longer works". */
export async function getLinkInfo(db: Db, token: string, purpose: InvitePurpose, now: Date = new Date()): Promise<LinkInfo> {
  const row = await findLiveInvite(db, token, purpose, now);
  if (!row) return { ok: false };
  const ids = [row.createdBy, ...(row.targetUserId ? [row.targetUserId] : [])];
  const people = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  const name = (id: string) => people.find((p) => p.id === id)?.displayName ?? "Someone";
  const [kitchen] = await db.select({ name: kitchens.name }).from(kitchens).where(eq(kitchens.id, row.kitchenId)).limit(1);
  return {
    ok: true,
    purpose,
    kitchenName: kitchen?.name ?? "Kitchen",
    invitedBy: name(row.createdBy),
    ...(row.targetUserId ? { forName: name(row.targetUserId) } : {}),
    expiresAt: row.expiresAt.toISOString(),
  };
}

// ─── Using a link ──────────────────────────────────────────────────────────────────────

export type SignedIn = { ok: true; userId: string; token: string };

/** Join with an invite: a new account and membership, the invite used, a session started. */
export async function acceptJoin(
  db: Db,
  e: Env,
  input: { token: string; displayName: string; passphrase: string; ip: string },
  now: Date = new Date(),
  opts: AuthOptions = {},
): Promise<SignedIn | AuthFailure> {
  if (!e.SESSION_SECRET) return fail("notConfigured");
  const displayName = normalizeName(input.displayName);
  if (nameProblem(displayName)) return fail("nameInvalid");
  const weak = passphraseFailure(input.passphrase);
  if (weak) return weak;
  const tooMany = await limited(db, e, { kind: "join", ip: input.ip }, now);
  if (tooMany) return tooMany;
  // Cheap check first, so a dead link costs no slow hashing.
  if (!(await findLiveInvite(db, input.token, "join", now))) return fail("invalidLink");
  const hash = await hashPassphrase(input.passphrase, opts.scrypt ?? DEFAULT_SCRYPT);

  const userId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      // One join at a time app-wide, so two invites can't both take the 4th place.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('accounts'))`);
      const invite = await findLiveInvite(tx, input.token, "join", now, true);
      if (!invite) throw new Refusal("invalidLink");
      if ((await countAccounts(tx)) >= MAX_ACCOUNTS) throw new Refusal("full");
      if (await nameInUse(tx, displayName)) throw new Refusal("nameTaken");
      // A new random ID: never a deleted one (D2), and the DB trigger refuses those anyway.
      await tx.insert(users).values({ id: userId, displayName, isTest: false, passphraseHash: hash, createdAt: now });
      await tx.insert(memberships).values({ kitchenId: invite.kitchenId, userId, createdAt: now });
      await markUsed(tx, invite.id, userId, now);
    });
  } catch (err) {
    if (err instanceof Refusal) return fail(err.key);
    if (isUniqueViolation(err)) return fail("nameTaken");
    console.error("[join] failed:", (err as Error).message);
    return fail("failed");
  }
  const token = issueSession(sessionCfg(e), userId, now, 0, "passphrase");
  return token ? { ok: true, userId, token } : fail("failed");
}

/** Reset with a link: new passphrase, everyone else signed out (epoch bumped), a session here. */
export async function acceptReset(
  db: Db,
  e: Env,
  input: { token: string; passphrase: string; ip: string },
  now: Date = new Date(),
  opts: AuthOptions = {},
): Promise<SignedIn | AuthFailure> {
  if (!e.SESSION_SECRET) return fail("notConfigured");
  const weak = passphraseFailure(input.passphrase);
  if (weak) return weak;
  const tooMany = await limited(db, e, { kind: "reset", ip: input.ip }, now);
  if (tooMany) return tooMany;
  if (!(await findLiveInvite(db, input.token, "reset", now))) return fail("invalidLink");
  const hash = await hashPassphrase(input.passphrase, opts.scrypt ?? DEFAULT_SCRYPT);

  let done: { userId: string; epoch: number };
  try {
    done = await db.transaction(async (tx) => {
      const invite = await findLiveInvite(tx, input.token, "reset", now, true);
      if (!invite?.targetUserId) throw new Refusal("invalidLink");
      const [row] = await tx
        .update(users)
        .set({ passphraseHash: hash, sessionEpoch: sql`${users.sessionEpoch} + 1` })
        .where(and(eq(users.id, invite.targetUserId), eq(users.isTest, false)))
        .returning({ epoch: users.sessionEpoch });
      if (!row) throw new Refusal("invalidLink");
      await markUsed(tx, invite.id, invite.targetUserId, now);
      return { userId: invite.targetUserId, epoch: row.epoch };
    });
  } catch (err) {
    if (err instanceof Refusal) return fail(err.key);
    // Only if two older accounts already share this name: someone has to rename one first.
    if (isUniqueViolation(err)) return fail("nameTaken");
    console.error("[reset] failed:", (err as Error).message);
    return fail("failed");
  }
  const token = issueSession(sessionCfg(e), done.userId, now, done.epoch, "passphrase");
  return token ? { ok: true, userId: done.userId, token } : fail("failed");
}

// ─── Signing in and changing a passphrase ──────────────────────────────────────────────

/** Name + passphrase. Any failure is `wrong`, whether or not the name exists. */
export async function signInWithPassphrase(
  db: Db,
  e: Env,
  input: { name: string; passphrase: string; ip: string },
  now: Date = new Date(),
): Promise<SignedIn | AuthFailure> {
  if (!e.SESSION_SECRET) return fail("notConfigured");
  const name = normalizeName(input.name.slice(0, 200));
  const tooMany = await limited(db, e, { kind: "signIn", ip: input.ip, name }, now);
  if (tooMany) return tooMany;

  const [row] = name
    ? await db
        .select({ id: users.id, passphraseHash: users.passphraseHash, sessionEpoch: users.sessionEpoch })
        .from(users)
        .where(and(sql`lower(${users.displayName}) = lower(${name})`, eq(users.isTest, false), isNotNull(users.passphraseHash)))
        .limit(1)
    : [];
  if (!row?.passphraseHash) {
    await burnPassphraseCheck(input.passphrase); // same timing as a wrong passphrase
    return fail("wrong");
  }
  if (!(await verifyPassphrase(input.passphrase, row.passphraseHash))) return fail("wrong");
  const token = issueSession(sessionCfg(e), row.id, now, row.sessionEpoch, "passphrase");
  return token ? { ok: true, userId: row.id, token } : fail("failed");
}

/**
 * Change (or first set) your passphrase. `current` is your passphrase, or, if you don't have one
 * yet, your access code (so a borrowed unlocked phone can't quietly add a passphrase). Replacing
 * a passphrase signs your other devices out; setting your first one doesn't. Either way you get
 * a fresh passphrase session for this device (`token`).
 */
export async function changePassphrase(
  db: Db,
  e: Env,
  input: { userId: string; current: string; next: string },
  now: Date = new Date(),
  opts: AuthOptions = {},
): Promise<SignedIn | AuthFailure> {
  if (!e.SESSION_SECRET) return fail("notConfigured");
  const tooMany = await limited(db, e, { kind: "change", userId: input.userId }, now);
  if (tooMany) return tooMany;
  const weak = passphraseFailure(input.next);
  if (weak) return weak;

  const [row] = await db
    .select({ passphraseHash: users.passphraseHash, isTest: users.isTest })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!row || row.isTest) return fail("notAllowed");
  const hadPassphrase = Boolean(row.passphraseHash);
  let proven: boolean;
  if (row.passphraseHash) {
    proven = await verifyPassphrase(input.current, row.passphraseHash);
  } else {
    let codes: ReturnType<typeof parseAccessCodes> = [];
    try {
      codes = e.ACCESS_CODES ? parseAccessCodes(e.ACCESS_CODES) : [];
    } catch {
      codes = [];
    }
    proven = matchAccessCode(codes, input.current.slice(0, 200)) === input.userId;
  }
  if (!proven) return fail("wrong");

  const hash = await hashPassphrase(input.next, opts.scrypt ?? DEFAULT_SCRYPT);
  let epoch: number;
  try {
    const [updated] = await db
      .update(users)
      .set({ passphraseHash: hash, ...(hadPassphrase ? { sessionEpoch: sql`${users.sessionEpoch} + 1` } : {}) })
      .where(eq(users.id, input.userId))
      .returning({ epoch: users.sessionEpoch });
    if (!updated) return fail("notAllowed");
    epoch = updated.epoch;
  } catch (err) {
    if (isUniqueViolation(err)) return fail("nameTaken");
    console.error("[passphrase] change failed:", (err as Error).message);
    return fail("failed");
  }
  const token = issueSession(sessionCfg(e), input.userId, now, epoch, "passphrase");
  return token ? { ok: true, userId: input.userId, token } : fail("failed");
}
