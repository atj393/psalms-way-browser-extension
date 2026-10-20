// ─── Today ────────────────────────────────────────────────────────────────────
// The Today panel: the verse of the day, Today's Psalm, and the reading streak.
// The verse of the day follows the phone app's pick for the current version
// (dailyVerse.js), so both show the same verse on the same day. Nothing here is
// stored: the panel is worked out again from today's date each time it opens.

import { byId, el, toast } from "./dom.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";
import { formatReference, formatVerseForCopy } from "./data.js";
import { getDailyChapterIndex } from "./dates.js";
import { daysBetween, toDateKey } from "./dateKeys.js";
import { getVerseForDate } from "./dailyVerse.js";
import { currentVersion, getVersionData } from "./versions.js";
import { loadStore } from "./storage.js";
import { getStreakData } from "./phoneData.js";

/**
 * Called by the Today button. `showPanel` opens the Today panel and renders it.
 * (app.js also passes `navigate`; the panel itself receives it from `showPanel`.)
 */
export async function openToday({ showPanel }) {
  await showPanel();
}

/**
 * The streak to show, by the phone's rule (`getStreak`): the stored count while
 * the last day read is today or yesterday, and 0 once a day has been missed.
 *
 * @param {{lastDate: string, count: number} | null} streak from `getStreakData`
 * @param {string} todayKey local day, 'YYYY-MM-DD'
 * @returns {number}
 */
export function shownStreak(streak, todayKey) {
  if (!streak) return 0;
  const gap = daysBetween(streak.lastDate, todayKey);
  return gap !== null && gap <= 1 ? streak.count : 0;
}

/**
 * Draws the panel into #todayBody.
 *
 * @param {object} options
 * @param {(target: {chapterIndex: number, verseIndex?: number}) => unknown} options.navigate
 *   opens a passage and closes the panel
 * @param {Date} [options.now] the moment to show, for tests
 */
export async function renderToday({ navigate, now = new Date() }) {
  const host = byId("todayBody");
  if (!host) return;

  const version = currentVersion();
  const todayKey = toDateKey(now);
  const [data, store] = await Promise.all([getVersionData(version), loadStore()]);
  const pick = getVerseForDate(todayKey, version, data);

  host.replaceChildren(
    el("div", { class: "today" }, [
      pick ? verseCard(pick, navigate) : verseUnavailableCard(),
      psalmCard(getDailyChapterIndex(now), navigate),
      streakLine(shownStreak(getStreakData(store), todayKey)),
    ])
  );
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function card(id, label, children) {
  return el("section", { class: "today-card", "aria-labelledby": id }, [
    el("h3", { class: "today-label", id, text: label }),
    ...children,
  ]);
}

const verseOfTheDayLabel = () => t("todayVerseOfTheDay", {}, "Verse of the day");

function verseCard({ chapter, verseNumber, verse }, navigate) {
  const chapterIndex = chapter - 1;
  const verseIndex = verseNumber - 1;
  return card("todayVerseLabel", verseOfTheDayLabel(), [
    el("p", { class: "today-reference", text: formatReference(chapterIndex, verseIndex) }),
    // `auto` lets a right-to-left version read from the right.
    el("p", { class: "today-verse", dir: "auto", text: verse }),
    el("div", { class: "button-row" }, [
      el("button", {
        type: "button",
        class: "button button-large",
        text: t("todayOpen", {}, "Open"),
        onClick: () => navigate({ chapterIndex, verseIndex }),
      }),
      el(
        "button",
        {
          type: "button",
          class: "button button-quiet button-large",
          onClick: () => copyVerse(chapterIndex, verseIndex, verse),
        },
        [icon("copy", { size: 14 }), t("todayCopy", {}, "Copy")]
      ),
    ]),
  ]);
}

function verseUnavailableCard() {
  return card("todayVerseLabel", verseOfTheDayLabel(), [
    el("p", {
      class: "today-note",
      text: t("todayVerseUnavailable", {}, "There is no verse of the day in this version."),
    }),
  ]);
}

function psalmCard(chapterIndex, navigate) {
  return card("todayPsalmLabel", t("todaysPsalm", {}, "Today's Psalm"), [
    el("div", { class: "today-psalm" }, [
      el("p", { class: "today-psalm-title", text: formatReference(chapterIndex) }),
      el("button", {
        type: "button",
        class: "button button-quiet",
        text: t("todayRead", {}, "Read"),
        onClick: () => navigate({ chapterIndex }),
      }),
    ]),
  ]);
}

function streakLine(count) {
  const text =
    count > 0
      ? t("todayStreak", { count }, "{{count}}-day streak")
      : t("todayStreakStart", {}, "Read today to start your streak.");
  return el("p", { class: "today-streak" }, [icon("candle", { size: 16 }), el("span", { text })]);
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

async function copyVerse(chapterIndex, verseIndex, text) {
  try {
    await navigator.clipboard.writeText(formatVerseForCopy(chapterIndex, verseIndex, text));
    toast(
      t(
        "todayCopied",
        { reference: formatReference(chapterIndex, verseIndex) },
        "{{reference}} copied"
      ),
      "success"
    );
  } catch (error) {
    console.error("Psalms Way: clipboard write failed", error);
    toast(
      t(
        "todayCopyBlocked",
        {},
        "Your browser blocked the copy. Select the verse and press Ctrl+C."
      ),
      "error"
    );
  }
}
