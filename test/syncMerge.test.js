import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { combineNoteText, isEmptyData, mergeBackupData, same } from "../src/syncMerge.js";

// The phone app's own cases, copied byte for byte from
// psalms-way-app/__tests__/fixtures/syncVectors.json: both clients must
// combine identically or bookmarks would differ between phone and browser.
const vectors = JSON.parse(
  readFileSync(new URL("./fixtures/syncVectors.json", import.meta.url), "utf8")
);

function data(partial = {}) {
  return {
    bookmarks: [],
    favorites: [],
    highlights: [],
    notes: [],
    history: [],
    streak: null,
    badges: null,
    challenges: null,
    settings: {},
    ...partial,
  };
}

describe("the phone app's shared cases", () => {
  it.each(vectors.cases.map((c) => [c.name, c]))("%s", (_name, c) => {
    const base = c.base === null ? null : data(c.base);
    const { data: out } = mergeBackupData(data(c.phone), data(c.cloud), base);
    for (const [field, value] of Object.entries(c.expected)) {
      expect(out[field]).toEqual(value);
    }
  });
});

describe("keeping both sides (no base)", () => {
  it("keeps every bookmark, favourite, highlight and note from both", () => {
    const { data: out, addedFromCloud } = mergeBackupData(
      data({
        bookmarks: [{ chapter: 1, verse: 1 }],
        favorites: [23],
        notes: [{ chapter: 5, verse: 1, text: "Mine", date: "2026-10-01T00:00:00.000Z" }],
      }),
      data({
        bookmarks: [{ chapter: 2, verse: 2 }],
        favorites: [91],
        highlights: [{ chapter: 3, verse: 3, color: "pink" }],
        notes: [{ chapter: 5, verse: 1, text: "Theirs", date: "2026-10-02T00:00:00.000Z" }],
      })
    );
    expect(out.bookmarks).toEqual([
      { chapter: 1, verse: 1 },
      { chapter: 2, verse: 2 },
    ]);
    expect(out.favorites).toEqual([23, 91]);
    expect(out.highlights).toEqual([{ chapter: 3, verse: 3, color: "pink" }]);
    expect(out.notes[0].text).toBe("Mine\n\nTheirs");
    expect(out.notes[0].date).toBe("2026-10-02T00:00:00.000Z");
    expect(addedFromCloud).toBe(3);
  });

  it("drops rows the phone app would not accept", () => {
    const { data: out } = mergeBackupData(
      data({ bookmarks: [{ chapter: 0, verse: 1 }, { chapter: 1, verse: 1 }, "junk"] }),
      data({ highlights: [{ chapter: 1, verse: 1, color: "purple" }] })
    );
    expect(out.bookmarks).toEqual([{ chapter: 1, verse: 1 }]);
    expect(out.highlights).toEqual([]);
  });

  it("keeps one history entry per chapter, the later read, newest first, at most 50", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      chapter: i + 1,
      verse: 1,
      date: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const { data: out } = mergeBackupData(data({ history: many }), data({ history: [] }));
    expect(out.history).toHaveLength(50);
    expect(out.history[0].chapter).toBe(60);
  });

  it("carries a streak on when the older one ran up to the newer", () => {
    const { data: out } = mergeBackupData(
      data({ streak: { lastDate: "2026-10-20", count: 1 } }),
      data({ streak: { lastDate: "2026-10-19", count: 6, longestStreak: 6 } })
    );
    expect(out.streak).toEqual({ lastDate: "2026-10-20", count: 7, longestStreak: 7 });
  });

  it("keeps the earliest date of a badge earned on both", () => {
    const { data: out } = mergeBackupData(
      data({ badges: { day1: "2026-10-02T00:00:00.000Z", junk: "not a date" } }),
      data({ badges: { day1: "2026-10-01T00:00:00.000Z", day3: "2026-10-03T00:00:00.000Z" } })
    );
    expect(out.badges).toEqual({
      day1: "2026-10-01T00:00:00.000Z",
      day3: "2026-10-03T00:00:00.000Z",
    });
  });

  it("keeps the challenge with more completed days", () => {
    const { data: out } = mergeBackupData(
      data({ challenges: { a: { completedDays: [0] }, b: { completedDays: [0, 1] } } }),
      data({ challenges: { a: { completedDays: [0, 1, 2] }, c: { completedDays: [] } } })
    );
    expect(out.challenges).toEqual({
      a: { completedDays: [0, 1, 2] },
      b: { completedDays: [0, 1] },
      c: { completedDays: [] },
    });
  });

  it("keeps this browser's copy of the phone's settings", () => {
    const { data: out } = mergeBackupData(
      data({ settings: { fontSize: 20 } }),
      data({ settings: { fontSize: 30 } })
    );
    expect(out.settings).toEqual({ fontSize: 20 });
  });
});

describe("helpers", () => {
  it("joins note texts without repeating either", () => {
    expect(combineNoteText("a", "a b")).toBe("a b");
    expect(combineNoteText("a b", "a")).toBe("a b");
    expect(combineNoteText("a", "b")).toBe("a\n\nb");
  });

  it("compares values whatever their key order", () => {
    expect(same({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
    expect(same(null, undefined)).toBe(false);
  });

  it("knows when nothing was saved", () => {
    expect(isEmptyData(data({ streak: { lastDate: "2026-10-20", count: 1 } }))).toBe(true);
    expect(isEmptyData(data({ history: [{ chapter: 1, verse: 1, date: "2026-10-20" }] }))).toBe(
      false
    );
  });
});
