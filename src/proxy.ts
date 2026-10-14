/**
 * Next.js 16 Proxy (formerly Middleware; runs on the Node.js runtime). Applies the interim
 * access-code gate to every page and API route; the gate itself lets `/unlock` and static
 * assets through (src/lib/auth/gate.ts, where it's tested).
 *
 * Fails closed: if the environment is invalid (e.g. a required production variable is missing),
 * every request gets a 500 rather than an unprotected app.
 */
import { NextResponse, type NextRequest } from "next/server";
import { gate } from "@/lib/auth/gate";
import { env } from "@/lib/env";

export function proxy(req: NextRequest) {
  let e;
  try {
    e = env();
  } catch (err) {
    console.error("[proxy]", (err as Error).message); // names only, never values
    return new NextResponse("The server isn't configured correctly.", { status: 500 });
  }
  return gate(req, e);
}

export const config = {
  // Skip Next's own build output; everything else goes through `gate`.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
