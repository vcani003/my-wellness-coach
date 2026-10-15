/**
 * `GET /api/kitchens/:id/past-meals?q=&limit=` (0040 A1, backend-data.md §6): "Cooked before",
 * the kitchen's Done meals, one row per dish, newest first. Body `PastMealsPage {meals}`.
 * `q` (optional, ≤ 200 chars) matches the name or an ingredient, ignoring case and accents;
 * `limit` 1–100, default 20. 400 bad query, 403 not a member, 500 `PAST_MEALS_UNAVAILABLE`.
 */
import { z } from "zod";
import type { Msg } from "@/contracts/common";
import { PAST_MEALS_DEFAULT_LIMIT, PAST_MEALS_MAX_LIMIT, type PastMealsPage } from "@/contracts/past-meals";
import { listPastMeals } from "@/domains/kitchen/queries";
import { getScope } from "@/server/session";
import { json, jsonError } from "@/server/http";

const Query = z.object({
  q: z.string().max(200).optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(PAST_MEALS_MAX_LIMIT))
    .optional(),
});
const UNAVAILABLE: Msg = { code: "PAST_MEALS_UNAVAILABLE", params: {}, text: "I couldn't load the meals you've cooked" };

export async function GET(request: Request, { params }: { params: Promise<{ kitchenId: string }> }): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const query = Query.safeParse({ q: search.get("q") ?? undefined, limit: search.get("limit") ?? undefined });
  if (!query.success) return jsonError(400);
  const ctx = await getScope((await params).kitchenId);
  if (!ctx) return jsonError(403);
  try {
    const meals = await listPastMeals(ctx.db, ctx.scope, {
      q: query.data.q,
      limit: query.data.limit ?? PAST_MEALS_DEFAULT_LIMIT,
    });
    return json({ meals } satisfies PastMealsPage);
  } catch (error) {
    console.error("kitchen.past-meals: read failed", { error });
    return jsonError(500, UNAVAILABLE);
  }
}
