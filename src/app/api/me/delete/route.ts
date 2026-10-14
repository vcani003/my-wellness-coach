/**
 * `POST /api/me/delete` (D1, 0015; backend-data.md §6, §7): delete your data, then sign you out.
 * Body `{ confirm: "delete my data" }` (DELETE_CONFIRMATION_PHRASE; case and outer spaces ignored),
 * so nothing is deleted by a stray or cross-site request.
 *
 * 200 `{ ok: true }` (this device's cookie is cleared: go to /unlock) · 400 `CONFIRMATION_REQUIRED`
 * · 401 signed out · 403 cross-site · 500 `DELETE_FAILED` (nothing was deleted).
 */
import type { Msg } from "@/contracts/common";
import { DELETE_CONFIRMATION_PHRASE, DeleteRequest } from "@/contracts/settings";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteMyData } from "@/server/account/delete";
import { clearSessionCookie } from "@/server/account/sessions";
import { getDb } from "@/server/db";
import { isSameOrigin, json, jsonError } from "@/server/http";

const CONFIRM: Msg = {
  code: "CONFIRMATION_REQUIRED",
  params: { phrase: DELETE_CONFIRMATION_PHRASE },
  text: `To delete your data, confirm with "${DELETE_CONFIRMATION_PHRASE}"`,
};
const FAILED: Msg = { code: "DELETE_FAILED", params: {}, text: "I couldn't delete your data just now, so nothing was deleted" };
const SIGNED_OUT: Msg = { code: "UNAUTHENTICATED", params: {}, text: "Please unlock the app first" };

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403);
  const user = await getCurrentUser();
  if (!user) return jsonError(401, SIGNED_OUT);

  const body = DeleteRequest.safeParse(await request.json().catch(() => null));
  if (!body.success || body.data.confirm.trim().toLowerCase() !== DELETE_CONFIRMATION_PHRASE) return jsonError(400, CONFIRM);

  const outcome = await deleteMyData(await getDb(), user.id);
  if (!outcome.ok) {
    if (outcome.reason === "not_found") {
      await clearSessionCookie();
      return jsonError(401, SIGNED_OUT);
    }
    return jsonError(500, FAILED);
  }
  await clearSessionCookie();
  return json({ ok: true });
}
