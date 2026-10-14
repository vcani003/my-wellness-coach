/**
 * Invite links, reset links and passphrase sign-in on PGlite (SU1 Rec; backend-data.md §7).
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openLocalDb, type Db } from "@/db/client";
import { invites, memberships, users } from "@/db/schema";
import { resolveCurrentUser } from "@/lib/auth/current-user";
import { gate } from "@/lib/auth/gate";
import {
  acceptJoin,
  acceptReset,
  changePassphrase,
  createLink,
  getLinkInfo,
  hashInviteToken,
  INVITE_TTL_MS,
  MAX_ACCOUNTS,
  signInWithPassphrase,
} from "@/lib/auth/invites";
import { sessionCookieName, verifySession } from "@/lib/auth/session";
import { attemptUnlock } from "@/lib/auth/unlock";
import { parseEnv, type Env } from "@/lib/env";
import { AUTH_LIMITS } from "@/lib/rate-limit";
import { deleteMyData } from "@/server/account/delete";
import { createKitchen, createUser } from "@/shared/identity";
import { bootstrap } from "../../scripts/bootstrap";

const SECRET = "test-session-secret-0123456789abcdef";
const VERO_CODE = "vero-test-code-111";
const E: Env = parseEnv({ NODE_ENV: "test", SESSION_SECRET: SECRET, ACCESS_CODES: `vero=${VERO_CODE}` });
const CHEAP = { scrypt: { ln: 10, r: 8, p: 1 } };
const T0 = new Date("2026-10-14T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const PASS = "a long kitchen passphrase";

let ipCounter = 0;
const ip = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const tokenOf = (path: string) => path.split("/")[2];

/** A fresh database with the real users (vero, levi) and kitchen (home) from the bootstrap. */
async function freshDb() {
  const { db, close } = await openLocalDb();
  await bootstrap(db);
  return { db, close };
}

async function invite(db: Db, by = "vero", kitchenId = "home", now = T0) {
  const r = await createLink(db, E, { userId: by, kitchenId, purpose: "join" }, now);
  if (!r.ok) throw new Error(`invite failed: ${r.error.key}`);
  return tokenOf(r.path);
}

async function join(db: Db, token: string, displayName: string, now = T0, passphrase = PASS) {
  return acceptJoin(db, E, { token, displayName, passphrase, ip: ip() }, now, CHEAP);
}

const me = (db: Db, token: string, now = T0) => resolveCurrentUser(db, E, { sessionToken: token }, now);

/** Remove every real account except the bootstrap's, so the cap (4) doesn't fill up between tests. */
const keepOnlyBootstrapUsers = (db: Db) =>
  db.delete(users).where(and(eq(users.isTest, false), notInArray(users.id, ["vero", "levi"])));

