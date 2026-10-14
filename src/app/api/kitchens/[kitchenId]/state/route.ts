/** `GET /api/kitchens/:id/state`: the full current KitchenState (backend-data.md §6). */
import { getKitchenState } from "@/domains/kitchen/queries";
import { getScope } from "@/server/session";
import { json, jsonError } from "@/server/http";

export async function GET(_request: Request, { params }: { params: Promise<{ kitchenId: string }> }) {
  const ctx = await getScope((await params).kitchenId);
  if (!ctx) return jsonError(403);
  return json(await getKitchenState(ctx.db, ctx.scope));
}
