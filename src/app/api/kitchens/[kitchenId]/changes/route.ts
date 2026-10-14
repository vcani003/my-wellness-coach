/**
 * `GET /api/kitchens/:id/changes?since=<version>` (backend-data.md §6): change-set summaries
 * (`Msg` + actor) after that version, oldest first, for "Since your last visit" and the live
 * removal cue (ux.md §6). Body `{changes: ChangeSetSummary[]}`; at most the newest
 * `CHANGES_MAX`, so a long absence can't make a huge reply (the UI says "and N more").
 */
import { z } from "zod";
import type { Msg } from "@/contracts/common";
import { getChangesSince } from "@/domains/kitchen/queries";
import { getScope } from "@/server/session";
import { json, jsonError } from "@/server/http";

const CHANGES_MAX = 200;
const Since = z.string().regex(/^\d{1,15}$/).transform(Number);
const UNAVAILABLE: Msg = { code: "CHANGES_UNAVAILABLE", params: {}, text: "I couldn't load the recent changes" };

export async function GET(request: Request, { params }: { params: Promise<{ kitchenId: string }> }): Promise<Response> {
  const since = Since.safeParse(new URL(request.url).searchParams.get("since") ?? undefined);
  if (!since.success) return jsonError(400);
  const ctx = await getScope((await params).kitchenId);
  if (!ctx) return jsonError(403);
  try {
    const changes = await getChangesSince(ctx.db, ctx.scope, since.data);
    return json({ changes: changes.slice(-CHANGES_MAX) });
  } catch (error) {
    console.error("kitchen.changes: read failed", { error });
    return jsonError(500, UNAVAILABLE);
  }
}
