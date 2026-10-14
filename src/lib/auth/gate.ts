/**
 * The interim access-code gate (backend-data.md §7), run by `src/proxy.ts` on every request.
 * Everything needs a valid session except `/unlock` and static assets. Pages without one are
 * sent to `/unlock`; API routes get a 401. A valid session is rolled forward (0017: 1 year,
 * renewed on use). This is the outer lock; `getCurrentUser()` checks again in each handler.
 */
import { NextResponse, type NextRequest } from "next/server";
import { devActingAsEnabled, type Env } from "@/lib/env";
import { issueSession, sessionCookieName, sessionCookieOptions, shouldRefresh, verifySession } from "./session";

const PUBLIC_EXACT = new Set(["/unlock", "/favicon.ico", "/robots.txt", "/manifest.webmanifest"]);
const STATIC_FILE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|webmanifest)$/i;

/** Paths anyone may load: the unlock page and static assets (never an API route). */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image")) return true;
  if (pathname.startsWith("/api/") || pathname === "/api") return false;
  return STATIC_FILE.test(pathname);
}

export function gate(req: NextRequest, e: Env, now: Date = new Date()): NextResponse {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname) || devActingAsEnabled(e)) return NextResponse.next();

  const production = e.NODE_ENV === "production";
  const cfg = e.SESSION_SECRET && e.ACCESS_CODES ? { secret: e.SESSION_SECRET, accessCodes: e.ACCESS_CODES, production } : null;
  const name = sessionCookieName(production);
  const session = cfg ? verifySession(cfg, req.cookies.get(name)?.value, now) : null;

  if (!session) {
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "UNAUTHENTICATED", text: "Please unlock the app first" } }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/unlock", req.url));
  }

  const res = NextResponse.next();
  if (cfg && shouldRefresh(session, now)) {
    const token = issueSession(cfg, session.userId, now);
    if (token) res.cookies.set(name, token, sessionCookieOptions(production));
  }
  return res;
}
