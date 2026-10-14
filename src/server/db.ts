/**
 * The app server's database handle. Locally this is one embedded PGlite (backend-data.md §10),
 * opened once per server process and kept on `globalThis` so dev hot-reloads don't open it twice
 * (PGlite allows one process per data folder: stop `npm run dev` before `npm run db:seed`).
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { openLocalDb, type Db, type LocalDb } from "@/db/client";
import { env } from "@/lib/env";

const g = globalThis as typeof globalThis & { __kitchenDb?: Promise<LocalDb> };

export function getDb(): Promise<Db> {
  if (env().DATABASE_URL) {
    // Neon arrives with S2; until then only the local database exists.
    return Promise.reject(new Error("DATABASE_URL is set, but only local PGlite is wired up yet"));
  }
  g.__kitchenDb ??= openLocalDb({
    dataDir: ensureDir(path.resolve(env().PGLITE_DIR)),
    migrationsFolder: path.resolve("src/db/migrations"),
  }).catch((error: unknown) => {
    g.__kitchenDb = undefined; // let the next request try again
    throw error;
  });
  return g.__kitchenDb.then((l) => l.db);
}

function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
