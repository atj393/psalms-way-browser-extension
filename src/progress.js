// ─── Progress ─────────────────────────────────────────────────────────────────
// The Progress panel: the reader's streak and reading stats, the phone app's
// nine streak badges and six reading challenges, and a view for one challenge.
// The rules are the phone's own (streak.js, badges.js, challenges.js) and the
// data is the phone's own, kept in the sync carry slot through phoneData.js, so
// the phone and the browser agree and a streak or a challenge carries on from
// one to the other. This module is the storage and the screen around that logic.
//
// recordVisit() runs once each time the popup opens; renderProgress() runs when
// the Progress button is pressed. The popup is destroyed on close, so the only
// state kept here is what the screen needs while it is open.

import { byId, confirmDialog, el, reportError, toast } from "./dom.js";
import { CHAPTER_COUNT } from "./data.js";
import { parseDateKey, toDateKey } from "./dateKeys.js";
import { icon } from "./icons.js";
import { currentLanguage, t } from "./i18n.js";
import {
  getChallengeProgress,
  getEarnedBadges,
  getPhoneSettings,
  updateCarry,
} from "./phoneData.js";
import { loadStore } from "./storage.js";
import { same } from "./syncMerge.js";
import { currentVersion, getVersionData, loadCatalogue } from "./versions.js";
import { BADGE_DEFS, awardBadges } from "./badges.js";
import {
  CHALLENGE_DEFS,
  canReadToday,
  getNextDayIndex,
  isChallengeProgress,
  markDayComplete,
  reminderTime,
  resetChallenge,
  startChallenge,
} from "./challenges.js";
import { computeStats } from "./stats.js";
import { nextStreak } from "./streak.js";

// ─── Recording a visit ────────────────────────────────────────────────────────

/**
 * The streak and badges after a visit at `now`, from the phone's data in `carry`.
 * The streak record is passed on as stored: nextStreak reads it as the phone does,
 * so a damaged count does not cost the reader their longest streak.
 */
function visitAt(carry, now) {
  const streak = nextStreak(carry.streak, now);
  const { earned, newly } = awardBadges(
    getEarnedBadges({ carry }),
    streak.count,
    now.toISOString()
  );
  return { streak, earned, newly };
}

/**
 * Counts today's visit: moves the streak on and awards the badges it earns, in
 * one write. Called once each time the popup opens, so nothing is written on the
 * later opens of a day, when nothing changes.
 *
 * @param {Date} [now]
 * @returns {Promise<import("./badges.js").BadgeDef[]>} the badges earned by this visit
 */
export async function recordVisit(now = new Date()) {
  const before = await loadStore();
  const preview = visitAt(before.carry, now);
  if (same(preview.streak, before.carry.streak) && preview.newly.length === 0) return [];

  let newly = [];
  await updateCarry((carry) => {
    // Worked out again from the carry being saved, in case it changed since it was read.
    const visit = visitAt(carry, now);
    carry.streak = visit.streak;
    carry.badges = visit.earned;
    newly = visit.newly;
  });
  return newly;
}

// ─── The panel ────────────────────────────────────────────────────────────────

let navigateTo = () => {};
/** How far the overview was scrolled when a challenge was opened, to return to it. */
let overviewScroll = 0;

const classes = (...names) => names.filter(Boolean).join(" ");

