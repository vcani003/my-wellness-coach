/**
 * End-to-end tests (frontend.md §8): the primary journey steps 1–4 on the FAKE interpreter, with
 * automated accessibility checks, at phone size and desktop size.
 * It starts its own dev server on port 3210 with its own database folder and build folder, so
 * it never touches your local kitchen or a running `npm run dev`.
 */
import { defineConfig, devices } from "@playwright/test";

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
      // iPhone 15 size and touch, in Chromium (WebKit isn't installed locally; see frontend.md §8).
      use: { ...devices["Desktop Chrome"], viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PGLITE_DIR: ".data/pglite-e2e", NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