describe("invites (join)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await freshDb()));
  beforeEach(() => keepOnlyBootstrapUsers(db));
  afterAll(() => close());

  it("stores only the token's SHA-256, never the token", async () => {
    const r = await createLink(db, E, { userId: "vero", kitchenId: "home", purpose: "join" }, T0);
    if (!r.ok) throw new Error(r.error.key);
    expect(r.path).toMatch(/^\/join\/[A-Za-z0-9_-]{43}$/);
    expect(r.expiresAt).toBe(at(INVITE_TTL_MS).toISOString());
    const token = tokenOf(r.path);
    const rows = await db.select().from(invites);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows.some((row) => row.tokenHash === hashInviteToken(token))).toBe(true);
    const dump = await db.execute(sql`select * from invites`);
    expect(JSON.stringify(dump)).not.toContain(token);
  });

  it("joins: a new account in that kitchen, a working session, and the passphrase stored scrambled", async () => {
    const token = await invite(db);
    expect(await getLinkInfo(db, token, "join", T0)).toMatchObject({ ok: true, kitchenName: "Home", invitedBy: "Vero" });
    const r = await join(db, token, "  Sam  ");
    if (!r.ok) throw new Error(r.error.key);
    expect(JSON.stringify(r)).not.toContain(PASS);

    const [row] = await db.select().from(users).where(eq(users.id, r.userId));
    expect(row).toMatchObject({ displayName: "Sam", isTest: false, sessionEpoch: 0 });
    expect(row.passphraseHash).toMatch(/^scrypt\$/);
    expect(row.passphraseHash).not.toContain(PASS);
    expect(await db.select().from(memberships).where(eq(memberships.userId, r.userId))).toHaveLength(1);
    expect(await me(db, r.token)).toEqual({ id: r.userId, displayName: "Sam" });
    expect(verifySession({ secret: SECRET, production: false }, r.token, T0)?.method).toBe("passphrase");
  });

  it("works once: a second use, or a second person, is refused", async () => {
    const token = await invite(db);
    expect((await join(db, token, "Robin")).ok).toBe(true);
    expect(await join(db, token, "Robin Two")).toEqual({ ok: false, error: { key: "invalidLink" } });
    expect(await getLinkInfo(db, token, "join", T0)).toEqual({ ok: false });
  });

  it("expires after 24 hours", async () => {
    const token = await invite(db);
    expect(await join(db, token, "Late", at(INVITE_TTL_MS))).toEqual({ ok: false, error: { key: "invalidLink" } });
    expect(await getLinkInfo(db, token, "join", at(INVITE_TTL_MS + 1))).toEqual({ ok: false });
  });

  it("refuses an unknown or malformed token, or a reset token used as an invite", async () => {
    expect(await join(db, "x".repeat(43), "Nobody")).toEqual({ ok: false, error: { key: "invalidLink" } });
    expect(await join(db, "../../etc", "Nobody")).toEqual({ ok: false, error: { key: "invalidLink" } });
    const reset = await createLink(db, E, { userId: "vero", kitchenId: "home", purpose: "reset", targetUserId: "vero" }, T0);
    if (!reset.ok) throw new Error(reset.error.key);
    expect(await join(db, tokenOf(reset.path), "Sneaky")).toEqual({ ok: false, error: { key: "invalidLink" } });
  });

  it("checks name and passphrase first, leaving the link usable", async () => {
    const token = await invite(db);
    expect(await join(db, token, "Pat", T0, "too short")).toEqual({ ok: false, error: { key: "passphraseTooShort" } });
    expect(await join(db, token, "Pat", T0, "x".repeat(300))).toEqual({ ok: false, error: { key: "passphraseTooLong" } });
    expect(await join(db, token, "<b>Pat</b>")).toEqual({ ok: false, error: { key: "nameInvalid" } });
    // "levi" is the bootstrap's Levi: names are unique, case-insensitively.
    expect(await join(db, token, "LEVI")).toEqual({ ok: false, error: { key: "nameTaken" } });
    expect(await join(db, token, " vero ")).toEqual({ ok: false, error: { key: "nameTaken" } });
    expect((await join(db, token, "Pat")).ok).toBe(true);
  });

  it("only members can make an invite, and only for a real kitchen", async () => {
    await createUser(db, { id: "outsider", displayName: "Outsider" });
    await createKitchen(db, { id: "other", name: "Other", memberIds: ["outsider"] });
    expect(await createLink(db, E, { userId: "outsider", kitchenId: "home", purpose: "join" }, T0)).toEqual({
      ok: false,
      error: { key: "notAllowed" },
    });
    await createUser(db, { id: "tester-x", displayName: "Tester X", isTest: true });
    await createKitchen(db, { id: "test-k", name: "Test", isTest: true, memberIds: ["tester-x"] });
    expect(await createLink(db, E, { userId: "tester-x", kitchenId: "test-k", purpose: "join" }, T0)).toEqual({
      ok: false,
      error: { key: "notAllowed" },
    });
  });
});

