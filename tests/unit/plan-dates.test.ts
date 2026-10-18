/**
 * Dated week plan (0045 KOS1): the pure calendar-date helpers. Days are calendar dates, so DST and
 * month ends can't shift them; only "today" depends on the person's time zone.
 */
import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  englishDayLabel,
  inPlanWindow,
  isIsoDay,
  planWindow,
  resolveDay,
  safeTimeZone,
  todayIn,
  weekdayOf,
} from "@/shared/plan-dates";

describe("isIsoDay", () => {
  it.each([
    ["2026-10-20", true],
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["2026-1-01", false],
    ["2026-10-20T00:00:00Z", false],
    ["", false],
  ])("%s → %s", (s, ok) => expect(isIsoDay(s)).toBe(ok));
});

describe("todayIn: the person's own day", () => {
  it("late evening in Los Angeles is still the same day there, though UTC is tomorrow", () => {
    const now = new Date("2026-10-17T05:30:00Z"); // 22:30 on the 16th in LA (PDT, UTC-7)
    expect(todayIn("America/Los_Angeles", now)).toBe("2026-10-16");
    expect(todayIn("UTC", now)).toBe("2026-10-17");
  });
  it("early morning in Tokyo is already the next day", () => {
    expect(todayIn("Asia/Tokyo", new Date("2026-10-16T16:30:00Z"))).toBe("2026-10-17");
  });
  it("across the autumn DST change (New York, 2026-11-01 02:00 → 01:00)", () => {
    expect(todayIn("America/New_York", new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31"); // 23:59 EDT
    expect(todayIn("America/New_York", new Date("2026-11-01T04:30:00Z"))).toBe("2026-11-01"); // 00:30 EDT
    expect(todayIn("America/New_York", new Date("2026-11-02T04:30:00Z"))).toBe("2026-11-01"); // 23:30 EST
    expect(todayIn("America/New_York", new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02"); // 00:00 EST
  });
  it("across the spring DST change (New York, 2026-03-08)", () => {
    expect(todayIn("America/New_York", new Date("2026-03-08T04:59:00Z"))).toBe("2026-03-07"); // 23:59 EST
    expect(todayIn("America/New_York", new Date("2026-03-09T03:59:00Z"))).toBe("2026-03-08"); // 23:59 EDT
  });
  it("no or an unknown time zone → UTC (never throws)", () => {
    const now = new Date("2026-10-16T23:30:00Z");
    expect(todayIn(undefined, now)).toBe("2026-10-16");
    expect(todayIn("Mars/Olympus_Mons", now)).toBe("2026-10-16");
    expect(safeTimeZone("not a zone")).toBe("UTC");
    expect(safeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month and year ends and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("is unaffected by DST weeks (every day is exactly one day)", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(daysBetween("2026-10-30", "2026-11-03")).toBe(4);
    expect(daysBetween("2026-11-03", "2026-10-30")).toBe(-4);
  });
  it("weekdays and English labels", () => {
    expect(weekdayOf("2026-10-16")).toBe(5); // Friday
    expect(weekdayOf("2026-10-18")).toBe(0); // Sunday
    expect(englishDayLabel("2026-10-20")).toBe("Tue, Oct 20");
  });
});

describe("plan window: yesterday to 21 days ahead (KOS1)", () => {
  const today = "2026-10-16";
  it("edges", () => {
    expect(planWindow(today)).toEqual({ from: "2026-10-15", to: "2026-11-06" });
    expect(inPlanWindow("2026-10-15", today)).toBe(true); // yesterday
    expect(inPlanWindow("2026-10-14", today)).toBe(false); // two days ago
    expect(inPlanWindow("2026-11-06", today)).toBe(true); // 21 days ahead
    expect(inPlanWindow("2026-11-07", today)).toBe(false); // 22 days ahead
    expect(inPlanWindow("not a date", today)).toBe(false);
  });
  it("at a month end", () => {
    expect(planWindow("2026-03-01")).toEqual({ from: "2026-02-28", to: "2026-03-22" });
    expect(planWindow("2026-12-31")).toEqual({ from: "2026-12-30", to: "2027-01-21" });
  });
});

describe("resolveDay: relative days in code, from the message's day", () => {
  const friday = "2026-10-16";
  it.each([
    ["today", "2026-10-16"],
    ["tonight", "2026-10-16"],
    ["tomorrow", "2026-10-17"],
    ["tomorrow night", "2026-10-17"],
    ["yesterday", "2026-10-15"],
    ["the day after tomorrow", "2026-10-18"],
    ["Tuesday", "2026-10-20"],
    ["on tuesday", "2026-10-20"],
    ["for Tue", "2026-10-20"],
    ["this Friday", "2026-10-16"], // today is Friday
    ["Friday", "2026-10-16"],
    ["next Friday", "2026-10-23"], // never today
    ["next Tuesday", "2026-10-20"],
    ["Friday night", "2026-10-16"],
    ["sat", "2026-10-17"],
    ["Thursday", "2026-10-22"],
    ["in 3 days", "2026-10-19"],
    ["in a week", "2026-10-23"],
    ["in two weeks", "2026-10-30"],
    ["a week from today", "2026-10-23"],
    ["Oct 24", "2026-10-24"],
    ["October 24th", "2026-10-24"],
    ["24 October", "2026-10-24"],
    ["the 24th of October", "2026-10-24"],
    ["Saturday, October 24", "2026-10-24"],
    ["the 24th", "2026-10-24"],
    ["2026-10-24", "2026-10-24"],
    ["the 2nd", "2026-11-02"], // already past this month → next month
    ["Nov 2", "2026-11-02"],
    ["Jan 3", "2027-01-03"], // past this year → next year
  ])("%s → %s", (phrase, day) => expect(resolveDay(phrase, friday)).toBe(day));

  it.each(["next week", "soon", "sometime", "10/24", "weekend", "", "marmalade 5", "Feb 30"])("%s → null (ask which day)", (phrase) => {
    expect(resolveDay(phrase, friday)).toBeNull();
  });

  it("month ends: 'the 31st' skips months without one", () => {
    expect(resolveDay("the 31st", "2026-11-05")).toBe("2026-12-31");
    expect(resolveDay("the 30th", "2027-02-10")).toBe("2027-03-30");
  });
  it("crossing the year: 'tomorrow' on Dec 31, a weekday in the new year", () => {
    expect(resolveDay("tomorrow", "2026-12-31")).toBe("2027-01-01");
    expect(resolveDay("Monday", "2026-12-31")).toBe("2027-01-04");
  });
});
