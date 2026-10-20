import { describe, it, expect } from "vitest";
import { defaultStore, normaliseStore } from "../src/storage.js";
import { fromPhoneData, toPhoneData } from "../src/syncModel.js";

/** Data exactly as the phone app writes it. */
const phoneData = {
  bookmarks: [
    { chapter: 23, verse: 1 },
    { chapter: 91, verse: 4 },
  ],
  favorites: [23, 121],
  highlights: [{ chapter: 23, verse: 4, color: "yellow" }],
  notes: [
    {
      chapter: 23,
      verse: 1,
      text: `  A long note written on the phone. ${"x".repeat(3000)}\n`,
      date: "2026-10-18T09:15:00.000Z",
    },
  ],
  history: [
    { chapter: 91, verse: 4, date: "2026-10-20T07:00:00.000Z" },
    { chapter: 23, verse: 1, date: "2026-10-19T07:00:00.000Z" },
  ],
  streak: { lastDate: "2026-10-20", count: 5, longestStreak: 9 },
  badges: { day1: "2026-10-01T08:00:00.000Z" },
  challenges: { psalms30: { completedDays: [0, 1, 2] } },
  settings: { fontSize: 20, themeColor: "green" },
};

describe("converting between this browser and the phone app", () => {
  it("brings the phone's data back out exactly as it went in", () => {
    const store = fromPhoneData(defaultStore(), phoneData);
    expect(toPhoneData(store)).toEqual(phoneData);
  });

  it("survives a storage round trip unchanged too", () => {
    const store = normaliseStore(structuredClone(fromPhoneData(defaultStore(), phoneData)));
    expect(toPhoneData(store)).toEqual(phoneData);
  });

  it("shows the phone's bookmarks, notes and history in this browser's terms", () => {
    const store = fromPhoneData(defaultStore(), phoneData);
    expect(
      store.favourites.map(({ chapterIndex, verseIndex }) => [chapterIndex, verseIndex])
    ).toEqual([
      [22, 0],
      [90, 3],
    ]);
    expect(store.notes[0]).toMatchObject({
      chapterIndex: 22,
      verseIndex: 0,
      updatedAt: Date.parse("2026-10-18T09:15:00.000Z"),
    });
    // The phone's verse 1 is this extension's whole-chapter entry.
    expect(store.history[1]).toEqual({
      chapterIndex: 22,
      verseIndex: null,
      viewedAt: Date.parse("2026-10-19T07:00:00.000Z"),
    });
  });

  it("keeps this browser's own settings and when bookmarks were added here", () => {
    const before = normaliseStore({
      favourites: [{ chapterIndex: 22, verseIndex: 0, addedAt: 1700000000000 }],
      settings: { theme: "dark", fontSize: "large", lang: "en", toolbarCollapsed: true },
    });
    const after = fromPhoneData(before, phoneData);
    expect(after.settings.theme).toBe("dark");
    expect(after.favourites[0].addedAt).toBe(1700000000000);
  });

  it("starts empty-handed safely when the phone's data is missing pieces", () => {
    const store = fromPhoneData(defaultStore(), { bookmarks: "junk" });
    expect(toPhoneData(store)).toEqual({
      bookmarks: [],
      favorites: [],
      highlights: [],
      notes: [],
      history: [],
      streak: null,
      badges: null,
      challenges: null,
      settings: {},
    });
  });
});
