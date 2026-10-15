import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Defaults from create-next-app 16.4 (empty template). */
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships WebAssembly + data files: load it from node_modules at runtime instead of bundling.
  serverExternalPackages: ["@electric-sql/pglite"],
  // `next dev` otherwise appends its own block to AGENTS.md, which is the team's instructions file.
  agentRules: false,
  // The dev-only "N" badge sits bottom-left, on top of the dock's Today tab. Off; production never has it.
  devIndicators: false,
  // The end-to-end tests run a second dev server with its own build folder (playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
