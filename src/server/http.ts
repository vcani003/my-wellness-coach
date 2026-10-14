/** Small helpers for the thin route handlers in src/app/api (frontend.md §7). */
import "server-only";
import type { Msg } from "@/contracts/common";
import { msg } from "@/shared/messages";

/** Cross-site requests are refused: if the browser says where it came from, it must be here. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients; browsers always send Origin on POST
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function jsonError(status: number, reason: Msg = msg("NOT_ALLOWED")): Response {
  return Response.json({ error: reason }, { status, headers: { "cache-control": "no-store" } });
}

export function json(body: unknown): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
