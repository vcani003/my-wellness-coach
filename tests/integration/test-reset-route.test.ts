/**
 * `POST /api/test/reset` (0021) on PGlite: the guard matrix (production / preview / development ×
 * tester / real person / signed out), the 404-by-construction in production (checked when the
 * module loads and on every request), and the body. Only the session is stubbed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openLocalDb, type Db } from "@/db/client";
import { getKitchenState } from "@/domains/kitchen/queries";
import { requireMember } from "@/shared/membership";
import { bootstrap } from "../../scripts/bootstrap";
import { ensureStagingKitchens, scenarioKitchenId } from "../../scripts/scenarios";
import { ok } from "../support/db";

const state = vi.hoisted(() => ({ db: undefined as unknown, user: null as { id: string; displayName: string } | null }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/server/db", () => ({ getDb: async () => state.db }));

const SINGLE = scenarioKitchenId("single");
const ENVS = {
  production: { VERCEL_ENV: "production", NODE_ENV: "production", DEV_ACTING_AS: "" },
  preview: { VERCEL_ENV: "preview", NODE_ENV: "production", DEV_ACTING_AS: "" },
  development: { VERCEL_ENV: "", NODE_ENV: "development", DEV_ACTING_AS: "" },
  devSwitch: { VERCEL_ENV: "", NODE_ENV: "development", DEV_ACTING_AS: "tester-1" },
} as const;
type EnvName = keyof typeof ENVS;

const USERS = {
  tester: { id: "tester-1", displayName: "Tester One" },
  real: { id: "vero", displayName: "Vero" },
  signedOut: null,
} as const;

let db: Db;
let close: () => Promise<void>;

function stub(name: EnvName) {
  for (const [k, v] of Object.entries(ENVS[name])) vi.stubEnv(k, v);
}

/** A fresh copy of the route module, loaded under `name`'s environment. */
async function loadRoute(name: EnvName) {
  stub(name);
  vi.resetModules();
  return (await import("@/app/api/test/reset/route")).POST;
}

const post = (POST: (r: Request) => Promise<Response>, body: unknown = { scenario: "single" }, origin = "https://staging.example") =>
  POST(
    new Request("https://staging.example/api/test/reset", {
      method: "POST",
      headers: { "content-type": "application/json", origin, host: "staging.example" },
      body: JSON.stringify(body),
    }),
  );

const singleItems = async () => (await getKitchenState(db, await requireMember(db, "tester-1", SINGLE))).items.length;

/** Dirty the single test kitchen so a reset is visible. */
async function dirty() {
  await ok(db, await requireMember(db, "tester-1", SINGLE), [
    { type: "item.add", fields: { name: { value: `milk ${Math.random()}`, basis: "said", confidence: "high" } } },
  ]);
}

beforeAll(async () => {
  ({ db, close } = await openLocalDb());
  state.db = db;
  await bootstrap(db);
  await ensureStagingKitchens(db);
});
afterAll(() => close());
afterEach(() => {
  vi.unstubAllEnvs();
  state.user = null;
});

describe("guard matrix", () => {
  const expected: Record<EnvName, Record<keyof typeof USERS, number>> = {
    production: { tester: 404, real: 404, signedOut: 404 },
    preview: { tester: 200, real: 403, signedOut: 401 },
    development: { tester: 404, real: 404, signedOut: 404 },
    devSwitch: { tester: 200, real: 403, signedOut: 401 },
  };
  for (const envName of Object.keys(expected) as EnvName[]) {
    for (const who of Object.keys(USERS) as (keyof typeof USERS)[]) {
      const status = expected[envName][who];
      it(`${envName} × ${who} → ${status}${status === 200 ? " (reset)" : " (nothing changes)"}`, async () => {
        const POST = await loadRoute(envName);
        await dirty();
        const before = await singleItems();
        state.user = USERS[who];
        const res = await post(POST);
        expect(res.status).toBe(status);
        expect(await singleItems()).toBe(status === 200 ? 0 : before);
        if (status === 404) expect(await res.text()).toBe("");
        if (status === 200) expect(await res.json()).toEqual({ ok: true, scenario: "single", kitchenId: SINGLE });
      });
    }
  }
});

describe("production is a 404 by construction", () => {
  it("a module loaded in production stays off even if the environment later says preview", async () => {
    const POST = await loadRoute("production");
    stub("preview");
    await dirty();
    const before = await singleItems();
    state.user = USERS.tester;
    expect((await post(POST)).status).toBe(404);
    expect(await singleItems()).toBe(before);
  });

  it("a module loaded on preview turns off if a request sees production", async () => {
    const POST = await loadRoute("preview");
    stub("production");
    await dirty();
    const before = await singleItems();
    state.user = USERS.tester;
    expect((await post(POST)).status).toBe(404);
    expect(await singleItems()).toBe(before);
  });
});

describe("on staging", () => {
  it("refuses a bad body, the demo scenario and a cross-site request", async () => {
    const POST = await loadRoute("preview");
    state.user = USERS.tester;
    for (const body of [{}, { scenario: "demo" }, { scenario: "home" }, { scenario: "single", extra: 1 }, null]) {
      expect((await post(POST, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post(POST, { scenario: "single" }, "https://evil.example")).status).toBe(403);
  });

  it("refuses a tester who isn't a member of that test kitchen", async () => {
    const POST = await loadRoute("preview");
    await dirty();
    const before = await singleItems();
    state.user = { id: "tester-2", displayName: "Tester Two" };
    expect((await post(POST, { scenario: "single" })).status).toBe(403);
    expect(await singleItems()).toBe(before);
    expect((await post(POST, { scenario: "household" })).status).toBe(200);
  });
});
