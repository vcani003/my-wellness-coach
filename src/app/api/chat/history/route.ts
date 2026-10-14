/**
 * `GET /api/chat/history?kitchenId=…&before=<cursor>&limit=30` (backend-data.md §6, P2 a):
 * your own saved chat in that kitchen, newest page first (oldest first within a page).
 * Never the other member's messages (H2, 0017).
 */
import { z } from "zod";
import type { Msg } from "@/contracts/common";
import { Id } from "@/contracts/common";
import { HISTORY_PAGE_DEFAULT, HISTORY_PAGE_MAX, listChatHistory } from "@/domains/chat/queries";
import { getScope } from "@/server/session";
import { json, jsonError } from "@/server/http";

const Query = z.object({
  kitchenId: Id,
  before: z.string().regex(/^\d{1,18}$/).optional(),
  limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_MAX).default(HISTORY_PAGE_DEFAULT),
});

const UNAVAILABLE: Msg = { code: "HISTORY_UNAVAILABLE", params: {}, text: "I couldn't load your earlier messages" };

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = Query.safeParse({
    kitchenId: params.get("kitchenId") ?? undefined,
    before: params.get("before") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!parsed.success) return jsonError(400);

  const ctx = await getScope(parsed.data.kitchenId);
  if (!ctx) return jsonError(403);

  try {
    return json(await listChatHistory(ctx.db, ctx.scope, { before: parsed.data.before, limit: parsed.data.limit }));
  } catch (error) {
    console.error("chat.history: read failed", { error });
    return jsonError(500, UNAVAILABLE);
  }
}
