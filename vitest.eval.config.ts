import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** `npm run eval`: the real-model eval set (skipped unless ANTHROPIC_API_KEY is set). */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/ai/eval/**/*.eval.ts"],
    testTimeout: 120_000,
    // One at a time: gentle on rate limits, and the cache warms after the first call.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
