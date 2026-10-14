/**
 * `GET /api/me/export` (0015; backend-data.md §6, §7): your data as one JSON download.
 * Your profile with provenance, your own chats (never another member's, H2), and the events and
 * current state of every kitchen you belong to. 401 signed out, 500 `EXPORT_FAILED`.
 */
import type { Msg } from "@/contracts/common";
import { getCurrentUser } from "@/lib/auth/current-user";
import { buildExport } from "@/server/account/export";
import { getDb } from "@/server/db";
import { jsonError } from "@/server/http";

const FAILED: Msg = { code: "EXPORT_FAILED", params: {}, text: "I couldn't put your data together just now" };
const SIGNED_OUT: Msg = { code: "UNAUTHENTICATED", params: {}, text: "Please unlock the app first" };

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, SIGNED_OUT);
  try {
    const now = new Date();
    const data = await buildExport(await getDb(), user.id, now);
    if (!data) return jsonError(401, SIGNED_OUT);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="kitchen-data-${now.toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("account.export: failed", { error });
    return jsonError(500, FAILED);
  }
}
