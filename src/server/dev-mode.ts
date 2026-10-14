/**
 * The developer-only "acting as" switch (milestone 2; no sign-in yet).
 *
 * It lets one browser act as Vero or Levi from the local `demo` kitchen, so the two-person cues
 * can be tried. It can't be turned on in a production build, twice over:
 * 1. `isDevActingAsOn()` starts with `process.env.NODE_ENV !== "production"`, which Next.js
 *    replaces with `false` in a production build, so the switch's code path is compiled out;
 * 2. `assertDevModeSafe()` runs when the server starts (src/instrumentation.ts) and refuses to
 *    start a production server that has `DEV_ACTING_AS=on` set.
 * Locally it's on by default; set `DEV_ACTING_AS=off` to see the signed-out page.
 */

export interface DevModeEnv {
  NODE_ENV?: string;
  DEV_ACTING_AS?: string;
}

/** Pure rule, for tests. */
export function devActingAsEnabled(e: DevModeEnv): boolean {
  return e.NODE_ENV !== "production" && (e.DEV_ACTING_AS ?? "on") !== "off";
}

export function isDevActingAsOn(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    devActingAsEnabled({ NODE_ENV: process.env.NODE_ENV, DEV_ACTING_AS: process.env.DEV_ACTING_AS })
  );
}

/** Throws (so the server refuses to start) if someone tries to enable it in production. */
export function assertDevModeSafe(e: DevModeEnv): void {
  if (e.NODE_ENV === "production" && e.DEV_ACTING_AS !== undefined && e.DEV_ACTING_AS !== "off") {
    throw new Error(
      "Refusing to start: DEV_ACTING_AS is a local development switch and can't be used in production. Unset it.",
    );
  }
}

export const DEV_ACTING_AS_COOKIE = "kitchen-dev-acting-as";
