/**
 * `GET /api/kitchens/:id/changes?since=` (backend-data.md §6): the HTTP layer only. The
 * change-set summaries themselves come from `getChangesSince` (kitchen domain).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  member: true,
  since: [] as number[],
  fail: false,
  count: 1,
}));

vi.mock("@/server/session", () => ({
  getScope: async (kitchenId: string) => (state.member ? { db: {}, scope: { kitchenId, userId: "vero" } } : null),
}));
vi.mock("@/domains/kitchen/queries", () => ({
  getChangesSince: async (_db: unknown, _scope: unknown, since: number) => {
    state.since.push(since);
    if (state.fail) throw new Error("db down");
    return Array.from({ length: state.count }, (_, i) => ({ changeSetId: `cs${i}`, version: since + i + 1 }));
  },
}));

const { GET } = await import("@/app/api/kitchens/[kitchenId]/changes/route");
const get = (query: string) =>
  GET(new Request(`http://localhost/api/kitchens/k1/changes${query}`), { params: Promise.resolve({ kitchenId: "k1" }) });

beforeEach(() => {
  state.member = true;
  state.since = [];
  state.fail = false;
  state.count = 1;
});

describe("GET /api/kitchens/:id/changes", () => {
  it("returns the change sets after `since`, uncached", async () => {
    const res = await get("?since=4");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ changes: [{ changeSetId: "cs0", version: 5 }] });
    expect(state.since).toEqual([4]);
  });

  it("needs a whole, non-negative `since`", async () => {
    for (const q of ["", "?since=", "?since=-1", "?since=1.5", "?since=abc"]) {
      expect((await get(q)).status, q).toBe(400);
    }
    expect(state.since).toEqual([]);
  });

  it("refuses a non-member (403) and says so calmly when the read fails (500)", async () => {
    state.member = false;
    expect((await get("?since=0")).status).toBe(403);
    state.member = true;
    state.fail = true;
    const res = await get("?since=0");
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("CHANGES_UNAVAILABLE");
  });

  it("keeps the reply small after a long absence: the newest 200", async () => {
    state.count = 250;
    const { changes } = await (await get("?since=0")).json();
    expect(changes).toHaveLength(200);
    expect(changes[0].version).toBe(51);
  });
});
