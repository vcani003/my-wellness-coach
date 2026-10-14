/**
 * Staging for the tester agents (0021; backend-data.md §8, §10 "Staging") on PGlite: the
 * preview-build bootstrap, resetting a test kitchen, tester sign-in on staging only, and which
 * kitchen a tester lands in.
 */
import { NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLocalDb, type Db } from "@/db/client";
import { events, users } from "@/db/schema";
import { getKitchenState } from "@/domains/kitchen/queries";
import { resolveCurrentUser } from "@/lib/auth/current-user";
import { gate } from "@/lib/auth/gate";
import { issueSession } from "@/lib/auth/session";
import { attemptUnlock } from "@/lib/auth/unlock";
import { parseEnv } from "@/lib/env";
import { firstKitchenId } from "@/server/account/settings";
import { resetTestKitchen, TEST_RESET_LIMIT } from "@/server/test-reset";
import { kitchenStream } from "@/shared/events/types";
import { createUser } from "@/shared/identity";
import { requireMember } from "@/shared/membership";
import { getProfile } from "@/shared/profile/public";
import { bootstrap, HOME_KITCHEN } from "../../scripts/bootstrap";
import { ensureStagingKitchens, scenarioKitchenId } from "../../scripts/scenarios";
import { ok } from "../support/db";

const SECRET = "test-session-secret-0123456789abcdef";
const T1_CODE = "tester-one-code-111";
const T2_CODE = "tester-two-code-222";
const VERO_CODE = "vero-test-code-333";
const CODES = `tester-1=${T1_CODE},tester-2=${T2_CODE},vero=${VERO_CODE}`;
const NEON = "postgresql://u:p@ep-example.neon.tech/neondb?sslmode=require";
const T0 = new Date("2026-10-14T12:00:00Z");

const prodLike = { NODE_ENV: "production", DATABASE_URL: NEON, SESSION_SECRET: SECRET, ACCESS_CODES: CODES };
const ENVS = {
  production: parseEnv({ ...prodLike, VERCEL_ENV: "production" }),
  preview: parseEnv({ ...prodLike, VERCEL_ENV: "preview" }),
  local: parseEnv({ NODE_ENV: "development", SESSION_SECRET: SECRET, ACCESS_CODES: CODES }),
};

const SINGLE = scenarioKitchenId("single");
const HOUSEHOLD = scenarioKitchenId("household");
const add = (name: string) => ({ type: "item.add" as const, fields: { name: { value: name, basis: "said" as const, confidence: "high" as const } } });

let db: Db;
let close: () => Promise<void>;
let ip = 0;
const freshIp = () => `10.9.0.${++ip}`;

const itemNames = async (userId: string, kitchenId: string) =>
  (await getKitchenState(db, await requireMember(db, userId, kitchenId))).items.map((i) => i.name.value).sort();

beforeAll(async () => {
  ({ db, close } = await openLocalDb());
  await bootstrap(db); // the real Vero and Levi in "home"
  await ok(db, await requireMember(db, "vero", HOME_KITCHEN.id), [add("real olive oil")]);
});
afterAll(() => close());

describe("staging bootstrap (preview builds)", () => {
  it("creates the testers and both test kitchens, then does nothing on later builds", async () => {
    const first = await ensureStagingKitchens(db);
    expect(first).toEqual({ createdUsers: ["tester-1", "tester-2"], seededKitchens: ["single", "household"] });
    const testers = await db.select({ id: users.id, isTest: users.isTest }).from(users).where(eq(users.isTest, true));
    expect(testers.map((u) => u.id).sort()).toEqual(["tester-1", "tester-2"]);
    expect((await getProfile(db, "tester-2")).restrictions.map((r) => r.subject.value)).toEqual(["seafood"]);

    // A tester uses the kitchen; the next build must leave it alone (ensure, never wipe).
    await ok(db, await requireMember(db, "tester-1", SINGLE), [add("tester eggs")]);
    expect(await ensureStagingKitchens(db)).toEqual({ createdUsers: [], seededKitchens: [] });
    expect(await itemNames("tester-1", SINGLE)).toEqual(["tester eggs"]);
    expect(await itemNames("vero", HOME_KITCHEN.id)).toEqual(["real olive oil"]);
  });

  it("refuses when a tester ID belongs to a real account", async () => {
    const other = await openLocalDb();
    try {
      await createUser(other.db, { id: "tester-1", displayName: "Not a tester" });
      await expect(ensureStagingKitchens(other.db)).rejects.toThrow(/real account/);
    } finally {
      await other.close();
    }
  });
});

