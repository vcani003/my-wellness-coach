import { defineConfig } from "drizzle-kit";

// `db:generate` only diffs the schema into SQL files; it needs no database connection.
// The same SQL files run on PGlite (local, tests) and later on Neon (backend-data.md §2).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  strict: true,
});