describe("the account cap (4, 0006)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await freshDb()));
  afterAll(() => close());

  it("refuses a join that would make a 5th account, and refuses new invites once full", async () => {
    expect(MAX_ACCOUNTS).toBe(4);
    // vero + levi exist; tester accounts don't count (0021).
    await createUser(db, { id: "tester-y", displayName: "Tester Y", isTest: true });
    const a = await invite(db);
    const b = await invite(db);
    const c = await invite(db);
    expect((await join(db, a, "Third")).ok).toBe(true);
    expect((await join(db, b, "Fourth")).ok).toBe(true);
    expect(await join(db, c, "Fifth")).toEqual({ ok: false, error: { key: "full" } });
    expect(await createLink(db, E, { userId: "vero", kitchenId: "home", purpose: "join" }, T0)).toEqual({
      ok: false,
      error: { key: "full" },
    });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.isTest, false));
    expect(n).toBe(4);
  });

  it("a deleted person (D2) frees their place, and comes back only through a new invite, as a new account", async () => {
    const [fourth] = await db.select().from(users).where(eq(users.displayName, "Fourth"));
    const oldSession = await signInWithPassphrase(db, E, { name: "Fourth", passphrase: PASS, ip: ip() }, T0);
    if (!oldSession.ok) throw new Error(oldSession.error.key);
    expect((await deleteMyData(db, fourth.id, T0)).ok).toBe(true);

    expect(await signInWithPassphrase(db, E, { name: "Fourth", passphrase: PASS, ip: ip() }, T0)).toEqual({
      ok: false,
      error: { key: "wrong" },
    });
    expect(await me(db, oldSession.token)).toBeNull();

    const back = await join(db, await invite(db), "Fourth");
    if (!back.ok) throw new Error(back.error.key);
    expect(back.userId).not.toBe(fourth.id);
  });

  it("an invite dies with the member who made it", async () => {
    const { db: db2, close: close2 } = await freshDb();
    try {
      const token = await invite(db2, "levi");
      expect((await deleteMyData(db2, "levi", T0)).ok).toBe(true);
      expect(await db2.select().from(invites)).toHaveLength(0);
      expect(await join(db2, token, "Anyone")).toEqual({ ok: false, error: { key: "invalidLink" } });
    } finally {
      await close2();
    }
  });
});

describe("reset links", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await freshDb()));
  afterAll(() => close());

  async function resetLink(by: string, target: string, kitchenId = "home") {
    return createLink(db, E, { userId: by, kitchenId, purpose: "reset", targetUserId: target }, T0);
  }

  it("only for a member of your own kitchen", async () => {
    await createUser(db, { id: "stranger", displayName: "Stranger" });
    await createKitchen(db, { id: "theirs", name: "Theirs", memberIds: ["stranger"] });
    expect(await resetLink("vero", "stranger")).toEqual({ ok: false, error: { key: "notAllowed" } });
    expect(await resetLink("vero", "stranger", "theirs")).toEqual({ ok: false, error: { key: "notAllowed" } });
    expect(await resetLink("stranger", "vero")).toEqual({ ok: false, error: { key: "notAllowed" } });
    expect(await resetLink("vero", "nobody-at-all")).toEqual({ ok: false, error: { key: "notAllowed" } });
  });

  it("sets a new passphrase, signs out every old cookie (epoch bump), and starts a session", async () => {
    // Levi (bootstrap) has no passphrase yet: a reset link is how he sets one.
    const first = await resetLink("vero", "levi");
    if (!first.ok) throw new Error(first.error.key);
    expect(first.path).toMatch(/^\/reset\//);
    expect(await getLinkInfo(db, tokenOf(first.path), "reset", T0)).toMatchObject({ ok: true, forName: "Levi", invitedBy: "Vero" });
    const s1 = await acceptReset(db, E, { token: tokenOf(first.path), passphrase: PASS, ip: ip() }, T0, CHEAP);
    if (!s1.ok) throw new Error(s1.error.key);
    expect(s1.userId).toBe("levi");
    expect(await me(db, s1.token)).toEqual({ id: "levi", displayName: "Levi" });

    const second = await resetLink("levi", "levi");
    if (!second.ok) throw new Error(second.error.key);
    const NEW = "an even longer new passphrase";
    const s2 = await acceptReset(db, E, { token: tokenOf(second.path), passphrase: NEW, ip: ip() }, T0, CHEAP);
    if (!s2.ok) throw new Error(s2.error.key);

    expect(await me(db, s1.token)).toBeNull(); // the old cookie no longer works
    expect(await me(db, s2.token)).toEqual({ id: "levi", displayName: "Levi" });
    expect((await signInWithPassphrase(db, E, { name: "levi", passphrase: PASS, ip: ip() }, T0)).ok).toBe(false);
    expect((await signInWithPassphrase(db, E, { name: "levi", passphrase: NEW, ip: ip() }, T0)).ok).toBe(true);
    // Single use.
    expect(await acceptReset(db, E, { token: tokenOf(second.path), passphrase: NEW, ip: ip() }, T0, CHEAP)).toEqual({
      ok: false,
      error: { key: "invalidLink" },
    });
  });

  it("dies if its target leaves the kitchen", async () => {
    await createUser(db, { id: "leaver", displayName: "Leaver" });
    await db.insert(memberships).values({ kitchenId: "home", userId: "leaver" });
    const link = await resetLink("vero", "leaver");
    if (!link.ok) throw new Error(link.error.key);
    await db.delete(memberships).where(eq(memberships.userId, "leaver"));
    expect(await acceptReset(db, E, { token: tokenOf(link.path), passphrase: PASS, ip: ip() }, T0, CHEAP)).toEqual({
      ok: false,
      error: { key: "invalidLink" },
    });
  });
});

