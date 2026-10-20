// ─── List panels ──────────────────────────────────────────────────────────────
// Search results, the Library (bookmarks, highlights, favourite Psalms and
// notes) and reading history are all the same shape: a scrolling list of
// references with a preview and an optional action. They share one row builder
// rather than several near-copies.

import { el, iconButton, emptyState, toast, reportError, confirmDialog, byId } from "./dom.js";
import { CHAPTER_COUNT, formatReference, getData, isVerseRef } from "./data.js";
import { formatTimestamp } from "./dates.js";
import { searchVerses, splitMatches, truncate, SEARCH_MIN_QUERY } from "./search.js";
import {
  clearHistory,
  deleteNote,
  getFavourites,
  getHistory,
  getNotes,
  loadStore,
  removeFavourite,
} from "./storage.js";
import {
  HIGHLIGHT_COLORS,
  getFavoriteChapters,
  getHighlights,
  setHighlight,
  toggleFavoriteChapter,
} from "./phoneData.js";
import { highlightLabel, refreshFavChapter, refreshPassage } from "./reader.js";
import { t } from "./i18n.js";

let navigate = () => {};

/** Injected by app.js: how a row opens its passage. */
export function setNavigator(fn) {
  navigate = fn;
}

// ─── Shared row ───────────────────────────────────────────────────────────────

/**
 * One list row.
 *
 * @param {object} options
 * @param {string} options.reference e.g. "Psalm 23:1"
 * @param {Array<{text:string,match:boolean}>|string} options.preview segments or plain text
 * @param {string} [options.meta] right-aligned secondary text, e.g. a timestamp
 * @param {string} [options.note] the reader's own note, shown beneath
 * @param {string} [options.swatch] a highlight colour, shown as a dot before the reference
 * @param {() => void} options.onOpen
 * @param {{label: string, icon: string, onClick: () => void}} [options.action]
 */
function listRow({ reference, preview, meta, note, swatch, onOpen, action }) {
  const previewEl = el("span", { class: "row-preview" });
  if (typeof preview === "string") {
    previewEl.textContent = preview;
  } else {
    for (const segment of preview) {
      previewEl.appendChild(
        segment.match
          ? el("mark", { class: "row-match", text: segment.text })
          : document.createTextNode(segment.text)
      );
    }
  }

  const body = el("button", { type: "button", class: "row-body", onClick: onOpen }, [
    el("span", { class: "row-top" }, [
      el("span", { class: "row-ref" }, [
        swatch
          ? el("span", { class: "hl-dot", "aria-hidden": "true", "data-highlight": swatch })
          : null,
        // The dot is colour alone; this is what a screen reader gets instead.
        swatch ? el("span", { class: "sr-only", text: `${highlightLabel(swatch)} ` }) : null,
        reference,
      ]),
      meta ? el("span", { class: "row-meta", text: meta }) : null,
    ]),
    previewEl,
    note ? el("span", { class: "row-note", text: truncate(note, 90) }) : null,
  ]);

  return el("li", { class: "row" }, [
    body,
    action
      ? iconButton(action.icon, action.label, {
          className: "btn-row-action",
          size: 14,
          onClick: action.onClick,
        })
      : null,
  ]);
}

function listContainer(children) {
  return el("ul", { class: "rows" }, children);
}

/** Render into a panel body, replacing whatever was there. */
function paint(hostId, node) {
  byId(hostId).replaceChildren(node);
}

// ─── Search ───────────────────────────────────────────────────────────────────

let lastQuery = "";

export function getLastQuery() {
  return lastQuery;
}

export async function runSearch(rawQuery) {
  const query = String(rawQuery ?? "").trim();
  lastQuery = query;
  const countEl = byId("searchCount");

  if (query.length < SEARCH_MIN_QUERY) {
    countEl.textContent = "";
    paint(
      "searchResults",
      emptyState(
        "Search the Psalms",
        `Type at least ${SEARCH_MIN_QUERY} characters, then press Enter.`
      )
    );
    return;
  }

  let data;
  try {
    data = await getData();
  } catch (error) {
    reportError(error, "The Psalms text could not be loaded.");
    return;
  }

  const { results, truncated, total } = searchVerses(data, query);

  if (results.length === 0) {
    countEl.textContent = "";
    paint(
      "searchResults",
      emptyState(`No verse contains “${query}”.`, "Try a shorter or more common word.")
    );
    return;
  }

  countEl.textContent = truncated
    ? `Showing first ${results.length} of ${total} matches`
    : `${total} ${total === 1 ? "match" : "matches"}`;

  paint(
    "searchResults",
    listContainer(
      results.map(({ chapterIndex, verseIndex, text }) =>
        listRow({
          reference: formatReference(chapterIndex, verseIndex),
          preview: splitMatches(truncate(text, 140), query),
          // Open the exact verse that matched, not just its chapter.
          onOpen: () => navigate({ chapterIndex, verseIndex }),
        })
      )
    )
  );
}

