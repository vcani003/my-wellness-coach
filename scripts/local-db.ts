/**
 * Database access for scripts. Loads `.env.local` if present.
 * - `openScriptDb`: the LOCAL embedded database only (seeding test kitchens). Refuses to run
 *   against production or a remote database.
 * - `openAnyDb`: whichever database the environment names (migrate, bootstrap).
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, openLocalDb, type Driver, type LocalDb } from "../src/db/client";
import { env } from "../src/lib/env";

function loadEnvFile() {
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
}

export async function openScriptDb(opts: { migrateOnOpen?: boolean } = {}): Promise<LocalDb & { dataDir: string }> {
  loadEnvFile();
  const e = env();
  if (e.NODE_ENV === "production" || e.DATABASE_URL) {
    throw new Error("These scripts are local only: unset DATABASE_URL and NODE_ENV=production.");
  }
  const dataDir = path.resolve(e.PGLITE_DIR);
  fs.mkdirSync(dataDir, { recursive: true });
  return { ...(await openLocalDb({ dataDir, migrateOnOpen: opts.migrateOnOpen })), dataDir };
}

/** Neon if `DATABASE_URL` is set, else local PGlite. `where` is printable (never the URL). */
export async function openAnyDb(opts: { migrateOnOpen?: boolean } = {}): Promise<LocalDb & { driver: Driver; where: string }> {
  loadEnvFile();
  // NODE_ENV is unset in a shell, so only the database variables matter here.
  const e = env();
  const opened = await openDb(e, opts);
  const where = opened.driver === "neon" ? "Neon (DATABASE_URL)" : path.resolve(e.PGLITE_DIR);
  return { ...opened, where };
}
