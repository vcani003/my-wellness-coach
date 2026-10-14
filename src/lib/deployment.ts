/**
 * Which deployment is this, and may tester accounts (0021) be used here? (backend-data.md §7,
 * §10 "Staging"). One rule, read in four places: tester sign-in (`attemptUnlock`,
 * `resolveCurrentUser`), the staging bootstrap on preview builds, and `POST /api/test/reset`.
 *
 * - **Production** (`VERCEL_ENV=production`): never. Also never for a self-hosted production
 *   build (`NODE_ENV=production` without `VERCEL_ENV=preview`).
 * - **Staging** (`VERCEL_ENV=preview`, set by Vercel on preview deployments): yes.
 * - **Local development:** only with the dev "acting as" switch on (`DEV_ACTING_AS`, which the
 *   server refuses in production).
 *
 * Pure, over raw strings, so it can run at module load on `process.env` as well as on a parsed
 * `Env`, and is trivially testable.
 */
export interface DeploymentEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  DEV_ACTING_AS?: string;
}

export type Deployment = "production" | "staging" | "local";

export function deploymentOf(e: DeploymentEnv): Deployment {
  const vercel = e.VERCEL_ENV?.trim();
  if (vercel === "production") return "production";
  if (vercel === "preview") return "staging";
  return e.NODE_ENV === "production" ? "production" : "local";
}

/** May tester (`isTest`) accounts sign in and use test-only routes here? */
export function testersAllowed(e: DeploymentEnv): boolean {
  switch (deploymentOf(e)) {
    case "production":
      return false;
    case "staging":
      return true;
    case "local":
      return Boolean(e.DEV_ACTING_AS?.trim());
  }
}

/**
 * Should this build create the tester accounts and test kitchens? Only a Vercel **preview** build
 * with its own database. Never production, never a local `npm run vercel-build`.
 */
export function stagingBootstrapAllowed(e: DeploymentEnv & { DATABASE_URL?: string }): boolean {
  return deploymentOf(e) === "staging" && e.VERCEL_ENV?.trim() === "preview" && Boolean(e.DATABASE_URL?.trim());
}
