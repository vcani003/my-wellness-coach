/**
 * End-to-end tests (frontend.md §8): the primary journey steps 1–4 on the FAKE interpreter, with
 * automated accessibility checks, at phone size and desktop size.
 * It starts its own dev server on port 3210 with its own database folder and build folder, so
 * it never touches your local kitchen or a running `npm run dev`. A second one on port 3211 runs
 * the real sign-in gate for tests/e2e/sign-in-links.spec.ts (tests/support/auth-server.ts).
 */
import { defineConfig, devices } from "@playwright/test";
import { AUTH_PORT, AUTH_TEST_ACCESS_CODE, AUTH_TEST_SESSION_SECRET } from "./tests/support/auth-server";

const PORT = 3210;

export default defineConfig({
  testDir: "tests/e2e",
  // One shared demo kitchen, reset before each test: run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phone",
      // iPhone 15 size and touch, in Chromium (the whole suite; WebKit runs only the keyboard spec below).
      testIgnore: /phone-keyboard\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    { name: "desktop", testIgnore: /phone-keyboard\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    {
      // Phone chat with a simulated iPhone keyboard (0059 PF7), in WebKit (Safari's engine) only.
      // Needs `npx playwright install webkit`. Run it with --project=iphone-webkit.
      name: "iphone-webkit",
      testMatch: /phone-keyboard\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: [
    {
      command: `npx next dev --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { DEV_ACTING_AS: "demo-vero", PGLITE_DIR: ".data/pglite-e2e", NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" },
    },
    // Sign-in links and passphrases (tests/support/auth-server.ts): the real gate, a fresh database.
    {
      command: `rm -rf .data/pglite-e2e-auth && npx tsx scripts/db-bootstrap.ts && npx next dev --port ${AUTH_PORT}`,
      url: `http://localhost:${AUTH_PORT}/unlock`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // Empty values win over .env.local (Next and tsx never override a set variable).
        DEV_ACTING_AS: "",
        DATABASE_URL: "",
        AI_MODE: "fake",
        PGLITE_DIR: ".data/pglite-e2e-auth",
        NEXT_DIST_DIR: ".next-e2e-auth",
        SESSION_SECRET: AUTH_TEST_SESSION_SECRET,
        ACCESS_CODES: `vero=${AUTH_TEST_ACCESS_CODE}`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
