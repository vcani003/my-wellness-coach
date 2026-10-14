import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Defaults from create-next-app 16.4 (empty template). */
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships WebAssembly + data files: load it from node_modules at runtime instead of bundling.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
