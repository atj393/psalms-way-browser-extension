import { describe, it, expect } from "vitest";
import { currentStreak, inStreakRun, longestStreak, nextStreak } from "../src/streak.js";

// Local noon of a calendar day, so no case depends on the runner's time zone.
const day = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe("nextStreak: the phone's checkAndUpdateStreak", () => {
  it("starts at 1 on the very first open", () => {
    const expected = { lastDate: "2026-06-10", count: 1, longestStreak: 1 };
    expect(nextStreak(null, day(2026, 6, 10))).toEqual(expected);
    expect(nextStreak(undefined, day(2026, 6, 10))).toEqual(expected);
    expect(nextStreak({ lastDate: "", count: 0 }, day(2026, 6, 10))).toEqual(expected);
  });

  it("does not count a second open on the same day", () => {
    const data = { lastDate: "2026-06-10", count: 3, longestStreak: 5 };
    expect(nextStreak(data, day(2026, 6, 10, 22))).toEqual(data);
  });

  it("fills in a missing longestStreak on the same day, as the phone's migration does", () => {
    const data = { lastDate: "2026-06-10", count: 7 };
    expect(nextStreak(data, day(2026, 6, 10))).toEqual({
      lastDate: "2026-06-10",
      count: 7,
      longestStreak: 7,
    });
  });

  it("adds one on the next day and raises the longest streak with it", () => {
    const data = { lastDate: "2026-06-10", count: 5, longestStreak: 5 };
    expect(nextStreak(data, day(2026, 6, 11))).toEqual({
      lastDate: "2026-06-11",
      count: 6,
      longestStreak: 6,
    });
  });

  it("keeps a longer streak from the past when the count is lower", () => {
    const data = { lastDate: "2026-06-10", count: 2, longestStreak: 9 };
    expect(nextStreak(data, day(2026, 6, 11))).toEqual({
      lastDate: "2026-06-11",
      count: 3,
      longestStreak: 9,
    });
  });

  it("restarts at 1 after a missed day and remembers the longest", () => {
    const data = { lastDate: "2026-06-11", count: 3, longestStreak: 3 };
    expect(nextStreak(data, day(2026, 6, 14))).toEqual({
      lastDate: "2026-06-14",
      count: 1,
      longestStreak: 3,
    });
  });

  it("uses the count as the longest streak when a restart finds no longest stored", () => {
    const data = { lastDate: "2026-06-10", count: 4 };
    expect(nextStreak(data, day(2026, 6, 20)).longestStreak).toBe(4);
  });

  it("restarts rather than producing NaN from an unreadable date", () => {
    for (const lastDate of ["nope", "2026-02-31", "2026-13-01", "20260610"]) {
      const next = nextStreak({ lastDate, count: 5, longestStreak: 8 }, day(2026, 6, 10));
      expect(next).toEqual({ lastDate: "2026-06-10", count: 1, longestStreak: 8 });
    }
  });

  it("treats a last date in the future (clock set back) as a break, like the phone", () => {
    const data = { lastDate: "2026-06-20", count: 6, longestStreak: 6 };
    expect(nextStreak(data, day(2026, 6, 10))).toEqual({
      lastDate: "2026-06-10",
      count: 1,
      longestStreak: 6,
    });
  });

  it("recovers from stored values of the wrong shape", () => {
    const first = { lastDate: "2026-06-10", count: 1, longestStreak: 1 };
    expect(nextStreak({ count: "many", lastDate: 42 }, day(2026, 6, 10))).toEqual(first);
    expect(nextStreak("garbage", day(2026, 6, 10))).toEqual(first);
    expect(nextStreak([], day(2026, 6, 10))).toEqual(first);
    // A count that is not a number is read as 0; the date alone still counts as a visit.
    expect(nextStreak({ lastDate: "2026-06-09", count: NaN }, day(2026, 6, 10)).count).toBe(1);
  });

  it("keeps the longest streak of a record whose count is damaged", () => {
    const damaged = { lastDate: "2026-06-09", count: "bad", longestStreak: 30 };
    expect(nextStreak(damaged, day(2026, 6, 10))).toEqual({
      lastDate: "2026-06-10",
      count: 1,
      longestStreak: 30,
    });
    expect(nextStreak({ ...damaged, lastDate: "2026-06-01" }, day(2026, 6, 10)).longestStreak).toBe(
      30
    );
  });

  it("ignores a longest streak that is not a number", () => {
    const data = { lastDate: "2026-06-10", count: 2, longestStreak: "lots" };
    expect(nextStreak(data, day(2026, 6, 11))).toEqual({
      lastDate: "2026-06-11",
      count: 3,
      longestStreak: 3,
    });
  });

  it("changes the day at the reader's own midnight", () => {
    const data = { lastDate: "2026-06-10", count: 1, longestStreak: 1 };
    expect(nextStreak(data, day(2026, 6, 11, 0, 15)).count).toBe(2);
    expect(nextStreak(data, day(2026, 6, 10, 23, 55)).count).toBe(1);
  });

  it("counts a daylight-saving change as one day", () => {
    const springForward = { lastDate: "2026-03-07", count: 1, longestStreak: 1 };
    expect(nextStreak(springForward, day(2026, 3, 8)).count).toBe(2);
    const fallBack = { lastDate: "2026-10-31", count: 1, longestStreak: 1 };
    expect(nextStreak(fallBack, day(2026, 11, 1)).count).toBe(2);
    const europe = { lastDate: "2026-10-24", count: 1, longestStreak: 1 };
    expect(nextStreak(europe, day(2026, 10, 25)).count).toBe(2);
  });

  it("walks a whole run: build, break, build again", () => {
    let data = null;
    for (const d of [10, 11, 12, 13]) data = nextStreak(data, day(2026, 6, d));
    expect(data).toEqual({ lastDate: "2026-06-13", count: 4, longestStreak: 4 });
    data = nextStreak(data, day(2026, 6, 20));
    expect(data).toEqual({ lastDate: "2026-06-20", count: 1, longestStreak: 4 });
    data = nextStreak(data, day(2026, 6, 21));
    expect(data).toEqual({ lastDate: "2026-06-21", count: 2, longestStreak: 4 });
  });

  it("never changes the data it is given", () => {
    const data = Object.freeze({ lastDate: "2026-06-10", count: 2, longestStreak: 2 });
    expect(() => nextStreak(data, day(2026, 6, 11))).not.toThrow();
    expect(data.count).toBe(2);
  });
});

