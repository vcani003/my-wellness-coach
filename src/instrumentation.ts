/** Runs once when the Next.js server starts. */
import { assertDevModeSafe } from "@/server/dev-mode";

export function register() {
  // The dev "acting as" switch must never run in production (milestone 2).
  assertDevModeSafe({ NODE_ENV: process.env.NODE_ENV, DEV_ACTING_AS: process.env.DEV_ACTING_AS });
}
