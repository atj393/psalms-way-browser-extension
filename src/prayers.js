// ─── Prayers ──────────────────────────────────────────────────────────────────
// The phone app's prayers in three levels: the categories, the prayers in one
// category, and one prayer. Prayer titles and texts are English only, as on the
// phone; category names, labels and messages are translated.
//
// `data/prayers-en.json` is the phone's file byte for byte, so a newer copy from
// the phone is a plain overwrite.

import { CHAPTER_COUNT, formatReference } from "./data.js";
import { byId, el, emptyState, reportError, toast } from "./dom.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";

const PRAYERS_FILE_PATH = "data/prayers-en.json";

/** The wording, in the reader's language, for each occasion the file uses. */
const OCCASIONS = new Map([
  ["daily", () => t("prayerOccasionDaily", {}, "Daily")],
  ["situational", () => t("prayerOccasionSituational", {}, "Situational")],
  ["seasonal", () => t("prayerOccasionSeasonal", {}, "Seasonal")],
]);

/**
 * Prayer titles and texts are English only, as on the phone. Marking them says so,
 * so they read and align as English when the rest of the popup is in another
 * language or runs right to left.
 */
const ENGLISH = { lang: "en", dir: "ltr" };

let cache = null;

/** Test seam: drop the in-memory copy so the next open reads the file again. */
export function resetPrayersCache() {
  cache = null;
}

/**
 * Load the prayers once per popup session.
 * A failure carries the reader-facing message; the cause is kept for the console.
 */
async function loadPrayers() {
  if (cache) return cache;
  try {
    const response = await fetch(PRAYERS_FILE_PATH);
    if (!response.ok) throw new Error(`${PRAYERS_FILE_PATH} responded ${response.status}`);
    const parsed = await response.json();
    if (!Array.isArray(parsed?.categories) || !Array.isArray(parsed?.prayers)) {
      throw new Error(`${PRAYERS_FILE_PATH} has no categories and prayers lists`);
    }
    cache = parsed;
  } catch (error) {
    throw new Error(t("prayerLoadError", {}, "The prayers could not be loaded."), {
      cause: error,
    });
  }
  return cache;
}

const prayersIn = (catalogue, categoryId) =>
  catalogue.prayers.filter((prayer) => prayer.categoryId === categoryId);

// ─── References ───────────────────────────────────────────────────────────────

const REFERENCE_PATTERN = /^(\d+)(?::(\d+))?$/;

/**
 * Read a reference such as "23:2" (verse 2 of Psalm 23) or "23" (all of it).
 * The file's references are all chapter:verse; anything else, or a number
 * outside the 150 Psalms, is not mapped.
 *
 * @param {unknown} reference
 * @returns {{chapterIndex: number, verseIndex: number | null} | null} 0-based
 */
export function parsePsalmReference(reference) {
  const match = typeof reference === "string" ? REFERENCE_PATTERN.exec(reference) : null;
  if (!match) return null;
  const chapter = Number(match[1]);
  const verse = match[2] === undefined ? null : Number(match[2]);
  if (chapter < 1 || chapter > CHAPTER_COUNT || verse === 0) return null;
  return { chapterIndex: chapter - 1, verseIndex: verse === null ? null : verse - 1 };
}

