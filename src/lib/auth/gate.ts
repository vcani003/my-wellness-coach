/**
 * The sign-in gate (backend-data.md §7), run by `src/proxy.ts` on every request. Everything
 * needs a valid session except `/unlock`, an invite or reset link page (`/join/<token>`,
 * `/reset/<token>`, SU1 Rec) and static assets. Pages without one are
 * sent to `/unlock`; API routes get a 401. A valid session is rolled forward (0017: 1 year,
 * renewed on use). This is the outer lock; `getCurrentUser()` checks again in each handler.
 */
import { NextResponse, type NextRequest } from "next/server";
import { devActingAsEnabled, type Env } from "@/lib/env";
import { issueSession, sessionCookieName, sessionCookieOptions, shouldRefresh, verifySession } from "./session";

const PUBLIC_EXACT = new Set(["/unlock", "/favicon.ico", "/robots.txt", "/manifest.webmanifest"]);
const STATIC_FILE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|webmanifest)$/i;

/** `/join/<token>` and `/reset/<token>`: exactly one segment, token-shaped. Nothing deeper. */
const LINK_PAGE = /^\/(?:join|reset)\/[A-Za-z0-9_-]{1,100}$/;

/** An invite or reset link page (SU1 Rec). */
export function isLinkPage(pathname: string): boolean {
  return LINK_PAGE.test(pathname);
}

/**
 * Paths anyone may load: the unlock page, invite/reset link pages and static assets (never an
 * API route). Their server actions post to the same path; each action checks for itself what
 * it allows (a valid link, or a session), as every server action must, since Next.js runs an
 * action by its ID whichever page it's posted to.
 */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname) || isLinkPage(pathname)) return true;
  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image")) return true;
  if (pathname.startsWith("/api/") || pathname === "/api") return false;
  return STATIC_FILE.test(pathname);
}

export function gate(req: NextRequest, e: Env, now: Date = new Date()): NextResponse {
  const { pathname } = req.nextUrl;
  if (isLinkPage(pathname)) {
    // The secret token is in the URL: never send it on as a Referer, never cache or index it.
    const res = NextResponse.next();
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Robots-Tag", "noindex");
    return res;
  }
  if (isPublicPath(pathname) || devActingAsEnabled(e)) return NextResponse.next();

  const production = e.NODE_ENV === "production";
  const cfg = e.SESSION_SECRET ? { secret: e.SESSION_SECRET, accessCodes: e.ACCESS_CODES, production } : null;
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
    // The proxy has no database: carry the epoch forward; handlers check it (getCurrentUser).
    const token = issueSession(cfg, session.userId, now, session.epoch, session.method);
    if (token) res.cookies.set(name, token, sessionCookieOptions(production));
  }
  return res;
}
