/**
 * `POST /api/test/reset` (0021; backend-data.md §8, §10 "Staging"): STAGING ONLY. Resets a test
 * kitchen to its seed for the tester agents. Body `{ scenario: "single" | "household",
 * afterShopping?: boolean }` (`afterShopping`: `single` starts with journey step 1 done).
 *
 * - **404, doing nothing, unless tester accounts are allowed here** (`testersAllowed`: Vercel
 *   preview, or local dev with the dev switch). Checked once when this module loads and again on
 *   every request, so a production instance can't switch it on later.
 * - 403 cross-site · 401 signed out (the proxy answers 401 first) · 403 `NOT_ALLOWED` for a real
 *   person, or a tester who isn't a member of that test kitchen · 400 bad body · 429 too many.
 * - 200 `{ ok: true, scenario, kitchenId }`. A tester is then in that kitchen (newest wins).
 */
import { z } from "zod";
import type { Msg } from "@/contracts/common";
import { getCurrentUser } from "@/lib/auth/current-user";
import { testersAllowed } from "@/lib/deployment";
import { getDb } from "@/server/db";
import { isSameOrigin, json, jsonError } from "@/server/http";
import { resetTestKitchen } from "@/server/test-reset";
import { STAGING_SCENARIOS } from "../../../../../scripts/scenarios";

/** Decided once per server instance: false in production, whatever happens later. */
const ENABLED_AT_LOAD = testersAllowed(process.env);

const Body = z.object({ scenario: z.enum(STAGING_SCENARIOS), afterShopping: z.boolean().optional() }).strict();

const SIGNED_OUT: Msg = { code: "UNAUTHENTICATED", params: {}, text: "Please unlock the app first" };
const BAD_BODY: Msg = { code: "INVALID_REQUEST", params: {}, text: 'Send { "scenario": "single" } or { "scenario": "household" }' };
const FAILED: Msg = { code: "TEST_RESET_FAILED", params: {}, text: "The test kitchen couldn't be reset just now. Try again." };

const notFound = () => new Response(null, { status: 404 });

export async function POST(request: Request): Promise<Response> {
  if (!ENABLED_AT_LOAD || !testersAllowed(process.env)) return notFound();
  if (!isSameOrigin(request)) return jsonError(403);
  const user = await getCurrentUser();
  if (!user) return jsonError(401, SIGNED_OUT);

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, BAD_BODY);

  try {
    const r = await resetTestKitchen(await getDb(), { userId: user.id, ...body.data });
    if (r.ok) return json(r);
    if (r.reason === "tooMany") {
      const minutes = Math.max(1, Math.ceil(r.retryAfterSeconds / 60));
      return Response.json(
        { error: { code: "TOO_MANY_RESETS", params: { minutes }, text: `Too many resets. Try again in ${minutes} min.` } },
        { status: 429, headers: { "cache-control": "no-store", "retry-after": String(r.retryAfterSeconds) } },
      );
    }
    return jsonError(403);
  } catch (err) {
    console.error("[test/reset] failed:", (err as Error).message);
    return jsonError(500, FAILED);
  }
}
