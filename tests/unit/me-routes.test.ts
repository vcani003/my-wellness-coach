/**
 * `POST /api/me/delete` and `GET /api/me/export` (0015, D1): the HTTP layer only. The data rules
 * themselves are tested on Postgres in tests/integration/settings.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "levi", displayName: "Levi" } as { id: string; displayName: string } | null,
  deleted: [] as string[],
  cleared: 0,
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/server/db", () => ({ getDb: async () => ({}) }));
vi.mock("@/server/account/sessions", () => ({
  clearSessionCookie: async () => {
    state.cleared++;
  },
}));
vi.mock("@/server/account/delete", () => ({
  deleteMyData: async (_db: unknown, id: string) => {
    state.deleted.push(id);
    return { ok: true, deletedKitchenIds: [], keptKitchenIds: [] };
  },
}));
vi.mock("@/server/account/export", () => ({
  buildExport: async (_db: unknown, id: string) => ({ format: "kitchen-assistant-export", you: { id } }),
}));

const { POST } = await import("@/app/api/me/delete/route");
const { GET } = await import("@/app/api/me/export/route");

const post = (body: unknown, origin = "http://localhost") =>
  POST(
    new Request("http://localhost/api/me/delete", {
      method: "POST",
      headers: { "content-type": "application/json", origin, host: "localhost" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  state.user = { id: "levi", displayName: "Levi" };
  state.deleted = [];
  state.cleared = 0;
});

describe("POST /api/me/delete", () => {
  it("needs the confirmation phrase; nothing is deleted without it", async () => {
    for (const body of [{}, { confirm: "yes" }, { confirm: "delete my dat" }, null]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("CONFIRMATION_REQUIRED");
    }
    expect(state.deleted).toEqual([]);
  });

  it("deletes the signed-in person and clears this device's cookie", async () => {
    const res = await post({ confirm: "  Delete my data " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.deleted).toEqual(["levi"]);
    expect(state.cleared).toBe(1);
  });

  it("refuses a cross-site request and a signed-out one", async () => {
    expect((await post({ confirm: "delete my data" }, "https://evil.example")).status).toBe(403);
    state.user = null;
    expect((await post({ confirm: "delete my data" })).status).toBe(401);
    expect(state.deleted).toEqual([]);
  });
});

describe("GET /api/me/export", () => {
  it("is a JSON download of your own data", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="kitchen-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ you: { id: "levi" } });
  });

  it("is 401 when signed out", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
  });
});
