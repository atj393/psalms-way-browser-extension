// ─── Reading streak ───────────────────────────────────────────────────────────
// A port of the phone app's services/streakService.ts, so that a streak built
// on the phone carries on here and the other way round. The phone's rules are
// kept exactly: the first open starts a streak at 1, a second open on the same
// local day changes nothing, the next day adds one, any other gap restarts at
// 1, and the longest streak is never lowered.
//
// Pure: no storage and no clock of its own. The caller passes the stored
// {lastDate, count, longestStreak?} and the moment to count, and gets the new
// record back to save.

import { daysBetween, toDateKey } from "./dateKeys.js";

/**
 * The stored streak as the phone reads it: anything unexpected becomes the empty
 * streak or a zero, because a NaN here would show up as "NaN days" on screen.
 */
function readStreak(data) {
  if (typeof data !== "object" || data === null) return { lastDate: "", count: 0 };
  return {
    lastDate: typeof data.lastDate === "string" ? data.lastDate : "",
    count: Number.isFinite(data.count) ? data.count : 0,
    longestStreak: Number.isFinite(data.longestStreak) ? data.longestStreak : undefined,
  };
}

/** The longest streak so far, allowing for records written before the phone stored it. */
function longestWith(stored, newCount) {
  return Math.max(stored.longestStreak ?? stored.count, newCount);
}

/**
 * The streak after opening the app at `now`: the phone's checkAndUpdateStreak.
 * Returns a new record; the one given is never changed.
 *
 * @param {{lastDate: string, count: number, longestStreak?: number} | null} data stored streak
 * @param {Date} [now]
 * @returns {{lastDate: string, count: number, longestStreak: number}}
 */
export function nextStreak(data, now = new Date()) {
  const stored = readStreak(data);
  const today = toDateKey(now);

  // First ever open.
  if (!stored.lastDate) return { lastDate: today, count: 1, longestStreak: 1 };

  const gap = daysBetween(stored.lastDate, today);

  // An unreadable stored date cannot be trusted, so the streak restarts.
  if (gap === null) return { lastDate: today, count: 1, longestStreak: longestWith(stored, 1) };

  // Already opened today. Like the phone, only fill in a missing longest streak.
  if (gap === 0) {
    return {
      lastDate: stored.lastDate,
      count: stored.count,
      longestStreak: stored.longestStreak ?? stored.count,
    };
  }

  // The next day.
  if (gap === 1) {
    const count = stored.count + 1;
    return { lastDate: today, count, longestStreak: longestWith(stored, count) };
  }

  // A missed day (or a last date ahead of the clock): start again.
  return { lastDate: today, count: 1, longestStreak: longestWith(stored, 1) };
}

/**
 * The streak to show at `now`: the phone's getStreak. A streak whose last day
 * was before yesterday has lapsed and counts as 0, even though the stored count
 * stays until the next visit restarts it.
 *
 * @param {{lastDate: string, count: number} | null} data stored streak
 * @param {Date} [now]
 */
export function currentStreak(data, now = new Date()) {
  const stored = readStreak(data);
  if (!stored.lastDate) return 0;
  const gap = daysBetween(stored.lastDate, toDateKey(now));
  if (gap === null) return 0;
  return gap <= 1 ? stored.count : 0;
}

/**
 * Whether a local day lies inside the streak run on record: the `count` days
 * ending on `lastDate`. A day opened a second time in the same chapter leaves
 * no trace in the reading history (one entry per chapter), but it is a day of
 * the run, so the last-seven-days dots count it too.
 *
 * @param {{lastDate: string, count: number} | null} data stored streak
 * @param {string} dateKey a local 'YYYY-MM-DD'
 */
export function inStreakRun(data, dateKey) {
  const { lastDate, count } = readStreak(data);
  const back = daysBetween(dateKey, lastDate);
  return back !== null && back >= 0 && back < count;
}

/** The longest streak the reader has had: the phone's getLongestStreak. */
export function longestStreak(data) {
  const stored = readStreak(data);
  return stored.longestStreak ?? stored.count;
}
