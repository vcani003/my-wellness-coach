/**
 * Opens the LOCAL embedded database for scripts. Loads `.env.local` if present, and refuses to
 * run against production or a remote database: these scripts are local only.
 */
import fs from "node:fs";
import path from "node:path";
import { openLocalDb, type LocalDb } from "../src/db/client";
import { env } from "../src/lib/env";

export async function openScriptDb(opts: { migrateOnOpen?: boolean } = {}): Promise<LocalDb & { dataDir: string }> {
  if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
  const e = env();
  if (e.NODE_ENV === "production" || e.DATABASE_URL) {
    throw new Error("These scripts are local only: unset DATABASE_URL and NODE_ENV=production.");
  }
  const dataDir = path.resolve(e.PGLITE_DIR);
  fs.mkdirSync(dataDir, { recursive: true });
  return { ...(await openLocalDb({ dataDir, migrateOnOpen: opts.migrateOnOpen })), dataDir };
}
