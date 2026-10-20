import { describe, it, expect } from "vitest";
import {
  CHALLENGE_DEFS,
  canReadToday,
  getNextDayIndex,
  isChallengeProgress,
  markDayComplete,
  reminderTime,
  resetChallenge,
  startChallenge,
} from "../src/challenges.js";

// A version's text: chapter n (1-based) has verses.length verses.
const verseCounts = (counts) => counts.map((n) => Array.from({ length: n }, (_, i) => `v${i + 1}`));
const FULL_TEXT = verseCounts(Array.from({ length: 150 }, (_, i) => (i % 7) + 3));
const EIGHT = { hour: 8, minute: 0 };

const progressOf = (overrides = {}) => ({
  startDate: "2026-06-01",
  notifHour: 8,
  notifMinute: 0,
  dayAssignments: [
    { chapter: 57, verseNumber: 1 },
    { chapter: 142, verseNumber: 2 },
    { chapter: 54, verseNumber: 3 },
  ],
  completedDays: [],
  completed: false,
  ...overrides,
});

describe("the phone's six challenges", () => {
  it("have the phone's ids, lengths, icons and keys", () => {
    expect(
      CHALLENGE_DEFS.map(({ id, days, icon, i18nKey, i18nDescKey }) => [
        id,
        days,
        icon,
        i18nKey,
        i18nDescKey,
      ])
    ).toEqual([
      ["jesus_testing", 40, "✝️", "challenge_jesus_testing", "challenge_jesus_testing_desc"],
      ["fasting", 21, "🙏", "challenge_fasting", "challenge_fasting_desc"],
      ["david_hiding", 7, "🏔️", "challenge_david_hiding", "challenge_david_hiding_desc"],
      ["birth_of_jesus", 12, "⭐", "challenge_birth", "challenge_birth_desc"],
      ["trust_in_god", 30, "🕊️", "challenge_trust", "challenge_trust_desc"],
      ["praise_journey", 7, "🎵", "challenge_praise", "challenge_praise_desc"],
    ]);
  });

  it("read one psalm a day, from the phone's lists", () => {
    const chaptersOf = (id) => CHALLENGE_DEFS.find((d) => d.id === id).chapters;
    expect(chaptersOf("jesus_testing")).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(chaptersOf("fasting")).toEqual([
      51, 32, 42, 43, 46, 63, 84, 91, 103, 130, 143, 22, 23, 27, 31, 34, 37, 40, 62, 86, 25,
    ]);
    expect(chaptersOf("david_hiding")).toEqual([57, 142, 54, 52, 34, 56, 63]);
    expect(chaptersOf("birth_of_jesus")).toEqual([2, 8, 19, 22, 24, 45, 72, 89, 98, 110, 118, 132]);
    expect(chaptersOf("trust_in_god")).toEqual([
      23, 46, 91, 121, 27, 62, 37, 40, 34, 84, 63, 71, 125, 131, 112, 111, 128, 16, 18, 3, 4, 11,
      17, 20, 25, 31, 36, 52, 55, 61,
    ]);
    expect(chaptersOf("praise_journey")).toEqual([100, 103, 104, 107, 145, 146, 150]);
  });

  it("give every challenge one real psalm for each day", () => {
    for (const def of CHALLENGE_DEFS) {
      expect(def.chapters).toHaveLength(def.days);
      for (const chapter of def.chapters) {
        expect(chapter).toBeGreaterThanOrEqual(1);
        expect(chapter).toBeLessThanOrEqual(150);
      }
    }
    expect(new Set(CHALLENGE_DEFS.map((d) => d.id)).size).toBe(CHALLENGE_DEFS.length);
  });
});

