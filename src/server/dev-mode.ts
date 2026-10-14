/**
 * The developer-only "acting as" switch (local only; never in production).
 *
 * One rule, owned by the backend env (`src/lib/env.ts`): the switch is on only when
 * `NODE_ENV !== "production"` and `DEV_ACTING_AS=<userId>` is set (for example `demo-vero` for the
 * local demo kitchen). Production refuses to start if it's set (env validation in
 * src/instrumentation.ts), and the proxy fails closed. The UI's switch picks another user through
 * the `dev_acting_as` cookie.
 */
import { devActingAsEnabled as envDevActingAsEnabled, env } from "@/lib/env";

export { DEV_ACTING_AS_COOKIE } from "@/lib/auth/current-user";

export interface DevModeEnv {
  NODE_ENV?: string;
  DEV_ACTING_AS?: string;
}

/** Pure rule, for tests. */
export function devActingAsEnabled(e: DevModeEnv): boolean {
  return e.NODE_ENV !== "production" && Boolean(e.DEV_ACTING_AS?.trim());
}

export function isDevActingAsOn(): boolean {
  return process.env.NODE_ENV !== "production" && envDevActingAsEnabled(env());
}

/** Throws (so the server refuses to start) if someone tries to enable it in production. */
export function assertDevModeSafe(e: DevModeEnv): void {
  if (e.NODE_ENV === "production" && e.DEV_ACTING_AS?.trim()) {
    throw new Error(
      "Refusing to start: DEV_ACTING_AS is a local development switch and can't be used in production. Unset it.",
    );
  }
}