/** What a reference reads as, and where it opens (null when it cannot be mapped). */
function describeReference(reference) {
  const target = parsePsalmReference(reference);
  const label = target
    ? formatReference(target.chapterIndex, target.verseIndex)
    : String(reference);
  return { target, label };
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

/** The phone's share message, put on the clipboard instead. */
async function copyPrayer(prayer) {
  const references = (prayer.psalmsReference ?? []).map((ref) => describeReference(ref).label);
  const text = [
    prayer.title,
    prayer.prayer,
    references.length > 0
      ? t("scriptureReferenceLabel", {}, "Scripture Reference: ") + references.join(", ")
      : null,
    t("sharedFromPsalmsWay", {}, "Shared from Psalms Way"),
  ]
    .filter((part) => part !== null)
    .join("\n\n");

  try {
    await navigator.clipboard.writeText(text);
    toast(t("prayerCopied", {}, "Prayer copied"), "success");
  } catch (error) {
    console.error("Psalms Way: clipboard write failed", error);
    toast(
      t(
        "prayerCopyBlocked",
        {},
        "Your browser blocked the copy. Select the prayer and press Ctrl+C."
      ),
      "error"
    );
  }
}

// ─── Building blocks ──────────────────────────────────────────────────────────

const categoryName = (category) => t(category.i18nKey, {}, category.name);
const noPrayersText = () => t("prayerEmpty", {}, "No prayers in this category yet");

function occasionLabel(occasion) {
  return OCCASIONS.get(occasion)?.() ?? null;
}

/**
 * A list of buttons, one per item, so every row is reachable by keyboard.
 * Returns the rows by item id as well, so a level can put focus back on the row
 * the reader came from.
 *
 * @param {Array<{id: string, title: string, sub: string | null, onOpen: () => void,
 *   english?: boolean}>} items `english` marks a title that is a prayer's own (English only)
 */
function listRows(items) {
  const rows = new Map();
  const list = el(
    "ul",
    { class: "rows" },
    items.map(({ id, title, sub, onOpen, english }) => {
      const row = el("button", { type: "button", class: "row-body prayer-row", onClick: onOpen }, [
        el("span", { class: "prayer-row-main" }, [
          el("span", { class: "prayer-row-text" }, [
            el("span", { class: "prayer-row-title", text: title, ...(english ? ENGLISH : {}) }),
            sub ? el("span", { class: "prayer-row-sub", text: sub }) : null,
          ]),
          icon("chevronRight", { size: 14 }),
        ]),
      ]);
      rows.set(id, row);
      return el("li", { class: "row" }, [row]);
    })
  );
  return { list, rows };
}

function referenceChip(reference, navigate) {
  const { target, label } = describeReference(reference);
  if (!target) return el("span", { class: "prayer-ref is-plain", text: label });
  return el("button", {
    type: "button",
    class: "prayer-ref",
    text: label,
    onClick: () => navigate(target),
  });
}

function prayerDetail(prayer, navigate) {
  const references = prayer.psalmsReference ?? [];
  return el("div", { class: "prayer-detail" }, [
    el("p", { class: "prayer-text", text: prayer.prayer, ...ENGLISH }),
    references.length > 0
      ? el("div", { class: "prayer-refs" }, [
          el("h4", {
            class: "prayer-refs-label",
            text: t("scriptureReferencesTitle", {}, "Scripture References"),
          }),
          el(
            "div",
            { class: "prayer-ref-list" },
            references.map((reference) => referenceChip(reference, navigate))
          ),
        ])
      : null,
    el(
      "button",
      {
        type: "button",
        class: "button button-quiet prayer-copy",
        onClick: () => copyPrayer(prayer),
      },
      [icon("copy", { size: 14 }), el("span", { text: t("prayerCopy", {}, "Copy prayer") })]
    ),
  ]);
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/**
 * Show the prayers, starting at the categories.
 * @param {{navigate: (target: {chapterIndex: number, verseIndex: number | null}) => void}} options
 *   `navigate` opens a passage in the reader and closes the panel
 */
export async function renderPrayers({ navigate }) {
  const host = byId("prayersBody");
  if (!host) return;

  let catalogue;
  try {
    catalogue = await loadPrayers();
  } catch (error) {
    reportError(error);
    host.replaceChildren(emptyState(error.message));
    return;
  }

  /**
   * Replace the panel's content with one level.
   * Focus goes to `focus` (the row the reader came from) or else to Back. The
   * button that was clicked is gone after the repaint, and focus would otherwise
   * drop to the top of the page. Back says "Back"; its accessible name (`backLabel`)
   * says where it goes. `english` marks a title that is a prayer's own.
   */
  function paintLevel({ onBack, backLabel, title, english, content, focus }) {
    const back = onBack
      ? el(
          "button",
          {
            type: "button",
            class: "button button-quiet button-small prayer-back",
            "aria-label": backLabel,
            onClick: onBack,
          },
          [icon("chevronLeft", { size: 14 }), el("span", { text: t("prayerBack", {}, "Back") })]
        )
      : null;
    host.replaceChildren(
      el("div", { class: "prayer-level" }, [
        back ? el("div", { class: "prayer-nav" }, [back]) : null,
        title
          ? el("h3", { class: "prayer-heading", text: title, ...(english ? ENGLISH : {}) })
          : null,
        content,
      ])
    );
    host.scrollTop = 0;
    (focus ?? back)?.focus();
  }

  function showCategories(focusId = null) {
    const { list, rows } = listRows(
      catalogue.categories.map((category) => {
        const count = prayersIn(catalogue, category.id).length;
        return {
          id: category.id,
          title: categoryName(category),
          sub: count === 0 ? noPrayersText() : t("prayerCount", { count }, "{{count}} prayers"),
          onOpen: () => showList(category),
        };
      })
    );
    paintLevel({ content: list, focus: rows.get(focusId) });
  }

  function showList(category, focusId = null) {
    const prayers = prayersIn(catalogue, category.id);
    const { list, rows } = listRows(
      prayers.map((prayer) => ({
        id: prayer.id,
        title: prayer.title,
        english: true,
        sub: occasionLabel(prayer.occasion),
        onOpen: () => showDetail(category, prayer),
      }))
    );
    paintLevel({
      onBack: () => showCategories(category.id),
      backLabel: t("prayerBackToCategories", {}, "Back to categories"),
      title: categoryName(category),
      content: prayers.length > 0 ? list : emptyState(noPrayersText()),
      focus: rows.get(focusId),
    });
  }

  function showDetail(category, prayer) {
    paintLevel({
      onBack: () => showList(category, prayer.id),
      backLabel: t("prayerBackTo", { name: categoryName(category) }, "Back to {{name}}"),
      title: prayer.title,
      english: true,
      content: prayerDetail(prayer, navigate),
    });
  }

  showCategories();
}
