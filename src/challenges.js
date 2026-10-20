// ─── Reading challenges ───────────────────────────────────────────────────────
// The phone app's six challenges and their rules (services/challengesService.ts):
// the same ids, chapters, icons and translation keys, and the same progress
// record, so a challenge started on the phone carries on here and the other way
// round. One reading counts per local calendar day.
//
// Pure: no storage, no clock and no random numbers of their own. `all` is the
// map of every challenge's progress ({id: progress}); the functions that change
// a challenge edit it in place, as the phone edits the map it has loaded, which
// is exactly what a mutator inside updateCarry() receives. The day and the
// random function are passed in, so tests can pin both.

/**
 * @typedef {object} ChallengeDef
 * @property {string} id
 * @property {number} days
 * @property {number[]} chapters one psalm (1-based) for each day
 * @property {string} icon emoji
 * @property {string} i18nKey name
 * @property {string} i18nDescKey description
 */

/**
 * The phone's progress record. Chapters and verses are 1-based, dates are
 * 'YYYY-MM-DD' local days.
 * @typedef {object} ChallengeProgress
 * @property {string} startDate
 * @property {number} notifHour
 * @property {number} notifMinute
 * @property {Array<{chapter: number, verseNumber: number}>} dayAssignments one verse for each day
 * @property {number[]} completedDays 0-based day numbers that are done
 * @property {string} [lastCompletedDate] when the latest day was marked read
 * @property {boolean} completed
 * @property {string} [completedDate]
 */

/** @type {ChallengeDef[]} */
export const CHALLENGE_DEFS = [
  {
    id: "jesus_testing",
    days: 40,
    chapters: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    ],
    icon: "✝️",
    i18nKey: "challenge_jesus_testing",
    i18nDescKey: "challenge_jesus_testing_desc",
  },
  {
    id: "fasting",
    days: 21,
    chapters: [
      51, 32, 42, 43, 46, 63, 84, 91, 103, 130, 143, 22, 23, 27, 31, 34, 37, 40, 62, 86, 25,
    ],
    icon: "🙏",
    i18nKey: "challenge_fasting",
    i18nDescKey: "challenge_fasting_desc",
  },
  {
    id: "david_hiding",
    days: 7,
    chapters: [57, 142, 54, 52, 34, 56, 63],
    icon: "🏔️",
    i18nKey: "challenge_david_hiding",
    i18nDescKey: "challenge_david_hiding_desc",
  },
  {
    id: "birth_of_jesus",
    days: 12,
    chapters: [2, 8, 19, 22, 24, 45, 72, 89, 98, 110, 118, 132],
    icon: "⭐",
    i18nKey: "challenge_birth",
    i18nDescKey: "challenge_birth_desc",
  },
  {
    id: "trust_in_god",
    days: 30,
    chapters: [
      23, 46, 91, 121, 27, 62, 37, 40, 34, 84, 63, 71, 125, 131, 112, 111, 128, 16, 18, 3, 4, 11,
      17, 20, 25, 31, 36, 52, 55, 61,
    ],
    icon: "🕊️",
    i18nKey: "challenge_trust",
    i18nDescKey: "challenge_trust_desc",
  },
  {
    id: "praise_journey",
    days: 7,
    chapters: [100, 103, 104, 107, 145, 146, 150],
    icon: "🎵",
    i18nKey: "challenge_praise",
    i18nDescKey: "challenge_praise_desc",
  },
];

const isWholeNumberIn = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max;

/**
 * Starts a challenge, or starts it again: one random verse is chosen for each
 * day now, so the verse for a day never changes while the challenge runs.
 *
 * @param {Record<string, ChallengeProgress>} all every challenge's progress; edited in place
 * @param {string} id
 * @param {string[][]} data the chosen version's text, chapter by chapter
 * @param {{hour: number, minute: number}} time the reminder time the phone records
 * @param {string} todayKey today's local 'YYYY-MM-DD'
 * @param {() => number} [random] like Math.random
 * @returns {ChallengeProgress} the new progress, also stored in `all[id]`
 */
