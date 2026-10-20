// ─── The phone app's data ─────────────────────────────────────────────────────
// Highlights, favourite chapters, streak, badges and challenges arrive from
// the Psalms Way phone app through cloud sync and live in `store.carry` in
// the phone's own shapes (1-based chapters and verses, ISO dates), which is
// what sync uploads. Every read and write of them goes through this module,
// so those shapes are kept in one place.

import { updateStore } from "./storage.js";

/** The phone app's highlight colours, in its order. */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const list = (value) => (Array.isArray(value) ? value : []);
const carryOf = (store) => (isRecord(store?.carry) ? store.carry : {});
const isAt = (row, chapterIndex, verseIndex) =>
  isRecord(row) && row.chapter === chapterIndex + 1 && row.verse === verseIndex + 1;

/** Applies `mutator` to the carry slot of a fresh draft and saves it. Returns the new store. */
export function updateCarry(mutator) {
  return updateStore((draft) => {
    draft.carry = isRecord(draft.carry) ? draft.carry : {};
    mutator(draft.carry);
    return draft;
  });
}

// ─── Highlights ───────────────────────────────────────────────────────────────

/** [{chapter, verse, color}] as the phone stores them. */
export function getHighlights(store) {
  return list(carryOf(store).highlights);
}

export function highlightOf(store, chapterIndex, verseIndex) {
  const row = getHighlights(store).find((h) => isAt(h, chapterIndex, verseIndex));
  return row && HIGHLIGHT_COLORS.includes(row.color) ? row.color : null;
}

/**
 * Sets or removes (color null) a verse's highlight. Like the phone, an
 * existing highlight changes colour in place and a new one is appended.
 */
export function setHighlight(chapterIndex, verseIndex, color) {
  if (color !== null && !HIGHLIGHT_COLORS.includes(color)) {
    return Promise.reject(new Error(`Unknown highlight colour: ${color}`));
  }
  return updateCarry((carry) => {
    const rows = list(carry.highlights);
    const at = rows.findIndex((h) => isAt(h, chapterIndex, verseIndex));
    if (color === null) {
      carry.highlights = rows.filter((_, i) => i !== at);
      return;
    }
    const row = { chapter: chapterIndex + 1, verse: verseIndex + 1, color };
    carry.highlights = at >= 0 ? rows.map((h, i) => (i === at ? row : h)) : [...rows, row];
  });
}

// ─── Favourite chapters ───────────────────────────────────────────────────────

/** Chapter numbers (1-based), newest first, as the phone stores them. */
export function getFavoriteChapters(store) {
  return list(carryOf(store).favorites).filter((c) => Number.isInteger(c));
}

export function isFavoriteChapter(store, chapterIndex) {
  return getFavoriteChapters(store).includes(chapterIndex + 1);
}

/** Adds (at the front, like the phone) or removes a chapter. Returns whether it is now a favourite. */
export async function toggleFavoriteChapter(chapterIndex) {
  const chapter = chapterIndex + 1;
  let nowFavourite = false;
  await updateCarry((carry) => {
    const rows = list(carry.favorites);
    nowFavourite = !rows.includes(chapter);
    carry.favorites = nowFavourite ? [chapter, ...rows] : rows.filter((c) => c !== chapter);
  });
  return nowFavourite;
}

// ─── Streak, badges, challenges, settings ─────────────────────────────────────

/** {lastDate, count, longestStreak?} or null when there is none yet. */
export function getStreakData(store) {
  const streak = carryOf(store).streak;
  return isRecord(streak) && typeof streak.lastDate === "string" && Number.isFinite(streak.count)
    ? streak
    : null;
}

/** {badgeId: ISO date earned}. */
export function getEarnedBadges(store) {
  const badges = carryOf(store).badges;
  return isRecord(badges) ? badges : {};
}

/** {challengeId: progress} in the phone's shape. */
export function getChallengeProgress(store) {
  const challenges = carryOf(store).challenges;
  return isRecord(challenges) ? challenges : {};
}

/** The phone app's own settings (read only here). */
export function getPhoneSettings(store) {
  const settings = carryOf(store).settings;
  return isRecord(settings) ? settings : {};
}
