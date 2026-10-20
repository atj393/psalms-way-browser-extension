// ─── Reading stats ────────────────────────────────────────────────────────────
// The numbers on the phone app's Reading Stats screen (screens/StatsScreen.tsx),
// worked out from this extension's own store: its streak and the last seven
// days, and the reading totals.
//
// Pure: it reads a store object and the moment to count from, and touches
// neither storage nor the page.

import { addDays, parseDateKey, toDateKey } from "./dateKeys.js";
import { getFavoriteChapters, getHighlights } from "./phoneData.js";
import { currentStreak, inStreakRun, longestStreak } from "./streak.js";

/**
 * The seven local days ending today, oldest first, each marked read or not. A
 * day is read when the history has an entry on it or it lies inside the streak
 * run: history keeps only the latest entry of each chapter, so a day on which
 * an already-read chapter was opened again would otherwise show as unread.
 */
function lastSevenDays(history, streakData, now) {
  const historyDays = new Set(history.map((entry) => toDateKey(new Date(entry.viewedAt))));
  const today = toDateKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const dateKey = addDays(today, i - 6);
    return {
      dateKey,
      weekday: parseDateKey(dateKey).getDay(),
      read: historyDays.has(dateKey) || inStreakRun(streakData, dateKey),
    };
  });
}

/**
 * Everything the stats section shows.
 *
 * @param {object} store the extension's store: history, favourites (verse
 *   bookmarks), notes, and carry (the phone's data)
 * @param {Date} [now]
 * @returns {{
 *   streak: number, longestStreak: number,
 *   week: Array<{dateKey: string, weekday: number, read: boolean}>,
 *   chaptersRead: number,
 *   bookmarks: number, highlights: number, notes: number, favourites: number
 * }}
 */
export function computeStats(store, now = new Date()) {
  // The streak record goes to the streak functions as stored: they read it the way
  // the phone does, so a damaged count does not cost the reader their longest streak.
  const streakData = store.carry?.streak;
  return {
    streak: currentStreak(streakData, now),
    longestStreak: longestStreak(streakData),
    week: lastSevenDays(store.history, streakData, now),
    chaptersRead: new Set(store.history.map((entry) => entry.chapterIndex)).size,
    bookmarks: store.favourites.length,
    highlights: getHighlights(store).length,
    notes: store.notes.length,
    favourites: getFavoriteChapters(store).length,
  };
}