describe("startChallenge", () => {
  it("creates the phone's progress record and stores it under the id", () => {
    const all = {};
    const progress = startChallenge(
      all,
      "david_hiding",
      FULL_TEXT,
      { hour: 7, minute: 30 },
      "2026-06-10"
    );
    expect(all.david_hiding).toBe(progress);
    expect(Object.keys(progress).sort()).toEqual([
      "completed",
      "completedDays",
      "dayAssignments",
      "notifHour",
      "notifMinute",
      "startDate",
    ]);
    expect(progress).toMatchObject({
      startDate: "2026-06-10",
      notifHour: 7,
      notifMinute: 30,
      completedDays: [],
      completed: false,
    });
    expect(progress).not.toHaveProperty("lastCompletedDate");
    expect(progress).not.toHaveProperty("completedDate");
  });

  it("assigns one verse to each day, in the challenge's chapter order, numbered from 1", () => {
    const progress = startChallenge({}, "david_hiding", FULL_TEXT, EIGHT, "2026-06-10", () => 0);
    expect(progress.dayAssignments).toEqual(
      [57, 142, 54, 52, 34, 56, 63].map((chapter) => ({ chapter, verseNumber: 1 }))
    );
  });

  it("picks the verse with the random number it is given, from the chapter's own length", () => {
    const text = verseCounts(Array(150).fill(10));
    const low = startChallenge({}, "praise_journey", text, EIGHT, "2026-06-10", () => 0);
    const high = startChallenge({}, "praise_journey", text, EIGHT, "2026-06-10", () => 0.999);
    expect(low.dayAssignments.every((a) => a.verseNumber === 1)).toBe(true);
    expect(high.dayAssignments.every((a) => a.verseNumber === 10)).toBe(true);

    const uneven = verseCounts(Array(150).fill(10));
    uneven[99] = ["only one"]; // Psalm 100
    const mixed = startChallenge({}, "praise_journey", uneven, EIGHT, "2026-06-10", () => 0.999);
    expect(mixed.dayAssignments[0]).toEqual({ chapter: 100, verseNumber: 1 });
    expect(mixed.dayAssignments[1]).toEqual({ chapter: 103, verseNumber: 10 });
  });

  it("uses Math.random when no random function is given, and stays inside the chapter", () => {
    const progress = startChallenge({}, "jesus_testing", FULL_TEXT, EIGHT, "2026-06-10");
    for (const { chapter, verseNumber } of progress.dayAssignments) {
      expect(verseNumber).toBeGreaterThanOrEqual(1);
      expect(verseNumber).toBeLessThanOrEqual(FULL_TEXT[chapter - 1].length);
    }
  });

  it("falls back to verse 1 for a psalm the version does not have", () => {
    const short = FULL_TEXT.slice(0, 100); // no Psalm 103 onwards
    const emptyChapter = [...short];
    emptyChapter[99] = [];
    const progress = startChallenge(
      {},
      "praise_journey",
      emptyChapter,
      EIGHT,
      "2026-06-10",
      () => 0.5
    );
    expect(progress.dayAssignments).toEqual(
      [100, 103, 104, 107, 145, 146, 150].map((chapter) => ({ chapter, verseNumber: 1 }))
    );
  });

  it("starts over when the challenge was already started, as the phone does", () => {
    const all = { david_hiding: progressOf({ completedDays: [0, 1] }), other: { kept: true } };
    startChallenge(all, "david_hiding", FULL_TEXT, EIGHT, "2026-06-10");
    expect(all.david_hiding.completedDays).toEqual([]);
    expect(all.other).toEqual({ kept: true });
  });

  it("refuses an unknown challenge and changes nothing", () => {
    const all = {};
    expect(() => startChallenge(all, "nope", FULL_TEXT, EIGHT, "2026-06-10")).toThrow(
      "Unknown challenge: nope"
    );
    expect(all).toEqual({});
  });
});

describe("getNextDayIndex", () => {
  it("is the first day not yet done, whatever order days were done in", () => {
    expect(getNextDayIndex(progressOf())).toBe(0);
    expect(getNextDayIndex(progressOf({ completedDays: [0] }))).toBe(1);
    expect(getNextDayIndex(progressOf({ completedDays: [2, 0] }))).toBe(1);
  });

  it("is -1 when every day is done", () => {
    expect(getNextDayIndex(progressOf({ completedDays: [0, 1, 2] }))).toBe(-1);
  });
});

describe("canReadToday", () => {
  it("allows a first reading", () => {
    expect(canReadToday(progressOf(), "2026-06-10")).toBe(true);
  });

  it("blocks a second reading on the day of the first and allows it the next day", () => {
    const p = progressOf({ lastCompletedDate: "2026-06-10" });
    expect(canReadToday(p, "2026-06-10")).toBe(false);
    expect(canReadToday(p, "2026-06-11")).toBe(true);
  });
});

