/**
 * Database client (backend-data.md §2). The driver is chosen by environment:
 * - `DATABASE_URL` set → **Neon** through its serverless WebSocket `Pool` driver
 *   (`drizzle-orm/neon-serverless`). Not the HTTP driver: the write path needs interactive
 *   transactions and a row lock (`SELECT … FOR UPDATE`), which only a real session supports.
 *   Each `db.transaction` checks out one pooled connection for its whole life.
 * - otherwise → **PGlite**, an embedded Postgres compiled to WebAssembly (local dev and tests).
 *
 * Domain code only sees the generic `Db` / `Tx` types below, so the driver lives in this file only.
 * Node 22+ has a built-in WebSocket, so the Neon driver needs no `ws` package on Node 24.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the database or an open transaction. */
export type Queryable = Db | Tx;

export const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export interface LocalDb {
  db: Db;
  close: () => Promise<void>;
}

export type Driver = "neon" | "pglite";

/** `DATABASE_URL` set → Neon; otherwise the embedded PGlite. */
export function selectDriver(e: { DATABASE_URL?: string }): Driver {
  return e.DATABASE_URL ? "neon" : "pglite";
}

/**
 * Open a PGlite database. `dataDir` undefined = in memory (tests).
 * Runs migrations unless `migrateOnOpen` is false.
 */
export async function openLocalDb(
  opts: { dataDir?: string; migrateOnOpen?: boolean; migrationsFolder?: string } = {},
): Promise<LocalDb> {
  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const db = drizzlePglite({ client, schema });
  if (opts.migrateOnOpen !== false) {
    // Bundlers (Next.js) move this file, so the app server passes the folder explicitly.
    await migratePglite(db, { migrationsFolder: opts.migrationsFolder ?? MIGRATIONS_FOLDER });
  }
  return { db, close: () => client.close() };
}

/**
 * Open Neon through the WebSocket Pool. Creating the pool doesn't connect; the first query does.
 * The app never migrates on open: migrations run once per deploy with `npm run db:migrate`.
 */
export function openNeonDb(connectionString: string): LocalDb & { pool: Pool } {
  // Small pool: Vercel functions are short-lived and Neon's free tier has few connections.
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
  // An idle client dropping (e.g. Neon scaling to zero) must not crash the process (0018).
  pool.on("error", (err: Error) => console.error("[db] idle Neon connection error:", err.message));
  const db = drizzleNeon({ client: pool, schema }) as unknown as Db;
  return { db, pool, close: () => pool.end() };
}

/** Open whichever database the environment names. Scripts use this; the app uses `getDb()`. */
export async function openDb(
  e: { DATABASE_URL?: string; PGLITE_DIR: string },
  opts: { migrateOnOpen?: boolean; migrationsFolder?: string } = {},
): Promise<LocalDb & { driver: Driver }> {
  const driver = selectDriver(e);
  if (driver === "neon") return { ...openNeonDb(e.DATABASE_URL!), driver };
  const dataDir = path.resolve(e.PGLITE_DIR);
  fs.mkdirSync(dataDir, { recursive: true });
  return { ...(await openLocalDb({ dataDir, migrateOnOpen: opts.migrateOnOpen, migrationsFolder: opts.migrationsFolder })), driver };
}

/** Apply the SQL migrations in `src/db/migrations` to an open database. */
export async function runMigrations(db: Db, driver: Driver): Promise<void> {
  if (driver === "neon") {
    await migrateNeon(db as unknown as Parameters<typeof migrateNeon>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    await migratePglite(db as unknown as Parameters<typeof migratePglite>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

// One database per server process. Kept on globalThis so dev hot-reloads don't open a second
// PGlite on the same folder (PGlite allows one process per folder).
const g = globalThis as { __kitchenDb?: Promise<LocalDb & { driver: Driver }> };

/**
 * The app's database (route handlers, server actions, server components). Locally the PGlite
 * folder is migrated on first open; Neon is migrated by `npm run db:migrate` on deploy.
 */
export async function getDb(): Promise<Db> {
  // Next.js bundles this file elsewhere, so point PGlite at the source migrations explicitly.
  g.__kitchenDb ??= openDb(env(), { migrationsFolder: path.resolve("src/db/migrations") }).catch((err) => {
    g.__kitchenDb = undefined; // let the next request retry instead of caching the failure
    throw err;
  });
  return (await g.__kitchenDb).db;
}
