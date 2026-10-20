// ─── Badges ───────────────────────────────────────────────────────────────────
// The phone app's nine streak badges (services/badgesService.ts), with the same
// ids, thresholds, icons and translation keys, so that badges earned on the
// phone and here are the same badges and sync as one set. The icons are the
// phone's emoji, shown as text.
//
// Pure: the caller supplies the badges already earned, the streak and the time
// to record, and saves what comes back.

/**
 * @typedef {object} BadgeDef
 * @property {string} id
 * @property {number} requiredDays streak length that earns it
 * @property {string} icon emoji
 * @property {string} i18nKey name
 * @property {string} i18nDescKey description
 */

/** @type {BadgeDef[]} */
export const BADGE_DEFS = [
  {
    id: "day1",
    requiredDays: 1,
    icon: "🌱",
    i18nKey: "badge_day1",
    i18nDescKey: "badge_day1_desc",
  },
  {
    id: "day3",
    requiredDays: 3,
    icon: "🔥",
    i18nKey: "badge_day3",
    i18nDescKey: "badge_day3_desc",
  },
  {
    id: "day7",
    requiredDays: 7,
    icon: "⭐",
    i18nKey: "badge_day7",
    i18nDescKey: "badge_day7_desc",
  },
  {
    id: "day30",
    requiredDays: 30,
    icon: "🏅",
    i18nKey: "badge_day30",
    i18nDescKey: "badge_day30_desc",
  },
  {
    id: "day90",
    requiredDays: 90,
    icon: "🥈",
    i18nKey: "badge_day90",
    i18nDescKey: "badge_day90_desc",
  },
  {
    id: "day100",
    requiredDays: 100,
    icon: "💯",
    i18nKey: "badge_day100",
    i18nDescKey: "badge_day100_desc",
  },
  {
    id: "day180",
    requiredDays: 180,
    icon: "🥇",
    i18nKey: "badge_day180",
    i18nDescKey: "badge_day180_desc",
  },
  {
    id: "day200",
    requiredDays: 200,
    icon: "💎",
    i18nKey: "badge_day200",
    i18nDescKey: "badge_day200_desc",
  },
  {
    id: "day365",
    requiredDays: 365,
    icon: "👑",
    i18nKey: "badge_day365",
    i18nDescKey: "badge_day365_desc",
  },
];

/**
 * Awards every badge the streak has reached that is not earned yet: the phone's
 * checkAndAwardBadges. A badge is awarded once, with the ISO time it was first
 * earned, and is never taken back when the streak falls.
 *
 * @param {Record<string, string>} earned badge id → ISO time earned
 * @param {number} streak the streak just reached
 * @param {string} nowIso recorded for each badge awarded now
 * @returns {{earned: Record<string, string>, newly: BadgeDef[]}} a new record, and the badges just awarded
 */
export function awardBadges(earned, streak, nowIso) {
  const next = { ...earned };
  const newly = [];
  for (const badge of BADGE_DEFS) {
    if (streak >= badge.requiredDays && !next[badge.id]) {
      next[badge.id] = nowIso;
      newly.push(badge);
    }
  }
  return { earned: next, newly };
}
