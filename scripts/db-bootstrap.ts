/**
 * `npm run db:bootstrap`: create the real users (Vero, Levi) and the shared "Home" kitchen.
 * Safe to run twice. Uses Neon when `DATABASE_URL` is set, else the local PGlite folder.
 */
import { openAnyDb } from "./local-db";
import { bootstrap } from "./bootstrap";

const { db, close, where } = await openAnyDb();
try {
  const r = await bootstrap(db);
  const created = [
    r.createdUsers.length ? `users ${r.createdUsers.join(", ")}` : "",
    r.createdKitchen ? `kitchen "home"` : "",
    r.createdMemberships.length ? `memberships for ${r.createdMemberships.join(", ")}` : "",
  ].filter(Boolean);
  if (r.skippedDeleted.length) {
    console.log(`Skipped ${r.skippedDeleted.join(", ")}: deleted their data (D1). Remove their code from ACCESS_CODES.`);
  }
  console.log(`Bootstrap on ${where}: ${created.length ? `created ${created.join("; ")}` : "already set up, nothing to do"}`);
} finally {
  await close();
}
