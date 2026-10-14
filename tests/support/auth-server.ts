/**
 * The second e2e dev server, for sign-in links and passphrases (SU1 Rec; playwright.config.ts):
 * the real sign-in gate (no DEV_ACTING_AS) and the real Vero and Levi from `db:bootstrap`, in a
 * fresh database folder each run. These are throwaway values for that local test server only.
 */
export const AUTH_PORT = 3211;
export const AUTH_BASE_URL = `http://localhost:${AUTH_PORT}`;
export const AUTH_TEST_SESSION_SECRET = "e2e-only-session-secret-for-the-local-test-server";
export const AUTH_TEST_ACCESS_CODE = "e2e-only-vero-access-code";
