// ─── Reading view ─────────────────────────────────────────────────────────────
// The primary surface. A chapter is a list of verses; selecting one reveals its
// actions in place rather than putting a permanent button row beside every line.

import { el, toast, reportError, byId } from "./dom.js";
import { icon } from "./icons.js";
import {
  formatReference,
  formatVerseForCopy,
  getData,
  isChapterRef,
  isVerseRef,
  getRandomVerseIndex,
} from "./data.js";
import {
  addHistoryEntry,
  hasFavourite,
  findNote,
  loadStore,
  toggleFavourite,
} from "./storage.js";

/** Current passage. Persisted through history, not held across popup closes. */
const state = {
  chapterIndex: 0,
  verseIndex: null, // null = whole chapter
  selectedVerse: null,
};

export function getCurrentChapter() {
  return state.chapterIndex;
}

export function getCurrentVerse() {
  return state.verseIndex;
}

let onOpenNoteEditor = () => {};

/** Injected by app.js to avoid a circular import with the note editor. */
export function setNoteEditorOpener(fn) {
  onOpenNoteEditor = fn;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render a passage.
 *
 * @param {object} options
 * @param {number} options.chapterIndex
 * @param {number|null} [options.verseIndex] a single verse, or null for the chapter
 * @param {boolean} [options.record] add to reading history
 */
export async function showPassage({ chapterIndex, verseIndex = null, record = true }) {
  let data;
  try {
    data = await getData();
  } catch (error) {
    renderDataFailure(error);
    return;
  }

  if (!isChapterRef(data, chapterIndex)) {
    reportError(new Error(`Chapter ${chapterIndex} is out of range`), "That Psalm does not exist.");
    return;
  }
  if (verseIndex !== null && !isVerseRef(data, chapterIndex, verseIndex)) {
    // A stored favourite or history row can outlive the verse it points at.
    verseIndex = null;
  }

  state.chapterIndex = chapterIndex;
  state.verseIndex = verseIndex;
  state.selectedVerse = verseIndex;

  const store = await loadStoreQuietly();
  const content = byId("readingView");

  byId("chapterTitle").textContent = formatReference(chapterIndex, verseIndex);
  byId("txtChapter").value = "";

  content.replaceChildren(
    verseIndex === null
      ? renderChapter(data, chapterIndex, store)
      : renderSingleVerse(data, chapterIndex, verseIndex, store)
  );
  content.scrollTop = 0;

  if (record) {
    addHistoryEntry(chapterIndex, verseIndex).catch((error) => {
      // History is a convenience; a failure here must not interrupt reading.
      console.error("Psalms Way: could not record history", error);
    });
  }
}

async function loadStoreQuietly() {
  try {
    return await loadStore();
  } catch (error) {
    console.error("Psalms Way: could not read saved data", error);
    return { favourites: [], notes: [], history: [], settings: {} };
  }
}

function renderDataFailure(error) {
  console.error("Psalms Way:", error);
  byId("readingView").replaceChildren(
    el("div", { class: "panel-empty" }, [
      el("p", { class: "panel-empty-title", text: "The Psalms text could not be loaded." }),
      el("p", {
        class: "panel-empty-hint",
        text: "Reopen the extension. If this keeps happening, reinstall it from chrome://extensions.",
      }),
    ])
  );
}

function renderChapter(data, chapterIndex, store) {
  const list = el("ol", {
    class: "verses",
    "aria-label": `${formatReference(chapterIndex)}, ${data[chapterIndex].length} verses`,
  });

  data[chapterIndex].forEach((text, verseIndex) => {
    list.appendChild(renderVerseRow(chapterIndex, verseIndex, text, store));
  });

  // Roving tab stop: the list is one stop, arrow keys move within it. A chapter
  // can be 176 verses long (Psalm 119) and putting each one in the tab order
  // would make keyboard navigation of the popup unusable.
  const rows = Array.from(list.querySelectorAll(".verse"));
  if (rows.length > 0) rows[0].tabIndex = 0;
  list.addEventListener("keydown", (event) => onVerseKeyDown(event, rows));

  return list;
}

function onVerseKeyDown(event, rows) {
  const current = document.activeElement.closest?.(".verse");
  if (!current) return;
  const index = rows.indexOf(current);
  if (index === -1) return;

  let next = null;
  if (event.key === "ArrowDown") next = rows[Math.min(index + 1, rows.length - 1)];
  else if (event.key === "ArrowUp") next = rows[Math.max(index - 1, 0)];
  else if (event.key === "Home") next = rows[0];
  else if (event.key === "End") next = rows[rows.length - 1];
  else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    current.querySelector(".verse-body")?.click();
    return;
  } else return;

  event.preventDefault();
  if (!next) return;
  for (const row of rows) row.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
}