function formatDay(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(currentLanguage(), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function progressBar(done, total, label) {
  return el("progress", { class: "progress-bar", max: total, value: done, "aria-label": label });
}

function emoji(className, glyph) {
  return el("span", { class: className, text: glyph, "aria-hidden": "true" });
}

/**
 * A click handler for a button that does something slow or that can fail: the
 * button is off while it runs, and a failure is shown to the reader, never swallowed.
 * A disabled button cannot hold focus, and cannot be given it back (the confirmation
 * dialog tries on Cancel), so focus returns to the button once it is on again, unless
 * the action redrew the panel and the button is gone.
 */
function action(run) {
  return async (event) => {
    const button = event.currentTarget;
    const hadFocus = document.activeElement === button;
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      reportError(error, t("progressActionFailed", {}, "That could not be completed."));
    } finally {
      button.disabled = false;
      if (hadFocus && button.isConnected) button.focus();
    }
  };
}

// Wording used in more than one place.
const chaptersDone = (done, total) =>
  t("challengeProgress", { done, total }, "{{done}} / {{total}} chapters");
const daysCount = (count) => t("challengeDays", { count }, "{{count}} days");
const challengeCompleteText = () => t("challengeAllDone", {}, "Challenge Complete! 🎉");

/**
 * Paints the panel with the overview: streak and stats, badges, challenges.
 * @param {{ navigate: (target: {chapterIndex: number, verseIndex?: number|null}) => unknown }} options
 */
export async function renderProgress({ navigate }) {
  navigateTo = navigate;
  await showOverview();
}

async function showOverview(returnToChallenge = null) {
  const body = byId("progressBody");
  if (!body) return;
  const store = await loadStore();
  const stats = computeStats(store, new Date());

  body.replaceChildren(
    el("div", { class: "progress" }, [
      statsSection(stats),
      badgesSection(getEarnedBadges(store)),
      challengesSection(getChallengeProgress(store)),
    ])
  );
  body.scrollTop = returnToChallenge ? overviewScroll : 0;
  if (returnToChallenge) body.querySelector(`[data-challenge="${returnToChallenge}"]`)?.focus();
}

function section(headingId, title, children, count = "") {
  return el("section", { class: "progress-section", "aria-labelledby": headingId }, [
    el("div", { class: "progress-section-head" }, [
      el("h3", { class: "progress-heading", id: headingId, text: title }),
      count ? el("span", { class: "progress-count", text: count }) : null,
    ]),
    ...children,
  ]);
}

// ─── Streak and stats ─────────────────────────────────────────────────────────

function statsSection(stats) {
  return section("progressStatsHeading", t("statsTitle", {}, "Reading Stats"), [
    streakCard(stats),
    weekCard(stats),
    totalsCard(stats),
  ]);
}

function cardTitle(text) {
  return el("h4", { class: "progress-card-title", text });
}

function streakCard({ streak, longestStreak }) {
  return el("div", { class: "progress-card progress-streak" }, [
    el("span", { class: "progress-streak-icon" }, [icon("progress", { size: 22 })]),
    el("div", {}, [
      el("p", { class: "progress-streak-line" }, [
        el("span", { class: "progress-streak-number", text: String(streak) }),
        el("span", { class: "progress-streak-label", text: t("statsDayStreak", {}, "day streak") }),
      ]),
      el("p", {
        class: "progress-streak-longest",
        text: t("statsLongestStreak", { count: longestStreak }, "Longest streak: {{count}} days"),
      }),
    ]),
  ]);
}

function weekCard({ week }) {
  const labels = t("daysShort", {}, "Sun_Mon_Tue_Wed_Thu_Fri_Sat").split("_");
  const days = week.map((day, i) => {
    const isToday = i === week.length - 1;
    return el(
      "li",
      {
        class: classes("progress-day", day.read && "is-read", isToday && "is-today"),
        "aria-current": isToday ? "date" : null,
      },
      [
        el("span", { class: "progress-day-dot" }, day.read ? [icon("check", { size: 14 })] : []),
        el("span", { class: "progress-day-label", text: labels[day.weekday] ?? "" }),
        el("span", {
          class: "sr-only",
          text: day.read ? t("statsDayRead", {}, "Read") : t("statsDayNotRead", {}, "No reading"),
        }),
      ]
    );
  });
  return el("div", { class: "progress-card" }, [
    cardTitle(t("statsLast7Days", {}, "LAST 7 DAYS")),
    el("ol", { class: "progress-week" }, days),
  ]);
}

function totalsCard(stats) {
  const rows = [
    [t("statsChaptersRead", {}, "Chapters read (unique)"), stats.chaptersRead],
    [t("statBookmarks", {}, "Bookmarks"), stats.bookmarks],
    [t("statHighlights", {}, "Highlights"), stats.highlights],
    [t("statNotes", {}, "Notes"), stats.notes],
    [t("statFavorites", {}, "Favourites"), stats.favourites],
  ];
  return el("div", { class: "progress-card" }, [
    cardTitle(t("statsReadingTotals", {}, "READING TOTALS")),
    el(
      "dl",
      { class: "progress-totals" },
      rows.map(([label, value]) =>
        el("div", { class: "progress-total-row" }, [
          el("dt", { text: label }),
          el("dd", { text: String(value) }),
        ])
      )
    ),
  ]);
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function badgesSection(earned) {
  const earnedCount = BADGE_DEFS.filter((def) => earned[def.id]).length;
  const tiles = BADGE_DEFS.map((def) => {
    const when = earned[def.id] ? formatDay(new Date(earned[def.id])) : "";
    const name = t(def.i18nKey);
    const description = t(def.i18nDescKey);
    return el(
      "li",
      {
        class: classes("progress-badge", earned[def.id] ? "is-earned" : "is-locked"),
        title: description,
      },
      [
        emoji("progress-badge-emoji", def.icon),
        el("span", { class: "progress-badge-name", text: name }),
        // A locked badge says what earns it; an earned one says when it was earned.
        el("span", { class: "progress-badge-note", text: when || description }),
        el("span", {
          class: "sr-only",
          text: earned[def.id] ? t("badgesEarned", {}, "Earned") : t("badgesLocked", {}, "Locked"),
        }),
      ]
    );
  });
  return section(
    "progressBadgesHeading",
    t("badges", {}, "Badges"),
    [el("ul", { class: "progress-badges" }, tiles)],
    `${earnedCount}/${BADGE_DEFS.length}`
  );
}

// ─── Challenges ───────────────────────────────────────────────────────────────

function challengesSection(all) {
  const cards = CHALLENGE_DEFS.map((def) => el("li", {}, [challengeCard(def, all[def.id])]));
  return section("progressChallengesHeading", t("challenges", {}, "Challenges"), [
    el("ul", { class: "progress-challenges" }, cards),
  ]);
}

function challengeCard(def, stored) {
  const progress = isChallengeProgress(stored) ? stored : null;
  const total = def.chapters.length;
  const done = progress?.completedDays.length ?? 0;
  const finished = progress?.completed === true;
  const started = progress !== null && !finished;
  const next = started ? getNextDayIndex(progress) : -1;

  let status = null;
  if (finished) status = t("challengeCompleted", {}, "Completed!");
  else if (next >= 0)
    status = t("challengeDay", { day: next + 1, total }, "Day {{day}} of {{total}}");
  const caption = chaptersDone(done, total);

  return el(
    "button",
    {
      type: "button",
      class: classes("progress-challenge", started && "is-started", finished && "is-done"),
      dataset: { challenge: def.id },
      onClick: action(() => openChallenge(def.id)),
    },
    [
      emoji("progress-challenge-emoji", def.icon),
      el("span", { class: "progress-challenge-text" }, [
        el("span", { class: "progress-challenge-name", text: t(def.i18nKey) }),
        el("span", { class: "progress-challenge-meta" }, [
          daysCount(def.days),
          status ? " · " : null,
          status ? el("span", { class: "progress-challenge-status", text: status }) : null,
        ]),
        progress ? progressBar(done, total, caption) : null,
        progress ? el("span", { class: "progress-challenge-meta", text: caption }) : null,
      ]),
      finished ? icon("check", { size: 18 }) : icon("chevronRight", { size: 16 }),
    ]
  );
}

// ─── One challenge ────────────────────────────────────────────────────────────

/** A day's verse as the phone stores it (1-based), or null if the record is damaged. */
function readableAssignment(assignment) {
  return typeof assignment === "object" &&
    assignment !== null &&
    Number.isInteger(assignment.chapter) &&
    assignment.chapter >= 1 &&
    assignment.chapter <= CHAPTER_COUNT &&
    Number.isInteger(assignment.verseNumber) &&
    assignment.verseNumber >= 1
    ? assignment
    : null;
}

async function openChallenge(id) {
  overviewScroll = byId("progressBody").scrollTop;
  await showChallenge(id, await loadStore());
  byId("progressBody").scrollTop = 0;
}

/**
 * The text of a day's verse in the version being read, and which way it runs. If the
 * version cannot be read the failure is shown and the text is left out, so the
 * challenge still opens and can be marked, read elsewhere or reset.
 */
async function loadVerse({ chapter, verseNumber }) {
  try {
    const module = currentVersion();
    const [data, catalogue] = await Promise.all([getVersionData(module), loadCatalogue()]);
    return {
      text: data[chapter - 1]?.[verseNumber - 1] ?? null,
      rtl: catalogue.find((version) => version.module === module)?.rtl === true,
    };
  } catch (error) {
    reportError(error, t("challengeVerseFailed", {}, "Today's verse could not be loaded."));
    return { text: null, rtl: false };
  }
}

async function showChallenge(id, store) {
  const body = byId("progressBody");
  const def = CHALLENGE_DEFS.find((d) => d.id === id);
  const stored = getChallengeProgress(store)[id];
  const progress = isChallengeProgress(stored) ? stored : null;
  const today = toDateKey(new Date());

  const underway = progress !== null && !progress.completed;
  const next = underway ? getNextDayIndex(progress) : -1;
  const readAllowed = next >= 0 && canReadToday(progress, today);
  // Today's verse: the next day to read, or, once today's reading is done, the one just read.
  const todayIndex = readAllowed ? next : underway ? (progress.completedDays.at(-1) ?? -1) : -1;
  const assignment =
    todayIndex >= 0 ? readableAssignment(progress.dayAssignments[todayIndex]) : null;
  const verse = readAllowed && assignment ? await loadVerse(assignment) : null;

  const heading = el("h3", {
    class: "progress-detail-name",
    tabindex: "-1",
    text: t(def.i18nKey),
  });
  const parts = [
    el(
      "button",
      {
        type: "button",
        class: "button button-quiet button-small progress-back",
        onClick: action(() => showOverview(id)),
      },
      [icon("chevronLeft", { size: 14 }), t("backToChallenges", {}, "Back to challenges")]
    ),
    el("div", { class: "progress-detail-title" }, [
      emoji("progress-detail-emoji", def.icon),
      el("div", {}, [
        heading,
        el("p", {
          class: "progress-detail-meta",
          text: daysCount(def.days),
        }),
      ]),
    ]),
  ];

  const description = el("p", { class: "progress-desc", text: t(def.i18nDescKey) });
  if (!progress) {
    parts.push(
      description,
      el("button", {
        type: "button",
        class: "button button-large",
        text: t("challengeStart", {}, "Start Challenge"),
        onClick: action(() => startNow(id)),
      })
    );
  } else if (progress.completed) {
    parts.push(finishedCard(progress), description, dayList(progress, -1), resetButton(id));
  } else {
    parts.push(
      ...startedParts({ id, progress, next, readAllowed, assignment, verse }),
      description,
      dayList(progress, next),
      resetButton(id)
    );
  }

  body.replaceChildren(el("div", { class: "progress progress-detail" }, parts));
  heading.focus();
}

function startedParts({ id, progress, next, readAllowed, assignment, verse }) {
  const total = progress.dayAssignments.length;
  const done = progress.completedDays.length;
  const parts = [
    el("div", { class: "progress-card" }, [
      el("div", { class: "progress-now-row" }, [
        el("strong", {
          class: "progress-now-day",
          text: t(
            "challengeDay",
            { day: next >= 0 ? next + 1 : total, total },
            "Day {{day}} of {{total}}"
          ),
        }),
        el("span", {
          class: "progress-now-count",
          text: chaptersDone(done, total),
        }),
      ]),
      progressBar(done, total, chaptersDone(done, total)),
    ]),
  ];

  if (readAllowed && assignment) {
    parts.push(verseCard(assignment, verse));
  } else if (!readAllowed) {
    parts.push(
      el("div", { class: "progress-card progress-wait" }, [
        emoji("progress-wait-emoji", "🌙"),
        el("p", {
          class: "progress-wait-title",
          text: t("challengeAlreadyDone", {}, "Already read today — come back tomorrow!"),
        }),
        el("p", {
          class: "progress-wait-hint",
          text: t("challengeSeeYouTomorrow", {}, "See you tomorrow!"),
        }),
      ])
    );
  }

  parts.push(
    el("button", {
      type: "button",
      class: "button button-large",
      disabled: !readAllowed,
      text: t("markTodayDone", {}, "Mark today's reading as done"),
      onClick: action(() => markToday(id)),
    })
  );
  if (assignment) {
    parts.push(
      el("button", {
        type: "button",
        class: "button button-large button-quiet",
        text: t("openVerse", {}, "Open verse"),
        onClick: () =>
          navigateTo({
            chapterIndex: assignment.chapter - 1,
            verseIndex: assignment.verseNumber - 1,
          }),
      })
    );
  }
  return parts;
}

function verseCard(assignment, verse) {
  const text = verse?.text;
  return el("div", { class: "progress-card" }, [
    cardTitle(t("challengeTodaysVerse", {}, "Today's Verse")),
    el("p", {
      class: "progress-verse-ref",
      text: t(
        "psalmSubtitle",
        { chapter: assignment.chapter, verse: assignment.verseNumber },
        "Psalm {{chapter}}:{{verse}}"
      ),
    }),
    text
      ? el("p", { class: "progress-verse-text", dir: verse.rtl ? "rtl" : null, text })
      : el("p", {
          class: "progress-verse-missing",
          text: t(
            "psalmUnavailable",
            {},
            "This psalm is not available in the selected translation. Try another translation from Settings."
          ),
        }),
  ]);
}

function finishedCard(progress) {
  const date = formatDay(parseDateKey(progress.completedDate));
  return el("div", { class: "progress-card progress-finished" }, [
    emoji("progress-finished-emoji", "👑"),
    el("p", {
      class: "progress-finished-title",
      text: challengeCompleteText(),
    }),
    date ? el("p", { class: "progress-finished-date", text: date }) : null,
  ]);
}

function dayList(progress, next) {
  const rows = progress.dayAssignments.map((assignment, i) => {
    const done = progress.completedDays.includes(i);
    const readable = readableAssignment(assignment);
    return el(
      "li",
      {
        class: classes("progress-day-row", done && "is-done", i === next && "is-next"),
        "aria-current": i === next ? "step" : null,
      },
      [
        el("span", { class: "progress-day-mark" }, done ? [icon("check", { size: 13 })] : []),
        el("span", {
          class: "progress-day-num",
          text: t("challengeDayNumber", { day: i + 1 }, "Day {{day}}"),
        }),
        readable
          ? el("span", {
              class: "progress-day-ref",
              text: t("psalmTitle", { chapter: readable.chapter }, "Psalm {{chapter}}"),
            })
          : null,
        done
          ? el("span", { class: "sr-only", text: t("challengeCompleted", {}, "Completed!") })
          : null,
      ]
    );
  });
  return el("div", {}, [
    el("h4", { class: "progress-card-title", text: t("challengeDaysTitle", {}, "Days") }),
    el("ol", { class: "progress-days" }, rows),
  ]);
}

function resetButton(id) {
  return el("button", {
    type: "button",
    class: "button button-small button-danger-quiet progress-reset",
    text: t("challengeReset", {}, "Reset challenge"),
    onClick: action(() => resetNow(id)),
  });
}

// ─── Changing a challenge ─────────────────────────────────────────────────────

async function startNow(id) {
  // The verses come from the version being read. If its text cannot be loaded, nothing is started.
  const data = await getVersionData(currentVersion());
  const today = toDateKey(new Date());
  const store = await updateCarry((carry) => {
    const all = getChallengeProgress({ carry });
    startChallenge(all, id, data, reminderTime(getPhoneSettings({ carry })), today);
    carry.challenges = all;
  });
  await showChallenge(id, store);
}

async function markToday(id) {
  const today = toDateKey(new Date());
  let result = null;
  const store = await updateCarry((carry) => {
    const all = getChallengeProgress({ carry });
    const dayIndex = isChallengeProgress(all[id]) ? getNextDayIndex(all[id]) : -1;
    if (dayIndex < 0) return;
    result = markDayComplete(all, id, dayIndex, today);
    carry.challenges = all;
  });
  if (result && !result.blocked) {
    toast(
      result.challengeJustCompleted
        ? challengeCompleteText()
        : t(
            "challengeDayComplete",
            { day: result.completedDayIndex + 1 },
            "Day {{day}} Complete! 🎉"
          ),
      "success"
    );
  }
  await showChallenge(id, store);
}

async function resetNow(id) {
  const confirmed = await confirmDialog({
    title: t("challengeResetTitle", {}, "Reset this challenge?"),
    message: t(
      "challengeResetMessage",
      {},
      "Your progress in this challenge will be cleared. You can start it again at any time."
    ),
    confirmLabel: t("challengeResetConfirm", {}, "Reset"),
    cancelLabel: t("cancel", {}, "Cancel"),
    destructive: true,
  });
  if (!confirmed) return;
  const store = await updateCarry((carry) => {
    const all = getChallengeProgress({ carry });
    resetChallenge(all, id);
    carry.challenges = all;
  });
  await showChallenge(id, store);
}
