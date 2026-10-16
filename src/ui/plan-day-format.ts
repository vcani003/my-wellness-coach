/**
 * Plan days ("2026-10-20", calendar dates, 0045 KOS1) shown in the reader's language (0015).
 * A plan day is a date, not a moment, so it's formatted in UTC: it never shifts by a time zone.
 * Pure, built-in `Intl` only (no date library). Never throws: a bad value comes back as it was.
 */
import { isIsoDay } from "@/shared/plan-dates";

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
    }
    cache.set(key, f);
  }
  return f;
}

const at = (date: string) => new Date(`${date}T00:00:00Z`);

export type PlanDayStyle = "short" | "long" | "weekday" | "weekdayShort" | "dayNumber" | "monthDay";

const STYLES: Record<PlanDayStyle, Intl.DateTimeFormatOptions> = {
  /** "Tue, Oct 20" */
  short: { weekday: "short", month: "short", day: "numeric" },
  /** "Tuesday, October 20" */
  long: { weekday: "long", month: "long", day: "numeric" },
  /** "Tuesday" */
  weekday: { weekday: "long" },
  /** "Tue" */
  weekdayShort: { weekday: "short" },
  /** "20" */
  dayNumber: { day: "numeric" },
  /** "Oct 20" */
  monthDay: { month: "short", day: "numeric" },
};

export function formatPlanDay(date: string, locale: string, style: PlanDayStyle = "short"): string {
  if (!isIsoDay(date)) return date;
  return formatter(locale, STYLES[style]).format(at(date));
}
