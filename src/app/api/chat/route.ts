/** `POST /api/chat`: one chat turn, streamed as NDJSON turn events (backend-data.md §6). */
import { z } from "zod";
import { getInterpreter, getMeals, handleChatTurn } from "@/ai";
import { Id } from "@/contracts/common";
import { checkChatRateLimit } from "@/lib/rate-limit";
import { getScope } from "@/server/session";
import { isSameOrigin, jsonError } from "@/server/http";
import { ndjson } from "@/server/ndjson";

const Body = z.object({
  kitchenId: Id,
  clientMessageId: Id,
  text: z.string().trim().min(1).max(4000),
  // Accepted but ignored: recent turns now come from the saved chat (P2 a).
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(10)
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403);
  if (!request.headers.get("content-type")?.includes("application/json")) return jsonError(415);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400);

  const ctx = await getScope(parsed.data.kitchenId);
  if (!ctx) return jsonError(403);

  // Per-person message limits protect the AI spend cap (0020, backend-data.md §7).
  const limit = await checkChatRateLimit(ctx.db, ctx.session.userId);
  if (!limit.ok) {
    return Response.json(
      { error: limit.reason },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds), "cache-control": "no-store" } },
    );
  }

  return ndjson(
    handleChatTurn(
      { db: ctx.db, scope: ctx.scope, interpreter: getInterpreter({ db: ctx.db, scope: ctx.scope }), meals: getMeals() },
      { clientMessageId: parsed.data.clientMessageId, text: parsed.data.text },
    ),
  );
}
