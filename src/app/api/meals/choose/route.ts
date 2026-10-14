/**
 * `POST /api/meals/choose`: Choose on an idea card (or a meal), then its recipe, streamed as
 * NDJSON turn events (backend-data.md §6). `{kitchenId, clientMessageId, ideaId | mealId}`.
 */
import { z } from "zod";
import { getMeals, handleChooseMeal } from "@/ai";
import { Id } from "@/contracts/common";
import { checkChatRateLimit } from "@/lib/rate-limit";
import { getScope } from "@/server/session";
import { isSameOrigin, jsonError } from "@/server/http";
import { ndjson } from "@/server/ndjson";

const Body = z.union([
  z.object({ kitchenId: Id, clientMessageId: Id, ideaId: Id }),
  z.object({ kitchenId: Id, clientMessageId: Id, mealId: Id }),
]);

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError(415);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400);

  const ctx = await getScope(parsed.data.kitchenId);
  if (!ctx) return jsonError(403);

  // A recipe is an AI call, so it counts against the same per-person limit as chat (0020).
  const limit = await checkChatRateLimit(ctx.db, ctx.session.userId);
  if (!limit.ok) {
    return Response.json(
      { error: limit.reason },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds), "cache-control": "no-store" } },
    );
  }

  const target = "ideaId" in parsed.data ? { ideaId: parsed.data.ideaId } : { mealId: parsed.data.mealId };
  return ndjson(
    handleChooseMeal({ db: ctx.db, scope: ctx.scope, meals: getMeals() }, { clientMessageId: parsed.data.clientMessageId, target }),
  );
}
