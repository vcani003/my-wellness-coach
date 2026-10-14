/**
 * The interim access-code gate (backend-data.md §7) on PGlite: the proxy's redirect, unlocking,
 * rate limiting, the session cookie and `getCurrentUser`'s core.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLocalDb, type Db } from "@/db/client";
import { createUser } from "@/shared/identity";
import { resolveCurrentUser } from "@/lib/auth/current-user";
import { gate, isPublicPath } from "@/lib/auth/gate";
import { matchAccessCode, parseAccessCodes } from "@/lib/auth/access-codes";
import { SESSION_MAX_AGE_S, sessionCookieName, verifySession } from "@/lib/auth/session";
import { attemptUnlock } from "@/lib/auth/unlock";
import { UNLOCK_LIMITS } from "@/lib/rate-limit";
import { parseEnv, type Env } from "@/lib/env";
import { bootstrap } from "../../scripts/bootstrap";

const VERO_CODE = "vero-test-code-111";
const LEVI_CODE = "levi-test-code-222";
const SECRET = "test-session-secret-0123456789abcdef";

const makeEnv = (over: Record<string, string> = {}): Env =>
  parseEnv({ NODE_ENV: "test", SESSION_SECRET: SECRET, ACCESS_CODES: `vero=${VERO_CODE},levi=${LEVI_CODE}`, ...over });

const cfg = (e: Env) => ({ secret: e.SESSION_SECRET!, accessCodes: e.ACCESS_CODES!, production: false });
const COOKIE = sessionCookieName(false);
const T0 = new Date("2026-10-14T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

const request = (path: string, token?: string) =>
  new NextRequest(`http://localhost${path}`, token ? { headers: { cookie: `${COOKIE}=${token}` } } : undefined);

let db: Db;
let close: () => Promise<void>;
let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

beforeAll(async () => {
  ({ db, close } = await openLocalDb());
  await bootstrap(db);
});
afterAll(() => close());

async function unlockOk(code: string, e = makeEnv(), now = T0) {
  const r = await attemptUnlock(db, e, { code, ip: freshIp() }, now);
  if (!r.ok) throw new Error(`unlock failed: ${r.reason}`);
  return r;
}

describe("proxy gate", () => {
  it("redirects a page with no cookie to /unlock, and answers 401 for the API", () => {
    const page = gate(request("/"), makeEnv(), T0);
    expect(page.status).toBe(307);
    expect(new URL(page.headers.get("location")!).pathname).toBe("/unlock");

    const api = gate(request("/api/chat"), makeEnv(), T0);
    expect(api.status).toBe(401);
  });

  it("lets /unlock and static assets through, but never an API path", () => {
    for (const p of ["/unlock", "/_next/static/chunks/app.js", "/favicon.ico", "/icons/apple-touch.png"]) {
      expect(isPublicPath(p), p).toBe(true);
    }
    for (const p of ["/", "/unlock/extra", "/unlockx", "/api/chat", "/api/me/export.png", "/kitchen"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
    expect(gate(request("/unlock"), makeEnv(), T0).headers.get("x-middleware-next")).toBe("1");
  });

  it("passes a valid session through", async () => {
    const { token } = await unlockOk(VERO_CODE);
    const res = gate(request("/", token), makeEnv(), T0);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.cookies.get(COOKIE)).toBeUndefined(); // fresh: no need to roll yet
  });

  it("rolls the session forward when used after a day (1-year rolling, 0017)", async () => {
    const { token } = await unlockOk(VERO_CODE);
    const res = gate(request("/", token), makeEnv(), later(2 * 86_400_000));
    const rolled = res.cookies.get(COOKIE);
    expect(rolled?.value).toBeTruthy();
    expect(rolled?.httpOnly).toBe(true);
    expect(rolled?.sameSite).toBe("lax");
    expect(rolled?.maxAge).toBe(SESSION_MAX_AGE_S);
    expect(verifySession(cfg(makeEnv()), rolled!.value, later(2 * 86_400_000))!.exp).toBeGreaterThan(
      verifySession(cfg(makeEnv()), token, T0)!.exp,
    );
  });

  it("rejects a session unused for over a year", async () => {
    const { token } = await unlockOk(VERO_CODE);
    expect(gate(request("/", token), makeEnv(), later((SESSION_MAX_AGE_S + 1) * 1000)).status).toBe(307);
  });

  it("is skipped by the dev-only acting-as switch, outside production", () => {
    const e = parseEnv({ NODE_ENV: "development", DEV_ACTING_AS: "vero" });
    expect(gate(request("/"), e, T0).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("unlocking", () => {
  it("a good code gives a session for the right user", async () => {
    const vero = await unlockOk(VERO_CODE);
    expect(vero.userId).toBe("vero");
    expect(await resolveCurrentUser(db, makeEnv(), { sessionToken: vero.token }, T0)).toEqual({ id: "vero", displayName: "Vero" });

    const levi = await unlockOk(`  ${LEVI_CODE} `); // stray spaces from a phone keyboard are fine
    expect(await resolveCurrentUser(db, makeEnv(), { sessionToken: levi.token }, T0)).toEqual({ id: "levi", displayName: "Levi" });
  });

  it("rejects a bad code", async () => {
    const r = await attemptUnlock(db, makeEnv(), { code: "not-the-code-123", ip: freshIp() }, T0);
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(await attemptUnlock(db, makeEnv(), { code: VERO_CODE.slice(0, -1), ip: freshIp() }, T0)).toMatchObject({ reason: "invalid" });
  });

  it("rate-limits an IP after 5 tries in 15 minutes, even with the right code", async () => {
    const ip = freshIp();
    const now = new Date("2026-10-14T13:00:00Z");
    for (let i = 0; i < UNLOCK_LIMITS.perIp.max; i++) {
      expect(await attemptUnlock(db, makeEnv(), { code: `wrong-code-attempt-${i}`, ip }, now)).toMatchObject({ reason: "invalid" });
    }
    const blocked = await attemptUnlock(db, makeEnv(), { code: VERO_CODE, ip }, now);
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(blocked.ok === false && blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Another IP isn't affected, and the same IP may try again in the next window.
    expect((await attemptUnlock(db, makeEnv(), { code: VERO_CODE, ip: freshIp() }, now)).ok).toBe(true);
    expect((await attemptUnlock(db, makeEnv(), { code: VERO_CODE, ip }, new Date(now.getTime() + 15 * 60_000))).ok).toBe(true);
  });

  it("caps attempts overall, across IPs", async () => {
    const now = new Date("2026-10-20T08:00:00Z"); // its own hour window
    for (let i = 0; i < UNLOCK_LIMITS.global.max; i++) {
      await attemptUnlock(db, makeEnv(), { code: "wrong-code-xxxx", ip: freshIp() }, now);
    }
    expect(await attemptUnlock(db, makeEnv(), { code: VERO_CODE, ip: freshIp() }, now)).toMatchObject({ reason: "rate_limited" });
  });

  it("refuses a code whose user doesn't exist yet, or is a tester account", async () => {
    await createUser(db, { id: "tester-x", displayName: "Tester X", isTest: true });
    const e = makeEnv({ ACCESS_CODES: `vero=${VERO_CODE},nobody=nobody-code-12345,tester-x=tester-code-12345` });
    expect(await attemptUnlock(db, e, { code: "nobody-code-12345", ip: freshIp() }, T0)).toMatchObject({ reason: "invalid" });
    expect(await attemptUnlock(db, e, { code: "tester-code-12345", ip: freshIp() }, T0)).toMatchObject({ reason: "invalid" });
  });

  it("says when the gate isn't configured", async () => {
    const e = parseEnv({ NODE_ENV: "test" });
    expect(await attemptUnlock(db, e, { code: VERO_CODE, ip: freshIp() }, T0)).toEqual({ ok: false, reason: "not_configured" });
  });

  it("matches codes in constant time over every entry", () => {
    const codes = parseAccessCodes(`vero=${VERO_CODE},levi=${LEVI_CODE}`);
    expect(matchAccessCode(codes, LEVI_CODE)).toBe("levi");
    expect(matchAccessCode(codes, "")).toBeNull();
  });
});

describe("session cookie", () => {
  it("rejects a tampered cookie", async () => {
    const { token } = await unlockOk(VERO_CODE);
    const [data, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, u: "levi" })).toString("base64url");
    const flipped = sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA");

    for (const bad of [`${forged}.${sig}`, `${data}.${flipped}`, `${data}`, `${data}.${sig}.x`, "garbage", ""]) {
      expect(verifySession(cfg(makeEnv()), bad, T0)).toBeNull();
      expect(await resolveCurrentUser(db, makeEnv(), { sessionToken: bad }, T0)).toBeNull();
      expect(gate(request("/", bad), makeEnv(), T0).status).toBe(307);
    }
    // Signed with another secret.
    expect(verifySession({ ...cfg(makeEnv()), secret: "another-secret-0123456789abcdefgh" }, token, T0)).toBeNull();
  });

  it("changing someone's code signs out just them", async () => {
    const vero = await unlockOk(VERO_CODE);
    const levi = await unlockOk(LEVI_CODE);
    const changed = makeEnv({ ACCESS_CODES: `vero=new-vero-code-999,levi=${LEVI_CODE}` });
    expect(await resolveCurrentUser(db, changed, { sessionToken: vero.token }, T0)).toBeNull();
    expect(await resolveCurrentUser(db, changed, { sessionToken: levi.token }, T0)).toMatchObject({ id: "levi" });
  });

  it("ignores the dev acting-as cookie unless the dev switch is on", async () => {
    expect(await resolveCurrentUser(db, makeEnv(), { devActingAs: "vero" }, T0)).toBeNull();
    const dev = parseEnv({ NODE_ENV: "development", DEV_ACTING_AS: "vero" });
    expect(await resolveCurrentUser(db, dev, {}, T0)).toMatchObject({ id: "vero" });
    expect(await resolveCurrentUser(db, dev, { devActingAs: "levi" }, T0)).toMatchObject({ id: "levi" });
  });
});