export function startChallenge(all, id, data, { hour, minute }, todayKey, random = Math.random) {
  const def = CHALLENGE_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown challenge: ${id}`);

  const dayAssignments = def.chapters.map((chapter) => {
    const verses = data[chapter - 1];
    // A psalm the version lacks still gets a verse number (1), as on the phone.
    const verseNumber =
      Array.isArray(verses) && verses.length > 0 ? Math.floor(random() * verses.length) + 1 : 1;
    return { chapter, verseNumber };
  });

  const progress = {
    startDate: todayKey,
    notifHour: hour,
    notifMinute: minute,
    dayAssignments,
    completedDays: [],
    completed: false,
  };
  all[id] = progress;
  return progress;
}

/**
 * The first day (0-based) not yet done, or -1 when every day is.
 * @param {ChallengeProgress} progress
 */
export function getNextDayIndex(progress) {
  const total = progress.dayAssignments.length;
  for (let i = 0; i < total; i++) {
    if (!progress.completedDays.includes(i)) return i;
  }
  return -1;
}

/**
 * Whether a day may be marked read today: false once one was marked today.
 * @param {ChallengeProgress} progress
 * @param {string} todayKey today's local 'YYYY-MM-DD'
 */
export function canReadToday(progress, todayKey) {
  if (!progress.lastCompletedDate) return true;
  return progress.lastCompletedDate !== todayKey;
}

/**
 * Marks a day (0-based) as read, one day per local calendar day. Edits `all` in
 * place unless the day is blocked.
 *
 * @param {Record<string, ChallengeProgress>} all
 * @param {string} id
 * @param {number} dayIndex
 * @param {string} todayKey today's local 'YYYY-MM-DD'
 * @returns {{blocked: true} | {blocked: false, completedDayIndex: number, daysLeft: number, challengeJustCompleted: boolean}}
 * @throws when the challenge was not started or the day is not one of its days
 */
export function markDayComplete(all, id, dayIndex, todayKey) {
  const progress = all[id];
  if (!progress) throw new Error("Challenge not started");

  // An out-of-range day would be added to completedDays and inflate the count for
  // good, so the challenge could finish with real days still unread.
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= progress.dayAssignments.length) {
    throw new Error(`Day index ${dayIndex} is out of range for challenge ${id}`);
  }

  if (!canReadToday(progress, todayKey)) return { blocked: true };

  if (!progress.completedDays.includes(dayIndex)) {
    progress.completedDays = [...progress.completedDays, dayIndex];
  }
  progress.lastCompletedDate = todayKey;

  const daysLeft = progress.dayAssignments.length - progress.completedDays.length;
  const challengeJustCompleted = daysLeft === 0;
  if (challengeJustCompleted) {
    progress.completed = true;
    progress.completedDate = todayKey;
  }

  return { blocked: false, completedDayIndex: dayIndex, daysLeft, challengeJustCompleted };
}

/**
 * Forgets a challenge's progress, so it can be started again. Edits `all` in place.
 * @param {Record<string, ChallengeProgress>} all
 * @param {string} id
 */
export function resetChallenge(all, id) {
  delete all[id];
}

/**
 * The reminder time new challenges record, from the phone's settings: its
 * notificationHour and notificationMinute, each falling back to its part of 8:00
 * when missing or not a real time. The extension sends no reminders; the time is
 * kept so the phone shows the challenge as the reader set it up.
 *
 * @param {{notificationHour?: number, notificationMinute?: number}} [phoneSettings]
 * @returns {{hour: number, minute: number}}
 */
export function reminderTime(phoneSettings) {
  const { notificationHour, notificationMinute } = phoneSettings ?? {};
  return {
    hour: isWholeNumberIn(notificationHour, 0, 23) ? notificationHour : 8,
    minute: isWholeNumberIn(notificationMinute, 0, 59) ? notificationMinute : 0,
  };
}

/**
 * Whether a stored value is a progress record the screens can read without
 * failing. Anything else is shown as a challenge not started.
 * @param {unknown} value
 */
export function isChallengeProgress(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(value.dayAssignments) &&
    Array.isArray(value.completedDays)
  );
}
