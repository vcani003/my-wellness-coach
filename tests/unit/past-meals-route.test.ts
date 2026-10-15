/** `GET /api/kitchens/:id/past-meals` (0040 A1): the HTTP layer only; the list comes from `listPastMeals`. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  member: true,
  calls: [] as unknown[],
  fail: false,
}));

vi.mock("@/server/session", () => ({
  getScope: async (kitchenId: string) => (state.member ? { db: {}, scope: { kitchenId, userId: "ana" } } : null),
}));
vi.mock("@/domains/kitchen/queries", () => ({
  listPastMeals: async (_db: unknown, _scope: unknown, opts: unknown) => {
    state.calls.push(opts);
    if (state.fail) throw new Error("db down");
    return [{ mealId: "m1", title: "Chicken curry" }];
  },
}));

const { GET } = await import("@/app/api/kitchens/[kitchenId]/past-meals/route");
const get = (query: string) =>
  GET(new Request(`http://localhost/api/kitchens/k1/past-meals${query}`), { params: Promise.resolve({ kitchenId: "k1" }) });

beforeEach(() => {
  state.member = true;
  state.calls = [];
  state.fail = false;
});

describe("GET /api/kitchens/:id/past-meals", () => {
  it("returns {meals}, uncached, with q and limit passed through (default 20)", async () => {
    const res = await get("?q=n%C6%B0%E1%BB%9Bc%20m%E1%BA%AFm&limit=5");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ meals: [{ mealId: "m1", title: "Chicken curry" }] });
    await get("");
    expect(state.calls).toEqual([
      { q: "nước mắm", limit: 5 },
      { q: undefined, limit: 20 },
    ]);
  });

  it("refuses a bad limit or an overlong q (400)", async () => {
    for (const q of ["?limit=0", "?limit=101", "?limit=-1", "?limit=abc", "?limit=1.5", `?q=${"a".repeat(201)}`]) {
      expect((await get(q)).status, q).toBe(400);
    }
    expect(state.calls).toEqual([]);
  });

  it("refuses a non-member (403) and says so calmly when the read fails (500)", async () => {
    state.member = false;
    expect((await get("")).status).toBe(403);
    state.member = true;
    state.fail = true;
    const res = await get("");
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("PAST_MEALS_UNAVAILABLE");
  });
});
