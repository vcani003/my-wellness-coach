/** `npm run db:migrate`: apply the SQL migrations in src/db/migrations to the local database. */
import { openScriptDb } from "./local-db";

const { close, dataDir } = await openScriptDb();
await close();
console.log(`Migrations applied to ${dataDir}`);
