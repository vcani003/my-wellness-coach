/**
 * Migration tests: a temporary migrations folder holding the real migrations up to and including
 * one tag, so a test can build a database "as it was" and then apply the next step on top.
 * Matched by tag, never by position, so a later migration doesn't break an older test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { MIGRATIONS_FOLDER, type Db } from "@/db/client";

type Entry = { idx: number; tag: string };

export function journalTags(): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
  return (journal.entries as Entry[]).map((e) => e.tag);
}

/** A folder with the migrations up to `tag` (inclusive). Call `cleanup` when done. */
export function migrationsUpTo(tag: string): { dir: string; cleanup: () => void } {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"));
  const entries = journal.entries as Entry[];
  const last = entries.findIndex((e) => e.tag === tag);
  if (last < 0) throw new Error(`no migration tagged ${tag}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  journal.entries = entries.slice(0, last + 1);
  fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries as Entry[]) fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export async function publicTables(db: Db): Promise<string[]> {
  const res = (await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  )) as unknown as { rows: { table_name: string }[] };
  return res.rows.map((r) => r.table_name);
}