describe("markDayComplete", () => {
  it("completes a day and reports what is left", () => {
    const all = { david_hiding: progressOf() };
    const result = markDayComplete(all, "david_hiding", 0, "2026-06-10");
    expect(result).toEqual({
      blocked: false,
      completedDayIndex: 0,
      daysLeft: 2,
      challengeJustCompleted: false,
    });
    expect(all.david_hiding.completedDays).toEqual([0]);
    expect(all.david_hiding.lastCompletedDate).toBe("2026-06-10");
    expect(all.david_hiding.completed).toBe(false);
    expect(all.david_hiding).not.toHaveProperty("completedDate");
  });

  it("blocks a second reading on the same day and changes nothing", () => {
    const all = { david_hiding: progressOf() };
    markDayComplete(all, "david_hiding", 0, "2026-06-10");
    const second = markDayComplete(all, "david_hiding", 1, "2026-06-10");
    expect(second).toEqual({ blocked: true });
    expect(all.david_hiding.completedDays).toEqual([0]);
  });

  it("allows the next reading on the next day", () => {
    const all = { david_hiding: progressOf() };
    markDayComplete(all, "david_hiding", 0, "2026-06-10");
    const next = markDayComplete(all, "david_hiding", 1, "2026-06-11");
    expect(next).toMatchObject({ blocked: false, completedDayIndex: 1, daysLeft: 1 });
    expect(all.david_hiding.completedDays).toEqual([0, 1]);
    expect(all.david_hiding.lastCompletedDate).toBe("2026-06-11");
  });

  it("agrees with canReadToday across midnight", () => {
    const all = { david_hiding: progressOf() };
    markDayComplete(all, "david_hiding", 0, "2026-06-10");
    expect(canReadToday(all.david_hiding, "2026-06-10")).toBe(false);
    expect(canReadToday(all.david_hiding, "2026-06-11")).toBe(true);
  });

  it("completes the challenge on the last day, with the date", () => {
    const all = {
      david_hiding: progressOf({ completedDays: [0, 1], lastCompletedDate: "2026-06-09" }),
    };
    const result = markDayComplete(all, "david_hiding", 2, "2026-06-10");
    expect(result).toEqual({
      blocked: false,
      completedDayIndex: 2,
      daysLeft: 0,
      challengeJustCompleted: true,
    });
    expect(all.david_hiding).toMatchObject({
      completed: true,
      completedDate: "2026-06-10",
      completedDays: [0, 1, 2],
    });
  });

  it("does not count a day twice", () => {
    const all = {
      david_hiding: progressOf({ completedDays: [0], lastCompletedDate: "2026-06-09" }),
    };
    const result = markDayComplete(all, "david_hiding", 0, "2026-06-10");
    expect(all.david_hiding.completedDays).toEqual([0]);
    expect(result.daysLeft).toBe(2);
  });

  it("refuses a day outside the challenge, so the count cannot be inflated", () => {
    for (const index of [-1, 3, 99, 1.5, NaN, "1", undefined]) {
      const all = { david_hiding: progressOf() };
      expect(() => markDayComplete(all, "david_hiding", index, "2026-06-10")).toThrow(
        /out of range/
      );
      expect(all.david_hiding.completedDays).toEqual([]);
      expect(all.david_hiding).not.toHaveProperty("lastCompletedDate");
    }
  });

  it("checks the day number before the once-a-day limit, as the phone does", () => {
    const all = { david_hiding: progressOf({ lastCompletedDate: "2026-06-10" }) };
    expect(() => markDayComplete(all, "david_hiding", 99, "2026-06-10")).toThrow(/out of range/);
  });

  it("refuses a challenge that was never started", () => {
    expect(() => markDayComplete({}, "david_hiding", 0, "2026-06-10")).toThrow(
      "Challenge not started"
    );
  });
});

describe("resetChallenge", () => {
  it("clears that challenge and leaves the others", () => {
    const all = { david_hiding: progressOf(), praise_journey: progressOf() };
    resetChallenge(all, "david_hiding");
    expect(Object.keys(all)).toEqual(["praise_journey"]);
  });

  it("does nothing for a challenge that was never started", () => {
    const all = { praise_journey: progressOf() };
    resetChallenge(all, "david_hiding");
    expect(Object.keys(all)).toEqual(["praise_journey"]);
  });
});

describe("reminderTime: the phone's reminder time, which new challenges record", () => {
  it("is 8:00 when the phone has not set one", () => {
    expect(reminderTime({})).toEqual({ hour: 8, minute: 0 });
    expect(reminderTime(undefined)).toEqual({ hour: 8, minute: 0 });
  });

  it("is the phone's notificationHour and notificationMinute", () => {
    expect(reminderTime({ notificationHour: 21, notificationMinute: 45 })).toEqual({
      hour: 21,
      minute: 45,
    });
    expect(reminderTime({ notificationHour: 0, notificationMinute: 0 })).toEqual({
      hour: 0,
      minute: 0,
    });
  });

  it("replaces only the part that is not a real time", () => {
    expect(reminderTime({ notificationHour: 24, notificationMinute: 30 })).toEqual({
      hour: 8,
      minute: 30,
    });
    expect(reminderTime({ notificationHour: 9, notificationMinute: 60 })).toEqual({
      hour: 9,
      minute: 0,
    });
    expect(reminderTime({ notificationHour: "9", notificationMinute: 1.5 })).toEqual({
      hour: 8,
      minute: 0,
    });
  });
});

describe("isChallengeProgress", () => {
  it("accepts the phone's record", () => {
    expect(isChallengeProgress(progressOf())).toBe(true);
  });

  it("rejects anything the screens could not read safely", () => {
    expect(isChallengeProgress(undefined)).toBe(false);
    expect(isChallengeProgress(null)).toBe(false);
    expect(isChallengeProgress("started")).toBe(false);
    expect(isChallengeProgress([])).toBe(false);
    expect(isChallengeProgress(progressOf({ dayAssignments: undefined }))).toBe(false);
    expect(isChallengeProgress(progressOf({ completedDays: "0,1" }))).toBe(false);
  });
});
