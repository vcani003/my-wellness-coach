/**
 * `POST /api/dev/reset`: DEV ONLY. Resets the local demo kitchen to its seed (dev bar, e2e tests).
 * Answers 404 whenever the dev "acting as" switch is off, which is always in production.
 */
import { isDevActingAsOn } from "@/server/dev-mode";
import { isSameOrigin, json, jsonError } from "@/server/http";
import { resetDemoKitchen } from "@/server/session";

export async function POST(request: Request): Promise<Response> {
  if (!isDevActingAsOn()) return new Response(null, { status: 404 });
  if (!isSameOrigin(request)) return jsonError(403);
  await resetDemoKitchen();
  return json({ ok: true });
}