describe("currentStreak: the phone's getStreak", () => {
  const data = { lastDate: "2026-06-10", count: 4, longestStreak: 6 };

  it("is the count while the last visit was today or yesterday", () => {
    expect(currentStreak(data, day(2026, 6, 10))).toBe(4);
    expect(currentStreak(data, day(2026, 6, 11))).toBe(4);
  });

  it("is 0 once a day has been missed", () => {
    expect(currentStreak(data, day(2026, 6, 12))).toBe(0);
    expect(currentStreak(data, day(2026, 7, 1))).toBe(0);
  });

  it("is 0 with no streak or an unreadable date", () => {
    expect(currentStreak(null, day(2026, 6, 10))).toBe(0);
    expect(currentStreak({ lastDate: "", count: 3 }, day(2026, 6, 10))).toBe(0);
    expect(currentStreak({ lastDate: "nope", count: 3 }, day(2026, 6, 10))).toBe(0);
  });

  it("still shows the count when the last date is ahead of the clock, like the phone", () => {
    expect(currentStreak(data, day(2026, 6, 8))).toBe(4);
  });
});

describe("longestStreak", () => {
  it("is the stored longest, else the count, else 0", () => {
    expect(longestStreak({ lastDate: "2026-06-10", count: 4, longestStreak: 6 })).toBe(6);
    expect(longestStreak({ lastDate: "2026-06-10", count: 4 })).toBe(4);
    expect(longestStreak(null)).toBe(0);
  });
});

describe("inStreakRun", () => {
  const run = { lastDate: "2026-06-10", count: 3, longestStreak: 3 };

  it("is true for each of the count days ending on the last date", () => {
    expect(inStreakRun(run, "2026-06-10")).toBe(true);
    expect(inStreakRun(run, "2026-06-09")).toBe(true);
    expect(inStreakRun(run, "2026-06-08")).toBe(true);
  });

  it("is false for the day before the run and for days after it", () => {
    expect(inStreakRun(run, "2026-06-07")).toBe(false);
    expect(inStreakRun(run, "2026-06-11")).toBe(false);
  });

  it("follows the calendar across a month and a year", () => {
    expect(inStreakRun({ lastDate: "2027-01-01", count: 3 }, "2026-12-30")).toBe(true);
    expect(inStreakRun({ lastDate: "2027-01-01", count: 3 }, "2026-12-29")).toBe(false);
  });

  it("is false when there is no run or it cannot be read", () => {
    expect(inStreakRun(null, "2026-06-10")).toBe(false);
    expect(inStreakRun({ lastDate: "", count: 3 }, "2026-06-10")).toBe(false);
    expect(inStreakRun({ lastDate: "nope", count: 3 }, "2026-06-10")).toBe(false);
    expect(inStreakRun({ lastDate: "2026-06-10", count: "bad" }, "2026-06-10")).toBe(false);
    expect(inStreakRun(run, "not a day")).toBe(false);
  });
});
