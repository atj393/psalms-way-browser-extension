// ─── Verse of the day ─────────────────────────────────────────────────────────
// A port of the phone app's services/dailyVerseService.ts. The pick is a pure
// function of the local day and the version, not a random draw, so the phone
// and this extension show the same verse on the same day whenever they read the
// same version, and reopening the popup never changes it. The text is passed in
// instead of read from a service, which keeps this module free of storage and
// network and easy to test.

import { CHAPTER_COUNT } from "./data.js";

/**
 * FNV-1a, 32-bit, exactly as the phone computes it. `>>> 0` keeps the value an
 * unsigned 32-bit integer after the Math.imul multiply.
 *
 * @param {string} input
 * @returns {number}
 */
export function hashString(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The verse of the day for a local day and version.
 *
 * Chapter and verse come from two different hashes so they vary independently.
 * Chapters are tried from the seeded start, so a version with a few empty or
 * missing chapters still resolves. Like the phone, the chosen verse is kept as
 * it is (never trimmed); one that is blank moves the search on to the next
 * chapter. The result keeps the phone's 1-based shape.
 *
 * @param {string} dateKey local day, 'YYYY-MM-DD' (`toDateKey`)
 * @param {string} version version module, such as 'modern' or 'kjv'
 * @param {string[][]} data the version's chapters
 * @returns {{chapter: number, verseNumber: number, verse: string} | null}
 *   null when the version has no readable text at all
 */
export function getVerseForDate(dateKey, version, data) {
  const seed = hashString(`${dateKey}|${version}`);

  for (let attempt = 0; attempt < CHAPTER_COUNT; attempt++) {
    const chapter = ((seed + attempt) % CHAPTER_COUNT) + 1;
    const verses = Array.isArray(data[chapter - 1]) ? data[chapter - 1] : [];
    if (verses.length === 0) continue;

    const verseSeed = hashString(`${dateKey}|${version}|${chapter}`);
    const verseNumber = (verseSeed % verses.length) + 1;
    const verse = verses[verseNumber - 1];
    if (typeof verse !== "string" || verse.trim().length === 0) continue;

    return { chapter, verseNumber, verse };
  }

  return null;
}
