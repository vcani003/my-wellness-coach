/**
 * `npm run db:migrate`: apply the SQL migrations in src/db/migrations. Targets Neon when
 * `DATABASE_URL` is set (in the shell or `.env.local`), else the local PGlite folder.
 *
 * `--neon-only` (used by `vercel-build`, decision 0028): migrate only when DATABASE_URL is set;
 * otherwise do nothing, so preview builds without a database don't create a throwaway PGlite.
 * Only additive migrations may ship this way; anything else needs Vero's go-ahead (0028).
 */
import { runMigrations } from "../src/db/client";
import { openAnyDb } from "./local-db";

if (process.argv.includes("--neon-only") && !process.env.DATABASE_URL?.trim()) {
  console.log("Skipping migrations: DATABASE_URL isn't set for this build");
} else {
  const { db, close, driver, where } = await openAnyDb({ migrateOnOpen: false });
  try {
    await runMigrations(db, driver);
    console.log(`Migrations applied to ${where}`);
  } finally {
    await close();
  }
}
