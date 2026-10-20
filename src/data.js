// ─── Psalm data access ────────────────────────────────────────────────────────
// The text of the Bible version being read, plus reference formatting and range
// checks. Loading and caching the versions is versions.js's job; everything is
// offline, because every version ships inside the extension package.

import { currentVersion, getVersionData, resetVersions } from "./versions.js";

export const CHAPTER_COUNT = 150;

/** Raised when a version's text cannot be read or is structurally wrong. */
export class DataError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "DataError";
    this.cause = cause;
  }
}

/**
 * The chapters of the current Bible version, each an array of verse strings.
 * 150 chapters for every shipped version. A damaged file could still have an
 * empty or missing chapter, so check `hasChapter()` before rendering one.
 *
 * @returns {Promise<string[][]>}
 */
export function getData() {
  return getVersionData(currentVersion());
}

/** Test seam: forget every loaded version and go back to the NIV. */
export function resetDataCache() {
  resetVersions();
}

/**
 * Is this a real verse in the bundled text?
 * Stored references are validated against this before they are rendered, so a
 * stale or hand-edited entry can never blank the popup.
 */
export function isVerseRef(data, chapterIndex, verseIndex) {
  return (
    Array.isArray(data) &&
    Number.isInteger(chapterIndex) &&
    chapterIndex >= 0 &&
    chapterIndex < data.length &&
    Array.isArray(data[chapterIndex]) &&
    Number.isInteger(verseIndex) &&
    verseIndex >= 0 &&
    verseIndex < data[chapterIndex].length
  );
}

/**
 * Whether a version has text for this chapter (an empty or missing chapter does
 * not count), so the reader can say so instead of showing a blank page.
 */
export function hasChapter(data, chapterIndex) {
  return (
    isChapterRef(data, chapterIndex) &&
    Array.isArray(data[chapterIndex]) &&
    data[chapterIndex].length > 0
  );
}

export function isChapterRef(data, chapterIndex) {
  return (
    Array.isArray(data) &&
    Number.isInteger(chapterIndex) &&
    chapterIndex >= 0 &&
    chapterIndex < data.length
  );
}

/**
 * Format a scripture reference.
 *
 * Singular "Psalm 23:1", not "Psalms 23:1". "Psalms" is the book; an individual
 * chapter is "a Psalm". This matches the companion Android app, which formats
 * references the same way.
 *
 * @param {number} chapterIndex 0-based
 * @param {number|null} [verseIndex] 0-based, omit for a whole chapter
 */
export function formatReference(chapterIndex, verseIndex = null) {
  const chapter = chapterIndex + 1;
  return verseIndex === null || verseIndex === undefined
    ? `Psalm ${chapter}`
    : `Psalm ${chapter}:${verseIndex + 1}`;
}

/** Reference plus text, as copied to the clipboard and written into backups. */
export function formatVerseForCopy(chapterIndex, verseIndex, text) {
  return `${formatReference(chapterIndex, verseIndex)} — ${text}`;
}

export function getRandomChapterIndex(random = Math.random) {
  return Math.floor(random() * CHAPTER_COUNT);
}

export function getRandomVerseIndex(chapterContent, random = Math.random) {
  if (!Array.isArray(chapterContent) || chapterContent.length === 0) return 0;
  return Math.floor(random() * chapterContent.length);
}

/** Clamp-free wrap used by the previous/next chapter controls. */
export function wrapChapter(chapterIndex) {
  return ((chapterIndex % CHAPTER_COUNT) + CHAPTER_COUNT) % CHAPTER_COUNT;
}

/**
 * Parse a user-typed chapter number into a 0-based index.
 * @returns {number|null} null when the input is not a chapter between 1 and 150
 */
export function parseChapterInput(value) {
  const trimmed = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const chapter = Number(trimmed);
  if (chapter < 1 || chapter > CHAPTER_COUNT) return null;
  return chapter - 1;
}
