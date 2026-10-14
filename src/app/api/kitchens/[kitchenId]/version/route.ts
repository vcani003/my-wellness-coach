/** `GET /api/kitchens/:id/version`: the version number only, polled by useKitchenSync (§6). */
import { getKitchenVersion } from "@/domains/kitchen/queries";
import { getScope } from "@/server/session";
import { json, jsonError } from "@/server/http";

export async function GET(_request: Request, { params }: { params: Promise<{ kitchenId: string }> }) {
  const ctx = await getScope((await params).kitchenId);
  if (!ctx) return jsonError(403);
  return json({ version: await getKitchenVersion(ctx.db, ctx.scope) });
}
