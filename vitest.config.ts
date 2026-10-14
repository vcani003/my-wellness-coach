import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // PGlite starts a WebAssembly Postgres per test file; give it time on a cold start.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
