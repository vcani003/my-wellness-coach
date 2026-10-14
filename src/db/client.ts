/**
 * Database client. Locally (and in tests) this is PGlite, an embedded Postgres compiled to
 * WebAssembly, through Drizzle's PGlite driver. Neon arrives with S2; domain code only sees the
 * generic `Db` / `Tx` types below, so swapping the driver touches this file only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
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

/**
 * Open a PGlite database. `dataDir` undefined = in memory (tests).
 * Runs migrations unless `migrateOnOpen` is false.
 * `migrationsFolder` defaults to the folder next to this file.
 */
export async function openLocalDb(
  opts: { dataDir?: string; migrateOnOpen?: boolean; migrationsFolder?: string } = {},
): Promise<LocalDb> {
  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const db = drizzle({ client, schema });
  if (opts.migrateOnOpen !== false) {
    // Bundlers (Next.js) move this file, so the app server passes the folder explicitly.
    await migrate(db, { migrationsFolder: opts.migrationsFolder ?? MIGRATIONS_FOLDER });
  }
  return { db, close: () => client.close() };
}
