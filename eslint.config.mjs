import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Module boundaries (backend-data.md §5, §9):
 * - UI, AI and app code reach a domain only through its `commands`, `queries` or `public`.
 * - Domains reach each other only through `public.ts`.
 * - `shared/`, `db/` and `contracts/` never import a domain; `contracts/` stays pure.
 * Tests and scripts are exempt.
 */
const restrict = (patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**", "src/ui/**", "src/ai/**", "src/lib/**"],
    rules: restrict([
      {
        group: [
          "@/domains/*/*",
          "!@/domains/*/commands",
          "!@/domains/*/queries",
          "!@/domains/*/public",
          "**/domains/*/*",
          "!**/domains/*/commands",
          "!**/domains/*/queries",
          "!**/domains/*/public",
        ],
        message: "Reach a domain only through its commands, queries or public.ts.",
      },
    ]),
  },
  {
    files: ["src/domains/**"],
    rules: restrict([
      {
        group: ["@/domains/*/*", "!@/domains/*/public"],
        message: "Domains reach each other only through public.ts; use a relative import inside your own domain.",
      },
    ]),
  },
  {
    files: ["src/shared/**", "src/db/**"],
    rules: restrict([{ group: ["@/domains/**", "**/domains/**"], message: "The shared layer never imports a domain." }]),
  },
  {
    files: ["src/contracts/**"],
    rules: restrict([
      {
        group: ["@/*", "!@/contracts", "!@/contracts/*", "node:*", "drizzle-orm", "drizzle-orm/*"],
        message: "Contracts are pure Zod: imported by the UI too, so no server code.",
      },
    ]),
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".data/**", "coverage/**"]),
]);

export default eslintConfig;
