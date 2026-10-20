import { describe, it, expect } from "vitest";
import { computeStats } from "../src/stats.js";

// Tuesday 20 October 2026, 10:00 local. Months are 0-based in the Date constructor.
const NOW = new Date(2026, 9, 20, 10, 0);
const at = (monthIndex, d, h = 12, min = 0) => new Date(2026, monthIndex, d, h, min).getTime();
const view = (chapterIndex, viewedAt, verseIndex = null) => ({
  chapterIndex,
  verseIndex,
  viewedAt,
});

const storeOf = (parts = {}) => ({
  favourites: [],
  notes: [],
  history: [],
  carry: {},
  ...parts,
});

describe("computeStats on an empty store", () => {
  it("is all zeros, with a week of unread days ending today", () => {
    const stats = computeStats(storeOf(), NOW);
    expect(stats).toMatchObject({
      streak: 0,
      longestStreak: 0,
      chaptersRead: 0,
      bookmarks: 0,
      highlights: 0,
      notes: 0,
      favourites: 0,
    });
    expect(stats).not.toHaveProperty("sessions");
    expect(stats).not.toHaveProperty("mostRead");
    expect(stats.week).toHaveLength(7);
    expect(stats.week.every((d) => d.read === false)).toBe(true);
    expect(stats.week.at(-1).dateKey).toBe("2026-10-20");
  });
});

describe("the streak", () => {
  it("is the current and the longest streak from the phone's data", () => {
    const carry = { streak: { lastDate: "2026-10-19", count: 4, longestStreak: 9 } };
    const stats = computeStats(storeOf({ carry }), NOW);
    expect(stats.streak).toBe(4);
    expect(stats.longestStreak).toBe(9);
  });

  it("still shows the longest streak of a record whose count is damaged", () => {
    const carry = { streak: { lastDate: "2026-10-20", count: "bad", longestStreak: 30 } };
    const stats = computeStats(storeOf({ carry }), NOW);
    expect(stats.streak).toBe(0);
    expect(stats.longestStreak).toBe(30);
  });

  it("shows 0 for a lapsed streak but still remembers the longest", () => {
    const carry = { streak: { lastDate: "2026-10-10", count: 4, longestStreak: 9 } };
    const stats = computeStats(storeOf({ carry }), NOW);
    expect(stats.streak).toBe(0);
    expect(stats.longestStreak).toBe(9);
  });
});

describe("the last seven days", () => {
  it("runs oldest to newest, ending today, with the weekday of each day", () => {
    const { week } = computeStats(storeOf(), NOW);
    expect(week.map((d) => d.dateKey)).toEqual([
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
    // 14 October 2026 is a Wednesday (3); 20 October is a Tuesday (2).
    expect(week.map((d) => d.weekday)).toEqual([3, 4, 5, 6, 0, 1, 2]);
  });

  it("marks the days on which something was read", () => {
    const history = [
      view(22, at(9, 20, 9)),
      view(0, at(9, 18, 21)),
      view(1, at(9, 14, 0, 5)),
      view(2, at(9, 13, 23, 59)), // the day before the window
      view(3, at(9, 12)),
    ];
    const { week } = computeStats(storeOf({ history }), NOW);
    expect(week.map((d) => d.read)).toEqual([true, false, false, false, true, false, true]);
  });

  it("files a late-evening reading under the reader's own day", () => {
    const history = [view(22, at(9, 19, 23, 50))];
    const { week } = computeStats(storeOf({ history }), NOW);
    expect(week.find((d) => d.dateKey === "2026-10-19").read).toBe(true);
    expect(week.find((d) => d.dateKey === "2026-10-20").read).toBe(false);
  });

  it("counts the days of the current streak as read, even when history has only one entry", () => {
    // History keeps one entry per chapter, so re-reading a chapter on three days leaves only
    // the latest of them; the streak still says the app was opened on all three.
    const carry = { streak: { lastDate: "2026-10-20", count: 3, longestStreak: 3 } };
    const history = [view(22, at(9, 20, 9))];
    const { week } = computeStats(storeOf({ history, carry }), NOW);
    expect(week.map((d) => d.read)).toEqual([false, false, false, false, true, true, true]);
  });

  it("combines the streak with the days that have a history entry", () => {
    const carry = { streak: { lastDate: "2026-10-20", count: 2, longestStreak: 2 } };
    const history = [view(5, at(9, 15, 7)), view(22, at(9, 20, 9))];
    const { week } = computeStats(storeOf({ history, carry }), NOW);
    expect(week.map((d) => d.read)).toEqual([false, true, false, false, false, true, true]);
  });

  it("marks all seven days for a streak longer than the week, and none outside the run", () => {
    const long = { streak: { lastDate: "2026-10-20", count: 30, longestStreak: 30 } };
    expect(computeStats(storeOf({ carry: long }), NOW).week.every((d) => d.read)).toBe(true);

    const ended = { streak: { lastDate: "2026-10-16", count: 2, longestStreak: 2 } };
    const { week } = computeStats(storeOf({ carry: ended }), NOW);
    expect(week.map((d) => d.read)).toEqual([false, true, true, false, false, false, false]);
  });

  it("works across a month and year boundary", () => {
    const early = new Date(2027, 0, 2, 8, 0);
    const { week } = computeStats(
      storeOf({ history: [view(0, new Date(2026, 11, 30, 8).getTime())] }),
      early
    );
    expect(week[0].dateKey).toBe("2026-12-27");
    expect(week[3].dateKey).toBe("2026-12-30");
    expect(week[3].read).toBe(true);
    expect(week.at(-1).dateKey).toBe("2027-01-02");
  });
});

describe("reading totals", () => {
  const history = [
    view(22, at(9, 20)),
    view(0, at(9, 19), 4),
    view(22, at(9, 18)),
    view(22, at(9, 17)),
    view(118, at(9, 16)),
    view(118, at(9, 15)),
    view(5, at(9, 14)),
  ];

  it("counts the chapters read, once each", () => {
    const stats = computeStats(storeOf({ history }), NOW);
    expect(stats.chaptersRead).toBe(4);
  });

  it("counts bookmarks, notes, highlights and favourite chapters", () => {
    const store = storeOf({
      favourites: [
        { chapterIndex: 22, verseIndex: 0, addedAt: 1 },
        { chapterIndex: 22, verseIndex: 3, addedAt: 2 },
      ],
      notes: [
        { id: "n_0_0", chapterIndex: 0, verseIndex: 0, text: "x", createdAt: 1, updatedAt: 1 },
      ],
      carry: {
        highlights: [
          { chapter: 1, verse: 1, color: "yellow" },
          { chapter: 2, verse: 3, color: "blue" },
          { chapter: 23, verse: 1, color: "pink" },
        ],
        favorites: [23, 1, 119, 150],
      },
    });
    const stats = computeStats(store, NOW);
    expect(stats.bookmarks).toBe(2);
    expect(stats.notes).toBe(1);
    expect(stats.highlights).toBe(3);
    expect(stats.favourites).toBe(4);
  });

  it("copes with missing parts of the phone's data", () => {
    const stats = computeStats({ favourites: [], notes: [], history: [] }, NOW);
    expect(stats.highlights).toBe(0);
    expect(stats.favourites).toBe(0);
    expect(stats.streak).toBe(0);
  });
});