describe("resetting a test kitchen", () => {
  it("restores the seed, and touches nothing outside that test kitchen", async () => {
    await ensureStagingKitchens(db);
    await ok(db, await requireMember(db, "tester-1", SINGLE), [add("tester milk")]);
    await ok(db, await requireMember(db, "tester-2", HOUSEHOLD), [add("household rice")]);
    const homeBefore = await getKitchenState(db, await requireMember(db, "vero", HOME_KITCHEN.id));
    const homeEvents = async () => Number((await db.select({ n: count() }).from(events).where(eq(events.stream, kitchenStream(HOME_KITCHEN.id))))[0].n);
    const homeEventsBefore = await homeEvents();
    const realUsersBefore = await db.select().from(users).where(eq(users.isTest, false));

    expect(await resetTestKitchen(db, { userId: "tester-1", scenario: "single" }, T0)).toEqual({ ok: true, scenario: "single", kitchenId: SINGLE });
    expect(await itemNames("tester-1", SINGLE)).toEqual([]);
    expect((await getKitchenState(db, await requireMember(db, "tester-1", SINGLE))).version).toBe(0);
    expect(await itemNames("tester-2", HOUSEHOLD)).toEqual(["household rice"]); // the other test kitchen: untouched

    expect((await resetTestKitchen(db, { userId: "tester-2", scenario: "household" }, T0)).ok).toBe(true);
    expect(await itemNames("tester-2", HOUSEHOLD)).toEqual([]);
    expect((await getProfile(db, "tester-2")).restrictions.map((r) => [r.subject.value, r.note?.value])).toEqual([
      ["seafood", "can eat shellfish if medicine is on hand"],
    ]);

    expect((await resetTestKitchen(db, { userId: "tester-1", scenario: "single", afterShopping: true }, T0)).ok).toBe(true);
    expect(await itemNames("tester-1", SINGLE)).toEqual(["chicken thighs", "eggs", "spinach", "yogurt"]);

    // The real kitchen, its events and the real people are exactly as they were.
    expect(await getKitchenState(db, await requireMember(db, "vero", HOME_KITCHEN.id))).toEqual(homeBefore);
    expect(await homeEvents()).toBe(homeEventsBefore);
    expect(await db.select().from(users).where(eq(users.isTest, false))).toEqual(realUsersBefore);
  });

  it("refuses a real person and a tester who isn't a member of that kitchen", async () => {
    await ensureStagingKitchens(db);
    await ok(db, await requireMember(db, "tester-1", SINGLE), [add("keep me")]);
    expect(await resetTestKitchen(db, { userId: "vero", scenario: "single" }, T0)).toEqual({ ok: false, reason: "notAllowed" });
    expect(await resetTestKitchen(db, { userId: "vero", scenario: "household" }, T0)).toEqual({ ok: false, reason: "notAllowed" });
    expect(await resetTestKitchen(db, { userId: "tester-2", scenario: "single" }, T0)).toEqual({ ok: false, reason: "notAllowed" });
    expect(await resetTestKitchen(db, { userId: "nobody", scenario: "single" }, T0)).toEqual({ ok: false, reason: "notAllowed" });
    expect(await itemNames("tester-1", SINGLE)).toContain("keep me");
  });

  it("is rate-limited per tester", async () => {
    const hour = new Date("2026-11-01T10:00:00Z"); // its own window
    for (let i = 0; i < TEST_RESET_LIMIT.max; i++) {
      expect((await resetTestKitchen(db, { userId: "tester-2", scenario: "household" }, hour)).ok).toBe(true);
    }
    expect(await resetTestKitchen(db, { userId: "tester-2", scenario: "household" }, hour)).toMatchObject({ ok: false, reason: "tooMany" });
    expect((await resetTestKitchen(db, { userId: "tester-1", scenario: "household" }, hour)).ok).toBe(true); // others unaffected
  });

  it("puts a tester in the kitchen they last reset; a real person stays in their first kitchen", async () => {
    await ensureStagingKitchens(db);
    await resetTestKitchen(db, { userId: "tester-1", scenario: "household" }, new Date("2026-12-01T10:00:00Z"));
    expect(await firstKitchenId(db, "tester-1")).toBe(HOUSEHOLD);
    await resetTestKitchen(db, { userId: "tester-1", scenario: "single" }, new Date("2026-12-01T10:00:00Z"));
    expect(await firstKitchenId(db, "tester-1")).toBe(SINGLE);
    expect(await firstKitchenId(db, "tester-2")).toBe(HOUSEHOLD);
    expect(await firstKitchenId(db, "vero")).toBe(HOME_KITCHEN.id);
  });
});

describe("tester sign-in: staging only", () => {
  it("a tester code unlocks on preview, never in production or locally without the dev switch", async () => {
    await ensureStagingKitchens(db);
    const preview = await attemptUnlock(db, ENVS.preview, { code: T1_CODE, ip: freshIp() }, T0);
    expect(preview).toMatchObject({ ok: true, userId: "tester-1" });
    expect(await attemptUnlock(db, ENVS.production, { code: T1_CODE, ip: freshIp() }, T0)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await attemptUnlock(db, ENVS.local, { code: T2_CODE, ip: freshIp() }, T0)).toMatchObject({ ok: false, reason: "invalid" });
    // Real people unlock everywhere, staging included.
    expect(await attemptUnlock(db, ENVS.preview, { code: VERO_CODE, ip: freshIp() }, T0)).toMatchObject({ ok: true, userId: "vero" });
    expect(await attemptUnlock(db, ENVS.production, { code: VERO_CODE, ip: freshIp() }, T0)).toMatchObject({ ok: true, userId: "vero" });
  });

  it("a tester's session counts on preview only", async () => {
    await ensureStagingKitchens(db);
    const token = issueSession({ secret: SECRET, accessCodes: CODES, production: true }, "tester-1", T0)!;
    expect(await resolveCurrentUser(db, ENVS.preview, { sessionToken: token }, T0)).toEqual({ id: "tester-1", displayName: "Tester One" });
    expect(await resolveCurrentUser(db, ENVS.production, { sessionToken: token }, T0)).toBeNull();
    expect(await resolveCurrentUser(db, ENVS.local, { sessionToken: token }, T0)).toBeNull();
  });

  it("the gate answers /api/test/reset with 401 without a session", () => {
    for (const e of [ENVS.preview, ENVS.production]) {
      expect(gate(new NextRequest("https://staging.example/api/test/reset", { method: "POST" }), e, T0).status).toBe(401);
    }
  });
});
