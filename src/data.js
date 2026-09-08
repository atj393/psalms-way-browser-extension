// ─── Psalm data access ────────────────────────────────────────────────────────
// Loads the bundled text once per popup session and exposes reference
// formatting and range checks. Everything here is offline: `psalms.json` ships
// inside the extension package.

export const CHAPTER_COUNT = 150;
const DATA_FILE_PATH = "psalms.json";

/** Raised when the bundled text cannot be read or is structurally wrong. */
export class DataError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "DataError";
    this.cause = cause;
  }
}

let cache = null;

/**
 * Load and validate the bundled Psalms.
 * Cached for the lifetime of the popup; the popup is destroyed on close, so
 * this is at most one fetch per open.
 *
 * @returns {Promise<string[][]>}
 */
export async function getData() {
  if (cache) return cache;

  let parsed;
  try {
    const response = await fetch(DATA_FILE_PATH);
    if (!response.ok) {
      throw new DataError(`psalms.json responded ${response.status}`);
    }
    parsed = await response.json();
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw new DataError("The Psalms text could not be loaded.", error);
  }

  if (!Array.isArray(parsed) || parsed.length !== CHAPTER_COUNT) {
    throw new DataError("The Psalms text is not in the expected format.");
  }

  cache = parsed;
  return cache;
}

/** Test seam: drop the in-memory cache. */
export function resetDataCache() {
  cache = null;
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