// ─── Library: bookmarks, highlights, favourite Psalms and notes ───────────────

/**
 * Tab id (the `data-tab` in popup.html) to its list. "favourites" is the verse
 * bookmarks; "chapters" is the whole-Psalm favourites the heart adds to.
 */
const LIBRARY_TABS = {
  favourites: () => renderFavourites(),
  highlights: () => renderHighlights(),
  chapters: () => renderFavouriteChapters(),
  notes: () => renderNotes(),
};

/** @type {keyof LIBRARY_TABS} */
let libraryTab = "favourites";

export function getLibraryTab() {
  return libraryTab;
}

export async function showLibraryTab(tab) {
  if (!Object.hasOwn(LIBRARY_TABS, tab)) throw new Error(`Unknown Library tab: ${tab}`);
  libraryTab = tab;
  for (const button of document.querySelectorAll("#libraryTabs [role='tab']")) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle("is-active", selected);
  }
  await LIBRARY_TABS[tab]();
}

export async function renderLibrary() {
  await showLibraryTab(libraryTab);
}

async function renderFavourites() {
  let favourites;
  let data;
  try {
    [favourites, data] = await Promise.all([getFavourites(), getData()]);
  } catch (error) {
    reportError(error, "Your bookmarks could not be read.");
    return;
  }

  const usable = favourites.filter((f) => isVerseRef(data, f.chapterIndex, f.verseIndex));

  if (usable.length === 0) {
    paint(
      "libraryBody",
      emptyState(
        "No bookmarks yet",
        "Open a Psalm, select a verse, and choose Bookmark to keep it here."
      )
    );
    return;
  }

  paint(
    "libraryBody",
    listContainer(
      usable.map(({ chapterIndex, verseIndex, addedAt }) =>
        listRow({
          reference: formatReference(chapterIndex, verseIndex),
          preview: truncate(data[chapterIndex][verseIndex], 110),
          meta: formatTimestamp(addedAt),
          onOpen: () => navigate({ chapterIndex, verseIndex }),
          action: {
            icon: "close",
            label: `Remove the bookmark on ${formatReference(chapterIndex, verseIndex)}`,
            onClick: async () => {
              try {
                await removeFavourite(chapterIndex, verseIndex);
                toast(`${formatReference(chapterIndex, verseIndex)} removed`, "success");
                await renderFavourites();
              } catch (error) {
                reportError(error, "That verse could not be removed.");
              }
            },
          },
        })
      )
    )
  );
}

/**
 * Runs the repaint that follows a removal that already succeeded. If the repaint
 * fails, say so on its own terms: the removal is not what went wrong.
 */
async function repaintAfterRemoval(repaint) {
  try {
    await repaint();
  } catch (error) {
    reportError(
      error,
      t(
        "libraryRefreshError",
        {},
        "Removed, but the Library could not be refreshed. Close and reopen it."
      )
    );
  }
}

async function renderHighlights() {
  let store;
  let data;
  try {
    [store, data] = await Promise.all([loadStore(), getData()]);
  } catch (error) {
    reportError(error, t("highlightsReadError", {}, "Your highlights could not be read."));
    return;
  }

  // The phone stores 1-based chapter and verse. Highlights carry no date, so
  // they are listed in reading order.
  const usable = getHighlights(store)
    .filter(
      (h) => HIGHLIGHT_COLORS.includes(h?.color) && isVerseRef(data, h.chapter - 1, h.verse - 1)
    )
    .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);

  if (usable.length === 0) {
    paint(
      "libraryBody",
      emptyState(
        t("noHighlights", {}, "No highlights yet"),
        t("noHighlightsHint", {}, "Select a verse and choose Highlight to colour it.")
      )
    );
    return;
  }

  paint(
    "libraryBody",
    listContainer(
      usable.map(({ chapter, verse, color }) => {
        const chapterIndex = chapter - 1;
        const verseIndex = verse - 1;
        const reference = formatReference(chapterIndex, verseIndex);
        return listRow({
          reference,
          swatch: color,
          preview: truncate(data[chapterIndex][verseIndex], 110),
          onOpen: () => navigate({ chapterIndex, verseIndex }),
          action: {
            icon: "close",
            label: t("removeHighlightOn", { reference }, "Remove the highlight on {{reference}}"),
            onClick: async () => {
              try {
                await setHighlight(chapterIndex, verseIndex, null);
              } catch (error) {
                reportError(
                  error,
                  t("highlightRemoveError", {}, "That highlight could not be removed.")
                );
                return;
              }
              toast(
                t("highlightCleared", { reference }, "Highlight removed from {{reference}}"),
                "success"
              );
              await repaintAfterRemoval(async () => {
                await renderHighlights();
                // The Psalm being read sits behind this panel; drop its tint too.
                await refreshPassage();
              });
            },
          },
        });
      })
    )
  );
}

