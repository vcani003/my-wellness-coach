/**
 * Staging bootstrap, run by `npm run vercel-build` right after the migrations (backend-data.md
 * §10 "Staging", 0021). On a Vercel **preview** build with its own `DATABASE_URL`, it makes sure
 * the tester accounts `tester-1` and `tester-2` and the `single` and `household` test kitchens
 * exist. It never wipes them (that's `POST /api/test/reset`).
 *
 * Hard guard: anything other than `VERCEL_ENV=preview` with `DATABASE_URL` set does nothing and
 * says so: production builds, local `npm run vercel-build`, builds without a database. It reads
 * only the real process environment (no `.env.local`), so a local file can't switch it on.
 */
import { stagingBootstrapAllowed } from "../src/lib/deployment";

export async function runStagingBootstrap(source: Record<string, string | undefined> = process.env): Promise<"skipped" | "done"> {
  if (!stagingBootstrapAllowed(source)) {
    console.log(`Skipping the staging bootstrap: this isn't a preview build with its own database (VERCEL_ENV=${source.VERCEL_ENV ?? "unset"})`);
    return "skipped";
  }
  // Imported only past the guard, so a skipped run never touches a database or the env schema.
  const { openDb } = await import("../src/db/client");
  const { ensureStagingKitchens } = await import("./scenarios");
  // Only the database URL is needed (never printed); the migration step before this checked the rest.
  const { db, close, driver } = await openDb({ DATABASE_URL: source.DATABASE_URL!.trim(), PGLITE_DIR: "" }, { migrateOnOpen: false });
  try {
    if (driver !== "neon") throw new Error("Refusing: the staging bootstrap only runs against the preview Neon database");
    const r = await ensureStagingKitchens(db);
    const created = [
      r.createdUsers.length ? `users ${r.createdUsers.join(", ")}` : "",
      r.seededKitchens.length ? `test kitchens ${r.seededKitchens.join(", ")}` : "",
    ].filter(Boolean);
    console.log(`Staging bootstrap: ${created.length ? `created ${created.join("; ")}` : "already set up, nothing to do"}`);
    return "done";
  } finally {
    await close();
  }
}

// Run when called as a script (`tsx scripts/staging-bootstrap.ts`), not when a test imports it.
if (process.argv[1]?.endsWith("staging-bootstrap.ts")) {
  await runStagingBootstrap();
}
