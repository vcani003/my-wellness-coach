/**
 * Calendar dates for the dated week plan (0045 KOS1). Pure, no server-only imports: the AI, the
 * backend and the UI all use these.
 *
 * A planned day is a **calendar date** ("2026-10-20"), never a timestamp, so it can't drift by a
 * day across time zones or daylight-saving changes. All arithmetic is on whole days in UTC, where
 * there is no DST. Only "what day is it today?" depends on a time zone: it's the person's own
 * device time zone (sent with each request), UTC when none was sent or it isn't a real zone.
 *
 * The plan window is yesterday to 21 days ahead (KOS1, from recipe-cat): later or earlier dates
 * are refused with a friendly message.
 */

/** "YYYY-MM-DD". */
export type IsoDay = string;

export const PLAN_DAYS_BEFORE = 1;
export const PLAN_DAYS_AHEAD = 21;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** A real calendar date in "YYYY-MM-DD" form ("2026-02-30" is not). */
export function isIsoDay(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function toUtcMs(day: IsoDay): number {
  const m = ISO_DAY.exec(day);
  if (!m) throw new Error(`not a calendar date: ${day}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): IsoDay {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The time zone to use: the given IANA zone if it's real, else "UTC". */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Today's calendar date in that time zone (UTC when none or unknown). */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): IsoDay {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(day: IsoDay, n: number): IsoDay {
  return fromUtcMs(toUtcMs(day) + n * DAY_MS);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: IsoDay, b: IsoDay): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: IsoDay): number {
  return new Date(toUtcMs(day)).getUTCDay();
}

export function planWindow(today: IsoDay): { from: IsoDay; to: IsoDay } {
  return { from: addDays(today, -PLAN_DAYS_BEFORE), to: addDays(today, PLAN_DAYS_AHEAD) };
}

export function inPlanWindow(day: IsoDay, today: IsoDay): boolean {
  if (!isIsoDay(day)) return false;
  const d = daysBetween(today, day);
  return d >= -PLAN_DAYS_BEFORE && d <= PLAN_DAYS_AHEAD;
}

/** English fallback label, "Tue, Oct 20" (the UI formats `date` by locale, 0015). */
export function englishDayLabel(day: IsoDay): string {
  return new Date(toUtcMs(day)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// ─── Relative days, resolved in code (never by the model) ─────────────────────────────

const WEEKDAYS: Array<[RegExp, number]> = [
  [/^sun(day)?$/, 0],
  [/^mon(day)?$/, 1],
  [/^tue(s|sday)?$/, 2],
  [/^wed(s|nesday)?$/, 3],
  [/^thu(r|rs|rsday)?$/, 4],
  [/^fri(day)?$/, 5],
  [/^sat(urday)?$/, 6],
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const SMALL_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, "twenty-one": 21,
};

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  const i = MONTHS.indexOf(w.slice(0, 3));
  // "sept" and full names; reject words that only start like a month ("marmalade").
  if (i < 0) return -1;
  const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"][i];
  return full.startsWith(w) || w === "sept" ? i : -1;
}

function weekdayIndex(word: string): number {
  return WEEKDAYS.find(([re]) => re.test(word))?.[1] ?? -1;
}

/** A day of month in this month, else the next month that has it, not before yesterday. */
function nextDayOfMonth(dom: number, today: IsoDay): IsoDay | null {
  if (dom < 1 || dom > 31) return null;
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let k = 0; k < 3; k++) {
    const date = new Date(Date.UTC(y, m - 1 + k, dom));
    if (date.getUTCDate() !== dom) continue; // no 31st in this month
    const day = fromUtcMs(date.getTime());
    if (daysBetween(today, day) >= -PLAN_DAYS_BEFORE) return day;
  }
  return null;
}

/** Month and day: this year, or next year when it's already past (before yesterday). */
function monthDay(month: number, dom: number, today: IsoDay): IsoDay | null {
  const y = Number(today.slice(0, 4));
  for (const year of [y, y + 1]) {
    const date = new Date(Date.UTC(year, month, dom));
    if (date.getUTCMonth() !== month || date.getUTCDate() !== dom) return null;
    const day = fromUtcMs(date.getTime());
    if (daysBetween(today, day) >= -PLAN_DAYS_BEFORE) return day;
  }
  return null;
}

/**
 * The calendar day a phrase names, counted from `today` (the message's own day in the person's
 * time zone), or null when it doesn't name exactly one day ("next week", "soon", "10/20").
 *
 * - "today", "tonight" · "tomorrow" · "yesterday", "last night" · "the day after tomorrow"
 * - a weekday ("Tuesday", "tue", "on Friday", "this Friday"): the next one, today included
 * - "next Tuesday": the same, except on a Tuesday it's a week later (never today)
 * - "in 3 days", "in a week", "in two weeks"
 * - "Oct 20", "October 20th", "20 October", "the 20th of October", "2026-10-20"
 * - "the 20th": this month, or next month when it's already past
 *
 * The plan window is not checked here: the backend refuses dates outside it with a reason.
 */
export function resolveDay(phrase: string, today: IsoDay): IsoDay | null {
  if (!isIsoDay(today)) return null;
  const p = phrase
    .toLowerCase()
    .trim()
    .replace(/[.!?,]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:for|on|by|until|till) /, "")
    .replace(/ (?:night|evening|morning|lunch|dinner|for dinner|for lunch)$/, "")
    .trim();
  if (!p) return null;
  if (isIsoDay(p)) return p;

  if (p === "today" || p === "tonight" || p === "this evening" || p === "this morning") return today;
  if (p === "tomorrow" || p === "tmrw" || p === "tmr") return addDays(today, 1);
  if (p === "yesterday" || p === "last night") return addDays(today, -1);
  if (p === "the day after tomorrow" || p === "day after tomorrow") return addDays(today, 2);

  // "in 3 days", "in a week", "in two weeks", "a week from today"
  let m = /^(?:in )?(\d{1,2}|[a-z-]+) (day|days|week|weeks)(?: from (?:now|today))?$/.exec(p);
  if (m && (p.startsWith("in ") || / from (now|today)$/.test(p))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : SMALL_NUMBERS[m[1]];
    if (n !== undefined) return addDays(today, m[2].startsWith("week") ? n * 7 : n);
  }

  // Weekdays: "tuesday", "this tuesday", "next tuesday", "this coming tuesday"
  m = /^(this coming |coming |this |next )?([a-z]+)$/.exec(p);
  if (m) {
    const wd = weekdayIndex(m[2]);
    if (wd >= 0) {
      let ahead = (wd - weekdayOf(today) + 7) % 7;
      if (ahead === 0 && m[1] === "next ") ahead = 7;
      return addDays(today, ahead);
    }
  }
  // "the 20th", "tuesday the 20th" → the date
  m = /^(?:([a-z]+),? )?(?:the )?(\d{1,2})(?:st|nd|rd|th)?$/.exec(p);
  if (m && (!m[1] || m[1] === "the" || weekdayIndex(m[1]) >= 0)) return nextDayOfMonth(Number(m[2]), today);

  // "oct 20", "october 20th", "tuesday, october 20"
  m = /^(?:([a-z]+),? )?([a-z]+\.?) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(p);
  if (m && (!m[1] || weekdayIndex(m[1]) >= 0) && monthIndex(m[2]) >= 0) {
    const [month, dom, year] = [monthIndex(m[2]), m[3], m[4]];
    if (year) {
      const day = `${year}-${String(month + 1).padStart(2, "0")}-${dom.padStart(2, "0")}`;
      return isIsoDay(day) ? day : null;
    }
    return monthDay(month, Number(dom), today);
  }
  // "20 october", "the 20th of october"
  m = /^(?:the )?(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+\.?)(?:,? (\d{4}))?$/.exec(p);
  if (m && monthIndex(m[2]) >= 0) {
    if (m[3]) {
      const day = `${m[3]}-${String(monthIndex(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      return isIsoDay(day) ? day : null;
    }
    return monthDay(monthIndex(m[2]), Number(m[1]), today);
  }
  return null;
}
