"use client";
/**
 * The device's time zone (IANA, e.g. "America/New_York"): the person's "today" for the dated plan
 * (0045 KOS1). Sent with every chat message and every plan or week-needs button, so the server's
 * "today", "Tuesday" and the plan window match what this phone shows. Never throws (0018): an old
 * browser without it sends nothing and the server uses UTC.
 */
import { useSyncExternalStore } from "react";
import { todayIn } from "@/shared/plan-dates";

export function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 && zone.length <= 64 ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** `{timeZone}` to spread into a request, or nothing. */
export function withTimeZone(): { timeZone?: string } {
  const timeZone = deviceTimeZone();
  return timeZone ? { timeZone } : {};
}

const noSubscribe = () => () => {};

/**
 * The device time zone for rendering. The server render (and hydration) use UTC, then the phone's
 * own zone takes over straight after, so a server in another zone never causes a mismatch.
 */
export function useDeviceTimeZone(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => deviceTimeZone() ?? "UTC",
    () => "UTC",
  );
}

/** Today's calendar date on this device ("2026-10-16"), from the app's minute clock (`now`). */
export function usePlanToday(now: Date): string {
  const zone = useDeviceTimeZone();
  return todayIn(zone, now);
}