async function renderFavouriteChapters() {
  let store;
  let data;
  try {
    [store, data] = await Promise.all([loadStore(), getData()]);
  } catch (error) {
    reportError(error, t("favouritesReadError", {}, "Your favourite Psalms could not be read."));
    return;
  }

  const chapters = getFavoriteChapters(store).filter((c) => c >= 1 && c <= CHAPTER_COUNT);

  if (chapters.length === 0) {
    paint(
      "libraryBody",
      emptyState(
        t("noFavouritePsalms", {}, "No favourite Psalms yet"),
        t("noFavouritePsalmsHint", {}, "Click the heart beside a Psalm's title to keep it here.")
      )
    );
    return;
  }

  paint(
    "libraryBody",
    listContainer(
      chapters.map((chapter) => {
        const chapterIndex = chapter - 1;
        const reference = formatReference(chapterIndex);
        return listRow({
          reference,
          // A version that lacks this Psalm has no first verse; the row stays so it can be removed.
          preview: truncate(data[chapterIndex]?.[0] ?? "", 110),
          onOpen: () => navigate({ chapterIndex, verseIndex: null }),
          action: {
            icon: "close",
            label: t(
              "removeChapterFavourite",
              { reference },
              "Remove {{reference}} from Favourites"
            ),
            onClick: async () => {
              try {
                await toggleFavoriteChapter(chapterIndex);
              } catch (error) {
                reportError(
                  error,
                  t("favouriteRemoveError", {}, "That Psalm could not be removed from Favourites.")
                );
                return;
              }
              toast(
                t(
                  "chapterFavouriteRemoved",
                  { reference },
                  "{{reference}} removed from Favourites"
                ),
                "success"
              );
              await repaintAfterRemoval(async () => {
                await renderFavouriteChapters();
                // The heart in the chapter bar stays visible behind this panel.
                refreshFavChapter(await loadStore());
              });
            },
          },
        });
      })
    )
  );
}

async function renderNotes() {
  let notes;
  let data;
  try {
    [notes, data] = await Promise.all([getNotes(), getData()]);
  } catch (error) {
    reportError(error, "Your notes could not be read.");
    return;
  }

  const usable = notes.filter((n) => isVerseRef(data, n.chapterIndex, n.verseIndex));

  if (usable.length === 0) {
    paint(
      "libraryBody",
      emptyState(
        "No notes yet",
        "Select a verse while reading and choose Note to write something down."
      )
    );
    return;
  }

  paint(
    "libraryBody",
    listContainer(
      usable.map(({ chapterIndex, verseIndex, text, updatedAt }) =>
        listRow({
          reference: formatReference(chapterIndex, verseIndex),
          preview: truncate(data[chapterIndex][verseIndex], 80),
          note: text,
          meta: formatTimestamp(updatedAt),
          onOpen: () => navigate({ chapterIndex, verseIndex }),
          action: {
            icon: "trash",
            label: `Delete note on ${formatReference(chapterIndex, verseIndex)}`,
            onClick: async () => {
              const confirmed = await confirmDialog({
                title: "Delete this note?",
                message: `Your note on ${formatReference(chapterIndex, verseIndex)} will be removed. This cannot be undone.`,
                confirmLabel: "Delete",
                destructive: true,
              });
              if (!confirmed) return;
              try {
                await deleteNote(chapterIndex, verseIndex);
                toast("Note deleted", "success");
                await renderNotes();
              } catch (error) {
                reportError(error, "That note could not be deleted.");
              }
            },
          },
        })
      )
    )
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function renderHistory() {
  let history;
  let data;
  try {
    [history, data] = await Promise.all([getHistory(), getData()]);
  } catch (error) {
    reportError(error, "Your reading history could not be read.");
    return;
  }

  const clearButton = byId("btnClearHistory");
  const usable = history.filter((h) =>
    h.verseIndex === null
      ? h.chapterIndex >= 0 && h.chapterIndex < data.length
      : isVerseRef(data, h.chapterIndex, h.verseIndex)
  );

  if (clearButton) clearButton.hidden = usable.length === 0;

  if (usable.length === 0) {
    paint(
      "historyBody",
      emptyState("Nothing read yet", "Psalms you open appear here, most recent first.")
    );
    return;
  }

  paint(
    "historyBody",
    listContainer(
      usable.map(({ chapterIndex, verseIndex, viewedAt }) =>
        listRow({
          reference: formatReference(chapterIndex, verseIndex),
          preview: truncate(
            verseIndex === null ? data[chapterIndex][0] : data[chapterIndex][verseIndex],
            110
          ),
          meta: formatTimestamp(viewedAt),
          onOpen: () => navigate({ chapterIndex, verseIndex }),
        })
      )
    )
  );
}

export async function confirmClearHistory() {
  const confirmed = await confirmDialog({
    title: "Clear reading history?",
    message: "Every entry will be removed. Your bookmarks and notes are not affected.",
    confirmLabel: "Clear history",
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await clearHistory();
    toast("Reading history cleared", "success");
    await renderHistory();
  } catch (error) {
    reportError(error, "Your history could not be cleared.");
  }
}
