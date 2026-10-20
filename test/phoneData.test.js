import { describe, it, expect, beforeEach } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as store from "../src/storage.js";
import {
  getChallengeProgress,
  getEarnedBadges,
  getFavoriteChapters,
  getHighlights,
  getPhoneSettings,
  getStreakData,
  highlightOf,
  isFavoriteChapter,
  setHighlight,
  toggleFavoriteChapter,
  updateCarry,
} from "../src/phoneData.js";

beforeEach(() => {
  store.resetStoreCache();
  installChromeMock({});
});

describe("highlights, in the phone's shape", () => {
  it("adds a highlight with 1-based chapter and verse", async () => {
    const next = await setHighlight(22, 0, "yellow");
    expect(getHighlights(next)).toEqual([{ chapter: 23, verse: 1, color: "yellow" }]);
    expect(highlightOf(next, 22, 0)).toBe("yellow");
    expect(highlightOf(next, 22, 1)).toBeNull();
  });

  it("changes a colour in place and appends new ones, as the phone does", async () => {
    await setHighlight(0, 0, "yellow");
    await setHighlight(1, 1, "green");
    const next = await setHighlight(0, 0, "pink");
    expect(getHighlights(next)).toEqual([
      { chapter: 1, verse: 1, color: "pink" },
      { chapter: 2, verse: 2, color: "green" },
    ]);
  });

  it("removes a highlight with null", async () => {
    await setHighlight(4, 2, "blue");
    const next = await setHighlight(4, 2, null);
    expect(getHighlights(next)).toEqual([]);
  });

  it("refuses an unknown colour and changes nothing", async () => {
    await expect(setHighlight(0, 0, "purple")).rejects.toThrow("Unknown highlight colour");
    expect(getHighlights(await store.loadStore())).toEqual([]);
  });

  it("ignores a stored highlight with a colour the phone does not use", async () => {
    await updateCarry((carry) => {
      carry.highlights = [{ chapter: 1, verse: 1, color: "purple" }];
    });
    expect(highlightOf(await store.loadStore(), 0, 0)).toBeNull();
  });
});

describe("favourite chapters", () => {
  it("adds at the front and removes, like the phone", async () => {
    expect(await toggleFavoriteChapter(22)).toBe(true);
    expect(await toggleFavoriteChapter(90)).toBe(true);
    let current = await store.loadStore();
    expect(getFavoriteChapters(current)).toEqual([91, 23]);
    expect(isFavoriteChapter(current, 22)).toBe(true);
    expect(await toggleFavoriteChapter(22)).toBe(false);
    current = await store.loadStore();
    expect(getFavoriteChapters(current)).toEqual([91]);
  });
});

describe("reading the rest of the phone's data", () => {
  it("returns empty values for a store without any", async () => {
    const empty = await store.loadStore();
    expect(getStreakData(empty)).toBeNull();
    expect(getEarnedBadges(empty)).toEqual({});
    expect(getChallengeProgress(empty)).toEqual({});
    expect(getPhoneSettings(empty)).toEqual({});
    expect(getFavoriteChapters({})).toEqual([]);
  });

  it("returns them as stored", async () => {
    const next = await updateCarry((carry) => {
      carry.streak = { lastDate: "2026-10-20", count: 3, longestStreak: 9 };
      carry.badges = { day1: "2026-10-18T08:00:00.000Z" };
      carry.challenges = { fasting: { completedDays: [0] } };
      carry.settings = { notificationHour: 7 };
    });
    expect(getStreakData(next)).toEqual({ lastDate: "2026-10-20", count: 3, longestStreak: 9 });
    expect(getEarnedBadges(next)).toEqual({ day1: "2026-10-18T08:00:00.000Z" });
    expect(getChallengeProgress(next)).toEqual({ fasting: { completedDays: [0] } });
    expect(getPhoneSettings(next)).toEqual({ notificationHour: 7 });
  });

  it("treats a damaged streak as none", async () => {
    const next = await updateCarry((carry) => {
      carry.streak = { lastDate: 5, count: "x" };
    });
    expect(getStreakData(next)).toBeNull();
  });
});
