/**
 * `npm run db:migrate`: apply the SQL migrations in src/db/migrations. Targets Neon when
 * `DATABASE_URL` is set (in the shell or `.env.local`), else the local PGlite folder.
 */
import { runMigrations } from "../src/db/client";
import { openAnyDb } from "./local-db";

const { db, close, driver, where } = await openAnyDb({ migrateOnOpen: false });
try {
  await runMigrations(db, driver);
  console.log(`Migrations applied to ${where}`);
} finally {
  await close();
}
