// ─── List panels ──────────────────────────────────────────────────────────────
// Search results, the Library (favourites and notes) and reading history are
// all the same shape: a scrolling list of verse references with a preview and
// an optional action. They share one row builder rather than three near-copies.

import { el, iconButton, emptyState, toast, reportError, confirmDialog, byId } from "./dom.js";
import { formatReference, getData, isVerseRef } from "./data.js";
import { formatTimestamp } from "./dates.js";
import { searchVerses, splitMatches, truncate, SEARCH_MIN_QUERY } from "./search.js";
import {
  clearHistory,
  deleteNote,
  getFavourites,
  getHistory,
  getNotes,
  removeFavourite,
} from "./storage.js";

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
 * @param {() => void} options.onOpen
 * @param {{label: string, icon: string, onClick: () => void}} [options.action]
 */
function listRow({ reference, preview, meta, note, onOpen, action }) {
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
      el("span", { class: "row-ref", text: reference }),
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

// ─── Library: favourites and notes ────────────────────────────────────────────

/** @type {"favourites"|"notes"} */
let libraryTab = "favourites";

export function getLibraryTab() {
  return libraryTab;
}

export async function showLibraryTab(tab) {
  libraryTab = tab;
  for (const button of document.querySelectorAll("#libraryTabs [role='tab']")) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle("is-active", selected);
  }
  await (tab === "favourites" ? renderFavourites() : renderNotes());
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
    reportError(error, "Your saved verses could not be read.");
    return;
  }

  const usable = favourites.filter((f) => isVerseRef(data, f.chapterIndex, f.verseIndex));

  if (usable.length === 0) {
    paint(
      "libraryBody",
      emptyState(
        "No saved verses yet",
        "Open a Psalm, select a verse, and choose Save to keep it here."
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
            label: `Remove ${formatReference(chapterIndex, verseIndex)} from Favourites`,
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
      emptyState(
        "Nothing read yet",
        "Psalms you open appear here, most recent first."
      )
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
            verseIndex === null
              ? data[chapterIndex][0]
              : data[chapterIndex][verseIndex],
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
    message: "Every entry will be removed. Your saved verses and notes are not affected.",
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
