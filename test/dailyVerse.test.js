import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { hashString, getVerseForDate } from "../src/dailyVerse.js";

// The bundled NIV, which the extension calls `modern`.
const niv = JSON.parse(readFileSync(new URL("../psalms.json", import.meta.url), "utf8"));

// The verse of the day depends on the version's chapter lengths and nothing
// else, so the KJV vectors are checked against its 150 verse counts (taken from
// the phone app's psalms-en-kjv.json) with placeholder text, rather than
// copying a second licensed text into this repository.
const KJV_VERSE_COUNTS = [
  6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14,
  9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6,
  7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72,
  13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35,
  45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18,
  3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6,
];
const kjv = KJV_VERSE_COUNTS.map((count, c) =>
  Array.from({ length: count }, (_, v) => `kjv ${c + 1}:${v + 1}`)
);

const chapters = (count, verses) => Array.from({ length: count }, () => [...verses]);

describe("hashString", () => {
  it("matches the phone app's FNV-1a vectors", () => {
    expect(hashString("2026-10-20|modern")).toBe(3818330699);
    expect(hashString("2026-09-08|kjv")).toBe(2184820137);
  });

  it("hashes the empty string to the FNV offset basis", () => {
    expect(hashString("")).toBe(2166136261);
  });

  it("is deterministic and always an unsigned 32-bit integer", () => {
    for (const key of ["a", "2027-01-01|kjv", "2026-12-25|modern|95", "psalm — ünïcode"]) {
      const first = hashString(key);
      expect(hashString(key)).toBe(first);
      expect(Number.isInteger(first)).toBe(true);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("getVerseForDate", () => {
  it.each([
    ["2026-10-20", 150, 6],
    ["2026-12-25", 95, 1],
    ["2027-01-01", 106, 23],
  ])("picks the phone's NIV verse for %s: Psalm %i:%i", (dateKey, chapter, verseNumber) => {
    expect(getVerseForDate(dateKey, "modern", niv)).toEqual({
      chapter,
      verseNumber,
      verse: niv[chapter - 1][verseNumber - 1],
    });
  });

  it.each([
    ["2026-10-20", 48, 12],
    ["2026-12-25", 37, 23],
    ["2027-01-01", 66, 4],
  ])("picks the phone's KJV verse for %s: Psalm %i:%i", (dateKey, chapter, verseNumber) => {
    expect(getVerseForDate(dateKey, "kjv", kjv)).toEqual({
      chapter,
      verseNumber,
      verse: `kjv ${chapter}:${verseNumber}`,
    });
  });

  it("gives the same verse for the same day and version, and not the same for every day", () => {
    const a = getVerseForDate("2026-10-20", "modern", niv);
    expect(getVerseForDate("2026-10-20", "modern", niv)).toEqual(a);
    const picks = new Set();
    for (let day = 1; day <= 28; day++) {
      const { chapter, verseNumber } = getVerseForDate(
        `2026-11-${String(day).padStart(2, "0")}`,
        "modern",
        niv
      );
      picks.add(`${chapter}:${verseNumber}`);
    }
    expect(picks.size).toBeGreaterThan(20);
  });

  it("walks on to the next chapter when the chosen one is empty", () => {
    // 2026-10-20|modern starts at Psalm 150; the next attempt is Psalm 1.
    const data = chapters(150, ["a", "b", "c"]);
    data[149] = [];
    expect(getVerseForDate("2026-10-20", "modern", data)).toEqual({
      chapter: 1,
      verseNumber: 3,
      verse: "c",
    });
  });

  it("walks on when the chosen verse is blank, and does not trim a real one", () => {
    const data = chapters(150, ["a", "b", "c"]);
    data[149] = ["a", "b", "c", "d", "e", "   "];
    expect(getVerseForDate("2026-10-20", "modern", data).chapter).toBe(1);

    data[149] = ["a", "b", "c", "d", "e", "  spaced  "];
    expect(getVerseForDate("2026-10-20", "modern", data)).toEqual({
      chapter: 150,
      verseNumber: 6,
      verse: "  spaced  ",
    });
  });

  it("treats chapters a version lacks as empty", () => {
    // A damaged version file with only 137 psalms: Psalm 150 does not exist.
    const data = chapters(137, ["a", "b", "c"]);
    expect(getVerseForDate("2026-10-20", "modern", data)).toEqual({
      chapter: 1,
      verseNumber: 3,
      verse: "c",
    });
  });

  it("returns null when the version has no readable text at all", () => {
    expect(getVerseForDate("2026-10-20", "modern", chapters(150, []))).toBeNull();
    expect(getVerseForDate("2026-10-20", "modern", chapters(150, ["  "]))).toBeNull();
    expect(getVerseForDate("2026-10-20", "modern", [])).toBeNull();
  });

  it("ignores a chapter that is not a list of verses", () => {
    const data = chapters(150, ["a", "b", "c"]);
    data[149] = null;
    expect(getVerseForDate("2026-10-20", "modern", data).chapter).toBe(1);
  });
});