describe("sign-in by name + passphrase", () => {
  let db: Db;
  let close: () => Promise<void>;
  let samId: string;
  beforeAll(async () => {
    ({ db, close } = await freshDb());
    const r = await join(db, await invite(db), "Sam");
    if (!r.ok) throw new Error(r.error.key);
    samId = r.userId;
  });
  afterAll(() => close());

  it("is case-insensitive on the name", async () => {
    for (const name of ["Sam", "sam", "  SAM "]) {
      const r = await signInWithPassphrase(db, E, { name, passphrase: PASS, ip: ip() }, T0);
      expect(r.ok, name).toBe(true);
      if (r.ok) expect(r.userId).toBe(samId);
    }
  });

  it("gives one generic failure for a wrong passphrase, an unknown name, or a person with no passphrase", async () => {
    const wrongPass = await signInWithPassphrase(db, E, { name: "Sam", passphrase: "not the passphrase", ip: ip() }, T0);
    const noSuchName = await signInWithPassphrase(db, E, { name: "Nobody Here", passphrase: PASS, ip: ip() }, T0);
    const noPassphrase = await signInWithPassphrase(db, E, { name: "Vero", passphrase: VERO_CODE, ip: ip() }, T0);
    const empty = await signInWithPassphrase(db, E, { name: "", passphrase: "", ip: ip() }, T0);
    for (const r of [wrongPass, noSuchName, noPassphrase, empty]) expect(r).toEqual({ ok: false, error: { key: "wrong" } });
  });

  it("rate-limits per name, across addresses, before checking the passphrase", async () => {
    const victim = await join(db, await invite(db), "Target");
    if (!victim.ok) throw new Error(victim.error.key);
    for (let i = 0; i < AUTH_LIMITS.signInPerName.max; i++) {
      await signInWithPassphrase(db, E, { name: "target", passphrase: `guess number ${i}!`, ip: ip() }, at(60_000));
    }
    const r = await signInWithPassphrase(db, E, { name: "TARGET", passphrase: PASS, ip: ip() }, at(60_000));
    expect(r).toMatchObject({ ok: false, error: { key: "tooMany" } });
    // The window passes.
    expect((await signInWithPassphrase(db, E, { name: "Target", passphrase: PASS, ip: ip() }, at(16 * 60_000))).ok).toBe(true);
  });

  it("rate-limits per address", async () => {
    const addr = "203.0.113.9";
    for (let i = 0; i < AUTH_LIMITS.signInPerIp.max; i++) {
      await signInWithPassphrase(db, E, { name: `someone ${i}`, passphrase: PASS, ip: addr }, at(3_600_000));
    }
    expect(await signInWithPassphrase(db, E, { name: "Sam", passphrase: PASS, ip: addr }, at(3_600_000))).toMatchObject({
      ok: false,
      error: { key: "tooMany" },
    });
  });

  it("rate-limits joining per address", async () => {
    await db.delete(users).where(eq(users.displayName, "Target")); // keep a place free (cap 4)
    const addr = "203.0.113.10";
    for (let i = 0; i < AUTH_LIMITS.linkPerIp.max; i++) {
      await acceptJoin(db, E, { token: "y".repeat(43), displayName: "Guess", passphrase: PASS, ip: addr }, at(7_200_000), CHEAP);
    }
    const token = await invite(db, "vero", "home", at(7_200_000));
    expect(await acceptJoin(db, E, { token, displayName: "Real", passphrase: PASS, ip: addr }, at(7_200_000), CHEAP)).toMatchObject({
      ok: false,
      error: { key: "tooMany" },
    });
  });

  it("a passphrase session passes the proxy even with no ACCESS_CODES configured", async () => {
    const r = await signInWithPassphrase(db, E, { name: "Sam", passphrase: PASS, ip: ip() }, at(10_800_000));
    if (!r.ok) throw new Error(r.error.key);
    const noCodes = parseEnv({ NODE_ENV: "test", SESSION_SECRET: SECRET });
    const req = new NextRequest("http://localhost/", { headers: { cookie: `${sessionCookieName(false)}=${r.token}` } });
    expect(gate(req, noCodes, at(10_800_000)).headers.get("x-middleware-next")).toBe("1");
    expect(await resolveCurrentUser(db, noCodes, { sessionToken: r.token }, at(10_800_000))).toEqual({ id: samId, displayName: "Sam" });
  });
});