function renderVerseRow(chapterIndex, verseIndex, text, store) {
  const isFav = hasFavourite(store, chapterIndex, verseIndex);
  const note = findNote(store, chapterIndex, verseIndex);

  const body = el("div", { class: "verse-body", role: "button", tabindex: "-1" }, [
    el("span", { class: "verse-num", text: String(verseIndex + 1), "aria-hidden": "true" }),
    el("span", { class: "verse-text", text }),
  ]);
  body.setAttribute("aria-expanded", "false");
  body.setAttribute(
    "aria-label",
    `${formatReference(chapterIndex, verseIndex)}. ${text}`
  );

  const markers = el("span", { class: "verse-markers" });
  if (isFav) markers.appendChild(markerIcon("heart", "Saved"));
  if (note) markers.appendChild(markerIcon("note", "Has a note"));

  const row = el("li", { class: "verse", tabindex: "-1" }, [body, markers]);
  row.dataset.chapter = String(chapterIndex);
  row.dataset.verse = String(verseIndex);

  body.addEventListener("click", () => toggleVerseActions(row, chapterIndex, verseIndex, text));
  return row;
}

function markerIcon(name, label) {
  const wrapper = el("span", { class: `verse-marker verse-marker-${name}`, title: label });
  wrapper.appendChild(icon(name, { size: 12, filled: name === "heart" }));
  const sr = el("span", { class: "sr-only", text: ` ${label}` });
  wrapper.appendChild(sr);
  return wrapper;
}

async function toggleVerseActions(row, chapterIndex, verseIndex, text) {
  const list = row.parentElement;
  const alreadyOpen = row.classList.contains("is-selected");

  // Only one verse is expanded at a time.
  list.querySelectorAll(".verse-actions").forEach((node) => node.remove());
  list.querySelectorAll(".verse.is-selected").forEach((node) => {
    node.classList.remove("is-selected");
    node.querySelector(".verse-body")?.setAttribute("aria-expanded", "false");
  });

  if (alreadyOpen) {
    state.selectedVerse = null;
    return;
  }

  row.classList.add("is-selected");
  row.querySelector(".verse-body")?.setAttribute("aria-expanded", "true");
  state.selectedVerse = verseIndex;

  const actions = await buildVerseActions(chapterIndex, verseIndex, text, {
    onChanged: () => refreshVerseMarkers(row, chapterIndex, verseIndex),
  });
  row.appendChild(actions);
  actions.querySelector("button")?.focus();
}

async function refreshVerseMarkers(row, chapterIndex, verseIndex) {
  const store = await loadStoreQuietly();
  const markers = row.querySelector(".verse-markers");
  if (!markers) return;
  markers.replaceChildren();
  if (hasFavourite(store, chapterIndex, verseIndex)) {
    markers.appendChild(markerIcon("heart", "Saved"));
  }
  if (findNote(store, chapterIndex, verseIndex)) {
    markers.appendChild(markerIcon("note", "Has a note"));
  }
}

/**
 * The action row shown for a selected verse: save, note, copy.
 * Shared by the chapter list and the single-verse view.
 */
