// ─── Date helpers ─────────────────────────────────────────────────────────────
// Pure, dependency-free, and deliberately free of millisecond arithmetic.
//
// The previous implementation computed the day of the year by subtracting two
// Date objects and dividing by 86_400_000. That is wrong twice over:
//
//   1. A local calendar day is not always 86_400_000 ms. On a daylight-saving
//      transition it is 23 or 25 hours, so the division drifted. In
//      Europe/Berlin this made 2026-10-25 show two different Psalms during a
//      single day, made 2026-03-29 and 2026-03-30 show the same Psalm, and
//      skipped Psalm 149 entirely.
//   2. `new Date(y, 0, 0)` is 31 December of the *previous* year, so 1 January
//      produced a day-of-year of 1 and therefore Psalm 2 rather than Psalm 1.
//
// Building both endpoints with Date.UTC() from the *local* year/month/day
// components removes daylight saving from the calculation entirely: UTC days
// are always exactly 86_400_000 ms apart.

import { CHAPTER_COUNT } from "./data.js";

const MS_PER_DAY = 86400000;

/**
 * Day of the year for a local calendar date. 1 January is day 1.
 * Stable for every instant within the same local calendar day.
 *
 * @param {Date} date
 * @returns {number} 1–366
 */
export function dayOfYear(date) {
  const startOfYear = Date.UTC(date.getFullYear(), 0, 1);
  const thisDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((thisDay - startOfYear) / MS_PER_DAY) + 1;
}

/**
 * The chapter index for "Today's Psalm".
 *
 * Maps one local calendar day to exactly one chapter: 1 January is Psalm 1, and
 * the sequence advances by one each day, wrapping after Psalm 150. Two devices
 * in the same time zone on the same date always agree, and nothing is stored.
 *
 * @param {Date} [date]
 * @returns {number} 0-based chapter index
 */
export function getDailyChapterIndex(date = new Date()) {
  return (dayOfYear(date) - 1) % CHAPTER_COUNT;
}

/**
 * Short, human-readable stamp for history rows.
 * Uses the browser's own locale rather than a hard-coded one.
 *
 * @param {number} timestamp epoch milliseconds
 * @param {Date} [now] injectable for tests
 * @returns {string}
 */
export function formatTimestamp(timestamp, now = new Date()) {
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  if (isSameLocalDay(date, now)) return "Today";

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return "Yesterday";

  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
