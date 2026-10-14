/**
 * Runs once when a server instance starts (Next.js instrumentation). Validates the environment
 * so a misconfigured deploy fails at start with a clear, value-free message: e.g. a missing
 * `SESSION_SECRET` in production, or the dev-only `DEV_ACTING_AS` switch left on in production.
 * `src/proxy.ts` also fails closed (500) on every request if this is ignored.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/lib/env");
  env(); // throws "Invalid environment variables: NAME (reason); …" (names only, never values)
}
