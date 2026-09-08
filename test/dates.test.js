import { describe, it, expect } from "vitest";
import { dayOfYear, getDailyChapterIndex, formatTimestamp } from "../src/dates.js";
import { CHAPTER_COUNT } from "../src/data.js";

describe("dayOfYear", () => {
  it("treats 1 January as day 1", () => {
    expect(dayOfYear(new Date(2026, 0, 1, 12))).toBe(1);
    expect(dayOfYear(new Date(2024, 0, 1, 0, 0, 0))).toBe(1);
  });

  it("counts to 365 in a common year and 366 in a leap year", () => {
    expect(dayOfYear(new Date(2026, 11, 31, 12))).toBe(365);
    expect(dayOfYear(new Date(2024, 11, 31, 12))).toBe(366);
  });

  it("is identical for every instant within one local day", () => {
    const days = [
      [2026, 0, 1],
      [2026, 2, 29], // European spring-forward
      [2026, 9, 25], // European fall-back
      [2026, 6, 15],
    ];
    for (const [y, m, d] of days) {
      const values = new Set();
      for (let hour = 0; hour < 24; hour++) {
        values.add(dayOfYear(new Date(y, m, d, hour, 30)));
      }
      expect(values.size, `local day ${y}-${m + 1}-${d} spans multiple day numbers`).toBe(1);
    }
  });
});

describe("getDailyChapterIndex", () => {
  it("maps 1 January to Psalm 1", () => {
    expect(getDailyChapterIndex(new Date(2026, 0, 1, 9))).toBe(0);
  });

  it("advances by one chapter each calendar day", () => {
    const a = getDailyChapterIndex(new Date(2026, 5, 10, 8));
    const b = getDailyChapterIndex(new Date(2026, 5, 11, 8));
    expect(b).toBe((a + 1) % CHAPTER_COUNT);
  });

  it("stays within range for every day of several years", () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      for (let month = 0; month < 12; month++) {
        for (let day = 1; day <= 31; day++) {
          const date = new Date(year, month, day, 12);
          if (date.getMonth() !== month) continue; // skipped short-month overflow
          const index = getDailyChapterIndex(date);
          expect(Number.isInteger(index)).toBe(true);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(CHAPTER_COUNT);
        }
      }
    }
  });

  // Regression: the previous implementation divided a millisecond difference by
  // 86_400_000. In Europe/Berlin that repeated Psalm 89 on 29 and 30 March 2026,
  // skipped Psalm 149 in October, and changed the Psalm midway through 25
  // October. These properties fail for that implementation in any zone that
  // observes daylight saving, whichever zone the test host is in.
  it("never repeats or skips a chapter between consecutive days", () => {
    // Checked just after midnight as well as at noon: a millisecond-based
    // implementation drifts at the start of the day, where the offset change
    // lands, and can look correct at midday.
    for (const [hour, minute] of [
      [0, 30],
      [12, 0],
      [23, 30],
    ]) {
      for (const year of [2024, 2025, 2026, 2027]) {
        const cursor = new Date(year, 0, 1, hour, minute);
        let previous = getDailyChapterIndex(cursor);
        const end = new Date(year, 11, 31, hour, minute);
        while (cursor < end) {
          cursor.setDate(cursor.getDate() + 1);
          const current = getDailyChapterIndex(cursor);
          expect(
            current,
            `${cursor.toDateString()} ${hour}:${minute} did not follow the previous day`
          ).toBe((previous + 1) % CHAPTER_COUNT);
          previous = current;
        }
      }
    }
  });

  it("returns one chapter for the whole of a daylight-saving transition day", () => {
    // Cover both hemispheres' usual transition weekends regardless of host zone.
    const candidates = [
      [2026, 2, 8],
      [2026, 2, 29],
      [2026, 3, 5],
      [2026, 9, 4],
      [2026, 9, 25],
      [2026, 10, 1],
    ];
    for (const [y, m, d] of candidates) {
      const values = new Set();
      for (let hour = 0; hour < 24; hour++) {
        values.add(getDailyChapterIndex(new Date(y, m, d, hour, 15)));
      }
      expect(values.size, `${y}-${m + 1}-${d} produced ${values.size} chapters`).toBe(1);
    }
  });

  it("wraps from Psalm 150 back to Psalm 1", () => {
    // Day 150 is Psalm 150; day 151 must be Psalm 1 again.
    const dayOf = (n) => {
      const date = new Date(2026, 0, 1, 12);
      date.setDate(date.getDate() + (n - 1));
      return getDailyChapterIndex(date);
    };
    expect(dayOf(150)).toBe(149);
    expect(dayOf(151)).toBe(0);
  });
});

describe("formatTimestamp", () => {
  const now = new Date(2026, 5, 15, 12);

  it("labels today and yesterday", () => {
    expect(formatTimestamp(new Date(2026, 5, 15, 8).getTime(), now)).toBe("Today");
    expect(formatTimestamp(new Date(2026, 5, 14, 23).getTime(), now)).toBe("Yesterday");
  });

  it("formats older dates without crashing", () => {
    const result = formatTimestamp(new Date(2026, 2, 3, 10).getTime(), now);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("Today");
  });

  it("returns an empty string for unusable input", () => {
    expect(formatTimestamp(undefined, now)).toBe("");
    expect(formatTimestamp(Number.NaN, now)).toBe("");
    expect(formatTimestamp("not a number", now)).toBe("");
  });
});