describe("changing your passphrase, and ACCESS_CODES as a backup", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await freshDb()));
  afterAll(() => close());

  it("the access code still unlocks, unchanged", async () => {
    const r = await attemptUnlock(db, E, { code: VERO_CODE, ip: ip() }, T0);
    if (!r.ok) throw new Error(r.reason);
    expect(verifySession({ secret: SECRET, accessCodes: E.ACCESS_CODES, production: false }, r.token, T0)?.method).toBe("code");
    expect(await me(db, r.token)).toEqual({ id: "vero", displayName: "Vero" });
  });

  it("first passphrase: proven with the access code; other devices stay signed in", async () => {
    const phone = await attemptUnlock(db, E, { code: VERO_CODE, ip: ip() }, T0);
    if (!phone.ok) throw new Error(phone.reason);
    expect(await changePassphrase(db, E, { userId: "vero", current: "not my code at all", next: PASS }, T0, CHEAP)).toEqual({
      ok: false,
      error: { key: "wrong" },
    });
    expect(await changePassphrase(db, E, { userId: "vero", current: VERO_CODE, next: "short" }, T0, CHEAP)).toEqual({
      ok: false,
      error: { key: "passphraseTooShort" },
    });
    const set = await changePassphrase(db, E, { userId: "vero", current: VERO_CODE, next: PASS }, T0, CHEAP);
    if (!set.ok) throw new Error(set.error.key);
    expect(await me(db, phone.token)).toEqual({ id: "vero", displayName: "Vero" });
    expect((await signInWithPassphrase(db, E, { name: "vero", passphrase: PASS, ip: ip() }, T0)).ok).toBe(true);
    // The code still works too.
    expect((await attemptUnlock(db, E, { code: VERO_CODE, ip: ip() }, T0)).ok).toBe(true);
  });

  it("replacing it needs the current passphrase, and signs out other devices but not this one", async () => {
    const laptop = await signInWithPassphrase(db, E, { name: "Vero", passphrase: PASS, ip: ip() }, T0);
    if (!laptop.ok) throw new Error(laptop.error.key);
    expect(await changePassphrase(db, E, { userId: "vero", current: VERO_CODE, next: "brand new passphrase" }, T0, CHEAP)).toEqual({
      ok: false,
      error: { key: "wrong" },
    });
    const changed = await changePassphrase(db, E, { userId: "vero", current: PASS, next: "brand new passphrase" }, T0, CHEAP);
    if (!changed.ok) throw new Error(changed.error.key);
    expect(await me(db, laptop.token)).toBeNull();
    expect(await me(db, changed.token)).toEqual({ id: "vero", displayName: "Vero" });
    // An access-code session from before is signed out too (same epoch rule).
    const [row] = await db.select({ e: users.sessionEpoch }).from(users).where(eq(users.id, "vero"));
    expect(row.e).toBe(1);
  });

  it("rate-limits attempts per person", async () => {
    const id = `rl-${randomUUID().slice(0, 6)}`;
    await createUser(db, { id, displayName: id });
    for (let i = 0; i < AUTH_LIMITS.changePerUser.max; i++) {
      await changePassphrase(db, E, { userId: id, current: "guess", next: PASS }, T0, CHEAP);
    }
    expect(await changePassphrase(db, E, { userId: id, current: "guess", next: PASS }, T0, CHEAP)).toMatchObject({
      ok: false,
      error: { key: "tooMany" },
    });
  });
});
