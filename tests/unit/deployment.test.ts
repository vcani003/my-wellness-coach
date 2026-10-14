/**
 * The staging guards (0021; backend-data.md §10 "Staging"): where tester accounts may be used,
 * and when a build may create them. Production must never qualify.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { deploymentOf, stagingBootstrapAllowed, testersAllowed } from "@/lib/deployment";
import { runStagingBootstrap } from "../../scripts/staging-bootstrap";

const NEON = "postgresql://u:p@ep-example.neon.tech/neondb?sslmode=require";

describe("testersAllowed (tester sign-in, /api/test/reset)", () => {
  it.each([
    // [label, env, allowed]
    ["Vercel production", { VERCEL_ENV: "production", NODE_ENV: "production" }, false],
    ["Vercel production, even with the dev switch", { VERCEL_ENV: "production", NODE_ENV: "development", DEV_ACTING_AS: "tester-1" }, false],
    ["self-hosted production", { NODE_ENV: "production" }, false],
    ["self-hosted production with the dev switch", { NODE_ENV: "production", DEV_ACTING_AS: "tester-1" }, false],
    ["Vercel preview (staging)", { VERCEL_ENV: "preview", NODE_ENV: "production" }, true],
    ["local dev without the dev switch", { NODE_ENV: "development" }, false],
    ["local dev with the dev switch", { NODE_ENV: "development", DEV_ACTING_AS: "tester-1" }, true],
    ["vercel dev without the dev switch", { VERCEL_ENV: "development", NODE_ENV: "development" }, false],
    ["blank everything", {}, false],
  ])("%s → %s", (_label, e, allowed) => {
    expect(testersAllowed(e)).toBe(allowed);
  });

  it("names the deployment", () => {
    expect(deploymentOf({ VERCEL_ENV: "production" })).toBe("production");
    expect(deploymentOf({ VERCEL_ENV: " preview " })).toBe("staging");
    expect(deploymentOf({ NODE_ENV: "production" })).toBe("production");
    expect(deploymentOf({ NODE_ENV: "development" })).toBe("local");
  });
});

describe("stagingBootstrapAllowed (preview builds only)", () => {
  it.each([
    ["production build", { VERCEL_ENV: "production", DATABASE_URL: NEON }, false],
    ["preview build with its database", { VERCEL_ENV: "preview", DATABASE_URL: NEON }, true],
    ["preview build without a database", { VERCEL_ENV: "preview", DATABASE_URL: " " }, false],
    ["local vercel-build with a database", { DATABASE_URL: NEON }, false],
    ["local dev with the dev switch and a database", { NODE_ENV: "development", DEV_ACTING_AS: "tester-1", DATABASE_URL: NEON }, false],
    ["vercel dev", { VERCEL_ENV: "development", DATABASE_URL: NEON }, false],
  ])("%s → %s", (_label, e, allowed) => {
    expect(stagingBootstrapAllowed(e)).toBe(allowed);
  });

  it("does nothing (and opens no database) outside a preview build", async () => {
    // An unreachable URL: if the guard let this through, opening or querying it would fail the test.
    const bad = "postgresql://nobody:x@127.0.0.1:1/none";
    expect(await runStagingBootstrap({ VERCEL_ENV: "production", NODE_ENV: "production", DATABASE_URL: bad })).toBe("skipped");
    expect(await runStagingBootstrap({ NODE_ENV: "development", DATABASE_URL: bad })).toBe("skipped");
    expect(await runStagingBootstrap({ VERCEL_ENV: "preview" })).toBe("skipped");
  });

  it("runs on every Vercel build, after the migrations and before next build", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["vercel-build"]).toBe("tsx scripts/db-migrate.ts --neon-only && tsx scripts/staging-bootstrap.ts && next build");
  });
});