export async function buildVerseActions(chapterIndex, verseIndex, text, { onChanged } = {}) {
  const store = await loadStoreQuietly();
  const isFav = hasFavourite(store, chapterIndex, verseIndex);
  const hasNote = Boolean(findNote(store, chapterIndex, verseIndex));

  const favBtn = el("button", {
    type: "button",
    class: `btn-action btn-fav ${isFav ? "is-fav" : ""}`.trim(),
    "aria-pressed": isFav ? "true" : "false",
  });
  const paintFav = (value) => {
    favBtn.classList.toggle("is-fav", value);
    favBtn.setAttribute("aria-pressed", value ? "true" : "false");
    favBtn.title = value ? "Remove from Favourites" : "Add to Favourites";
    favBtn.setAttribute("aria-label", favBtn.title);
    favBtn.replaceChildren(
      icon("heart", { size: 15, filled: value }),
      el("span", { class: "btn-action-label", text: value ? "Saved" : "Save" })
    );
  };
  paintFav(isFav);
  favBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    favBtn.disabled = true;
    try {
      const nowFavourite = await toggleFavourite(chapterIndex, verseIndex);
      paintFav(nowFavourite);
      toast(
        nowFavourite
          ? `${formatReference(chapterIndex, verseIndex)} saved`
          : `${formatReference(chapterIndex, verseIndex)} removed`,
        "success"
      );
      onChanged?.();
    } catch (error) {
      reportError(error, "That verse could not be saved.");
    } finally {
      favBtn.disabled = false;
    }
  });

  const noteBtn = el("button", {
    type: "button",
    class: `btn-action btn-note ${hasNote ? "has-note" : ""}`.trim(),
    title: hasNote ? "Edit note" : "Add a note",
    "aria-label": hasNote ? "Edit note" : "Add a note",
  }, [
    icon("note", { size: 15 }),
    el("span", { class: "btn-action-label", text: hasNote ? "Note" : "Note" }),
  ]);
  noteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpenNoteEditor({ chapterIndex, verseIndex, text, onSaved: onChanged });
  });

  const copyBtn = el("button", {
    type: "button",
    class: "btn-action btn-copy",
    title: "Copy verse",
    "aria-label": "Copy verse",
  }, [icon("copy", { size: 15 }), el("span", { class: "btn-action-label", text: "Copy" })]);
  copyBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    copyVerse(chapterIndex, verseIndex, text);
  });

  return el("div", { class: "verse-actions" }, [favBtn, noteBtn, copyBtn]);
}

function renderSingleVerse(data, chapterIndex, verseIndex, store) {
  const text = data[chapterIndex][verseIndex];
  const note = findNote(store, chapterIndex, verseIndex);

  const wrapper = el("div", { class: "single-verse" }, [
    el("p", { class: "single-verse-text", text }),
    el("p", { class: "single-verse-ref", text: formatReference(chapterIndex, verseIndex) }),
  ]);

  if (note) {
    wrapper.appendChild(
      el("blockquote", { class: "verse-note-preview" }, [
        el("span", { class: "verse-note-label", text: "Your note" }),
        el("p", { class: "verse-note-text", text: note.text }),
      ])
    );
  }

  const actionsHost = el("div", { class: "single-verse-actions" });
  wrapper.appendChild(actionsHost);
  buildVerseActions(chapterIndex, verseIndex, text, {
    onChanged: () => showPassage({ chapterIndex, verseIndex, record: false }),
  }).then((actions) => actionsHost.replaceChildren(actions));

  wrapper.appendChild(
    el("button", {
      type: "button",
      class: "button button-quiet read-chapter-btn",
      text: `Read ${formatReference(chapterIndex)}`,
      onClick: () => showPassage({ chapterIndex }),
    })
  );

  return wrapper;
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

export async function copyVerse(chapterIndex, verseIndex, text) {
  const payload = formatVerseForCopy(chapterIndex, verseIndex, text);
  try {
    await navigator.clipboard.writeText(payload);
    toast(`${formatReference(chapterIndex, verseIndex)} copied`, "success");
  } catch (error) {
    console.error("Psalms Way: clipboard write failed", error);
    toast("Your browser blocked the copy. Select the verse and press Ctrl+C.", "error");
  }
}

// ─── Random and daily ─────────────────────────────────────────────────────────

export async function showRandomVerse() {
  try {
    const data = await getData();
    const chapterIndex = Math.floor(Math.random() * data.length);
    const verseIndex = getRandomVerseIndex(data[chapterIndex]);
    await showPassage({ chapterIndex, verseIndex });
  } catch (error) {
    reportError(error, "The Psalms text could not be loaded.");
  }
}

export async function showRandomChapter() {
  try {
    const data = await getData();
    await showPassage({ chapterIndex: Math.floor(Math.random() * data.length) });
  } catch (error) {
    reportError(error, "The Psalms text could not be loaded.");
  }
}
