// ─── Reading view ─────────────────────────────────────────────────────────────
// The primary surface. A chapter is a list of verses; selecting one reveals its
// actions in place rather than putting a permanent button row beside every line.

import { el, emptyState, toast, reportError, byId } from "./dom.js";
import { icon } from "./icons.js";
import {
  CHAPTER_COUNT,
  formatReference,
  formatVerseForCopy,
  getData,
  hasChapter,
  isVerseRef,
  getRandomVerseIndex,
} from "./data.js";
import { addHistoryEntry, hasFavourite, findNote, loadStore, toggleFavourite } from "./storage.js";
import { HIGHLIGHT_COLORS, highlightOf, isFavoriteChapter, setHighlight } from "./phoneData.js";
import { t } from "./i18n.js";
import { readingTextAttributes } from "./versions.js";

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

let onOpenCompare = () => {};

/** Injected by app.js: fn(chapterIndex, verseIndex) opens the Compare panel. */
export function setCompareOpener(fn) {
  onOpenCompare = fn;
}

/** Opens Compare for a verse (the verse actions' Compare button). */
export function openCompareFor(chapterIndex, verseIndex) {
  onOpenCompare(chapterIndex, verseIndex);
}

/**
 * Paints the chapter-bar heart for the current Psalm: filled when it is one of the
 * reader's favourites. Runs after every passage render and after the heart is clicked.
 */
export function refreshFavChapter(store) {
  const button = byId("btnFavChapter");
  if (!button) return;
  const favourite = isFavoriteChapter(store, state.chapterIndex);
  const label = favourite
    ? t("chapterFavouriteRemove", {}, "Remove this Psalm from Favourites")
    : t("chapterFavouriteAdd", {}, "Add this Psalm to Favourites");
  button.setAttribute("aria-pressed", favourite ? "true" : "false");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.replaceChildren(icon("heart", { size: 16, filled: favourite }));
}

// ─── Highlight colours ────────────────────────────────────────────────────────

const HIGHLIGHT_NAMES = {
  yellow: () => t("highlightYellow", {}, "Yellow"),
  green: () => t("highlightGreen", {}, "Green"),
  blue: () => t("highlightBlue", {}, "Blue"),
  pink: () => t("highlightPink", {}, "Pink"),
};

/** A highlight colour's name in the reader's language. Shared with the Library. */
export function highlightLabel(color) {
  if (!Object.hasOwn(HIGHLIGHT_NAMES, color)) throw new Error(`Unknown highlight colour: ${color}`);
  return HIGHLIGHT_NAMES[color]();
}

/** What a screen reader hears for a highlighted verse, where the tint is only seen. */
function highlightedText(color) {
  return t("highlightedColour", { color: highlightLabel(color) }, "Highlighted: {{color}}");
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

  // Every version numbers its Psalms 1 to 150, but a few leave some out.
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= CHAPTER_COUNT) {
    reportError(
      new Error(`Chapter ${chapterIndex} is out of range`),
      t("psalmDoesNotExist", {}, "That Psalm does not exist.")
    );
    return;
  }
  const missing = !hasChapter(data, chapterIndex);
  if (missing || (verseIndex !== null && !isVerseRef(data, chapterIndex, verseIndex))) {
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
    missing
      ? renderMissingChapter(chapterIndex)
      : verseIndex === null
        ? renderChapter(data, chapterIndex, store)
        : renderSingleVerse(data, chapterIndex, verseIndex, store)
  );
  content.scrollTop = 0;
  refreshFavChapter(store);

  // A Psalm this version lacks was not read, so it is not history.
  if (record && !missing) {
    addHistoryEntry(chapterIndex, verseIndex).catch((error) => {
      // History is a convenience; a failure here must not interrupt reading.
      console.error("Psalms Way: could not record history", error);
    });
  }
}

/** Re-renders the current passage after cloud sync changed saved data, keeping the scroll position. */
export async function refreshPassage() {
  const view = byId("readingView");
  const top = view?.scrollTop ?? 0;
  await showPassage({
    chapterIndex: state.chapterIndex,
    verseIndex: state.verseIndex,
    record: false,
  });
  if (view) view.scrollTop = top;
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
      el("p", {
        class: "panel-empty-title",
        text: t("psalmsLoadFailed", {}, "The Psalms text could not be loaded."),
      }),
      el("p", {
        class: "panel-empty-hint",
        text: t(
          "psalmsLoadFailedHint",
          {},
          "Reopen the extension. If this keeps happening, reinstall it from chrome://extensions."
        ),
      }),
    ])
  );
}

function renderMissingChapter(chapterIndex) {
  const message = emptyState(
    t(
      "versionMissingPsalm",
      { number: chapterIndex + 1 },
      "This version does not include Psalm {{number}}."
    )
  );
  message.classList.add("chapter-missing");
  message.appendChild(
    el("button", {
      type: "button",
      class: "button",
      text: t("versionChooseAnother", {}, "Choose another version"),
      onClick: () => byId("btnVersion")?.click(),
    })
  );
  return message;
}

function renderChapter(data, chapterIndex, store) {
  const list = el("ol", {
    class: "verses",
    "aria-label": t(
      "chapterVerseCount",
      { reference: formatReference(chapterIndex), count: data[chapterIndex].length },
      "{{reference}}, {{count}} verses"
    ),
  });

  // The Bible's language and direction go on the verse text alone (see versions.js).
  const textAttributes = readingTextAttributes();
  data[chapterIndex].forEach((text, verseIndex) => {
    list.appendChild(renderVerseRow(chapterIndex, verseIndex, text, store, textAttributes));
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
  // The action row sits inside the verse, so its buttons' keys bubble up to here.
  // They belong to the buttons: Enter and Space press them, arrows are theirs.
  if (event.target.closest?.(".verse-actions")) return;

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

function renderVerseRow(chapterIndex, verseIndex, text, store, textAttributes) {
  const body = el("div", { class: "verse-body", role: "button", tabindex: "-1" }, [
    el("span", { class: "verse-num", text: String(verseIndex + 1), "aria-hidden": "true" }),
    el("span", { class: "verse-text", text, ...textAttributes }),
  ]);
  body.setAttribute("aria-expanded", "false");
  body.setAttribute("aria-label", `${formatReference(chapterIndex, verseIndex)}. ${text}`);

  const row = el("li", { class: "verse", tabindex: "-1" }, [
    body,
    el("span", { class: "verse-markers" }),
  ]);
  row.dataset.chapter = String(chapterIndex);
  row.dataset.verse = String(verseIndex);
  paintVerseState(row, store, chapterIndex, verseIndex);

  body.addEventListener("click", () => toggleVerseActions(row, chapterIndex, verseIndex, text));
  return row;
}

/** Shows what is saved on a verse: its highlight tint, and its bookmark and note markers. */
function paintVerseState(row, store, chapterIndex, verseIndex) {
  const color = highlightOf(store, chapterIndex, verseIndex);
  const body = row.querySelector(".verse-body");
  if (color) body.dataset.highlight = color;
  else delete body.dataset.highlight;

  const markers = row.querySelector(".verse-markers");
  markers.replaceChildren();
  if (hasFavourite(store, chapterIndex, verseIndex)) {
    markers.appendChild(markerIcon("bookmark", t("bookmarked", {}, "Bookmarked")));
  }
  if (findNote(store, chapterIndex, verseIndex)) {
    markers.appendChild(markerIcon("note", t("hasNote", {}, "Has a note")));
  }
  if (color) markers.appendChild(el("span", { class: "sr-only", text: highlightedText(color) }));
}

function markerIcon(name, label) {
  const wrapper = el("span", { class: `verse-marker verse-marker-${name}`, title: label });
  wrapper.appendChild(icon(name, { size: 12, filled: name === "bookmark" }));
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
    onChanged: async () => paintVerseState(row, await loadStoreQuietly(), chapterIndex, verseIndex),
  });
  row.appendChild(actions);
  actions.querySelector("button")?.focus();
}

/**
 * The Highlight button and the inline colour choices it opens: the phone's four
 * colours and "None". Choosing one saves it, closes the choices and calls `onChanged`.
 */
function buildHighlightControls(chapterIndex, verseIndex, initial, onChanged) {
  let current = initial;
  const reference = formatReference(chapterIndex, verseIndex);
  const colourLabel = t("highlightColour", {}, "Highlight colour");

  const dot = el("span", { class: "hl-dot", "aria-hidden": "true" });
  const button = el(
    "button",
    { type: "button", class: "btn-action btn-highlight", "aria-expanded": "false" },
    [dot, el("span", { class: "btn-action-label", text: t("highlight", {}, "Highlight") })]
  );

  const swatches = HIGHLIGHT_COLORS.map((color) =>
    el("button", {
      type: "button",
      class: "hl-swatch",
      title: highlightLabel(color),
      "aria-label": highlightLabel(color),
      dataset: { highlight: color },
    })
  );
  const none = el("button", {
    type: "button",
    class: "btn-action hl-none",
    text: t("highlightNone", {}, "None"),
    title: t("removeHighlight", {}, "Remove Highlight"),
  });
  const picker = el(
    "div",
    { class: "highlight-picker", role: "group", "aria-label": colourLabel, hidden: true },
    [...swatches, none]
  );

  const paint = () => {
    // The button's name says which colour the verse has, since the dot is colour alone.
    const name = current ? highlightLabel(current) : t("highlightNone", {}, "None");
    const label = t("highlightColourIs", { color: name }, "Highlight colour: {{color}}");
    button.title = label;
    button.setAttribute("aria-label", label);
    dot.dataset.highlight = current ?? "none";
    none.setAttribute("aria-pressed", current === null ? "true" : "false");
    for (const swatch of swatches) {
      const selected = swatch.dataset.highlight === current;
      swatch.setAttribute("aria-pressed", selected ? "true" : "false");
      swatch.replaceChildren(...(selected ? [icon("check", { size: 14 })] : []));
    }
  };
  const setOpen = (open) => {
    picker.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const choose = async (color) => {
    setOpen(false);
    button.focus();
    if (color === current) return;
    try {
      await setHighlight(chapterIndex, verseIndex, color);
    } catch (error) {
      reportError(error, t("highlightSaveError", {}, "That highlight could not be saved."));
      return;
    }
    current = color;
    paint();
    toast(
      color
        ? t("highlightApplied", { reference }, "{{reference}} highlighted")
        : t("highlightCleared", { reference }, "Highlight removed from {{reference}}"),
      "success"
    );
    onChanged?.("highlight");
  };

  // Opening moves focus to the colour already chosen (or the first), so keyboard readers start there.
  const startingSwatch = () => swatches.find((s) => s.dataset.highlight === current) ?? swatches[0];
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = picker.hidden;
    setOpen(opening);
    if (opening) startingSwatch().focus();
  });
  swatches.forEach((swatch) =>
    swatch.addEventListener("click", (event) => {
      event.stopPropagation();
      choose(swatch.dataset.highlight);
    })
  );
  none.addEventListener("click", (event) => {
    event.stopPropagation();
    choose(null);
  });

  paint();
  return { button, picker };
}

/**
 * The action row shown for a selected verse: bookmark, highlight, note, copy and
 * compare. Shared by the chapter list and the single-verse view.
 *
 * `onChanged` runs after a change is saved. A bookmark or highlight change passes
 * the button's class suffix ("fav" or "highlight") so a caller that rebuilds the
 * row can put focus back on the control that was used.
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
    favBtn.title = value
      ? t("bookmarkRemove", {}, "Remove bookmark")
      : t("bookmarkAdd", {}, "Bookmark this verse");
    favBtn.setAttribute("aria-label", favBtn.title);
    favBtn.replaceChildren(
      icon("bookmark", { size: 15, filled: value }),
      el("span", {
        class: "btn-action-label",
        text: value ? t("bookmarked", {}, "Bookmarked") : t("bookmark", {}, "Bookmark"),
      })
    );
  };
  paintFav(isFav);
  favBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    favBtn.disabled = true;
    try {
      const nowFavourite = await toggleFavourite(chapterIndex, verseIndex);
      paintFav(nowFavourite);
      const reference = formatReference(chapterIndex, verseIndex);
      toast(
        nowFavourite
          ? t("bookmarkAdded", { reference }, "{{reference}} bookmarked")
          : t("bookmarkRemoved", { reference }, "{{reference}} removed"),
        "success"
      );
      onChanged?.("fav");
    } catch (error) {
      reportError(error, t("bookmarkSaveError", {}, "That bookmark could not be saved."));
    } finally {
      favBtn.disabled = false;
    }
  });

  const noteLabel = hasNote ? t("noteEdit", {}, "Edit note") : t("noteAdd", {}, "Add a note");
  const noteBtn = el(
    "button",
    {
      type: "button",
      class: `btn-action btn-note ${hasNote ? "has-note" : ""}`.trim(),
      title: noteLabel,
      "aria-label": noteLabel,
    },
    [
      icon("note", { size: 15 }),
      el("span", { class: "btn-action-label", text: t("note", {}, "Note") }),
    ]
  );
  noteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpenNoteEditor({ chapterIndex, verseIndex, text, onSaved: onChanged });
  });

  const copyLabel = t("copyVerse", {}, "Copy verse");
  const copyBtn = el(
    "button",
    {
      type: "button",
      class: "btn-action btn-copy",
      title: copyLabel,
      "aria-label": copyLabel,
    },
    [
      icon("copy", { size: 15 }),
      el("span", { class: "btn-action-label", text: t("copy", {}, "Copy") }),
    ]
  );
  copyBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    copyVerse(chapterIndex, verseIndex, text);
  });

  const highlight = buildHighlightControls(
    chapterIndex,
    verseIndex,
    highlightOf(store, chapterIndex, verseIndex),
    onChanged
  );

  const compareLabel = t("compareVerse", {}, "Compare this verse");
  const compareBtn = el(
    "button",
    {
      type: "button",
      class: "btn-action btn-compare",
      title: compareLabel,
      "aria-label": compareLabel,
    },
    [
      icon("compare", { size: 15 }),
      el("span", { class: "btn-action-label", text: t("compare", {}, "Compare") }),
    ]
  );
  compareBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openCompareFor(chapterIndex, verseIndex);
  });

  return el("div", { class: "verse-actions" }, [
    favBtn,
    highlight.button,
    noteBtn,
    copyBtn,
    compareBtn,
    highlight.picker,
  ]);
}

/** When the single verse's action row has been put on the page (it is built after the verse). */
let singleVerseActions = Promise.resolve();

/**
 * Re-renders a single verse after a change. That destroys the button that was just
 * used, so focus is put back on its replacement, but only if focus was lost: a reader
 * who has already moved on keeps where they are.
 */
async function repaintSingleVerse(chapterIndex, verseIndex, action) {
  await showPassage({ chapterIndex, verseIndex, record: false });
  await singleVerseActions;
  const lost = !document.activeElement || document.activeElement === document.body;
  if (action && lost) document.querySelector(`.single-verse-actions .btn-${action}`)?.focus();
}

function renderSingleVerse(data, chapterIndex, verseIndex, store) {
  const text = data[chapterIndex][verseIndex];
  const note = findNote(store, chapterIndex, verseIndex);
  const color = highlightOf(store, chapterIndex, verseIndex);

  const wrapper = el("div", { class: "single-verse" }, [
    el("p", {
      class: "single-verse-text",
      text,
      "data-highlight": color,
      ...readingTextAttributes(),
    }),
    el("p", { class: "single-verse-ref", text: formatReference(chapterIndex, verseIndex) }),
    color ? el("span", { class: "sr-only", text: highlightedText(color) }) : null,
  ]);

  if (note) {
    wrapper.appendChild(
      el("blockquote", { class: "verse-note-preview" }, [
        el("span", { class: "verse-note-label", text: t("yourNote", {}, "Your note") }),
        el("p", { class: "verse-note-text", text: note.text }),
      ])
    );
  }

  const actionsHost = el("div", { class: "single-verse-actions" });
  wrapper.appendChild(actionsHost);
  singleVerseActions = buildVerseActions(chapterIndex, verseIndex, text, {
    onChanged: (action) => repaintSingleVerse(chapterIndex, verseIndex, action),
  }).then((actions) => actionsHost.replaceChildren(actions));

  wrapper.appendChild(
    el("button", {
      type: "button",
      class: "button button-quiet read-chapter-btn",
      text: t("readPsalm", { reference: formatReference(chapterIndex) }, "Read {{reference}}"),
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
    toast(
      t(
        "verseCopied",
        { reference: formatReference(chapterIndex, verseIndex) },
        "{{reference}} copied"
      ),
      "success"
    );
  } catch (error) {
    console.error("Psalms Way: clipboard write failed", error);
    toast(
      t("copyBlocked", {}, "Your browser blocked the copy. Select the verse and press Ctrl+C."),
      "error"
    );
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
    reportError(error, t("psalmsLoadFailed", {}, "The Psalms text could not be loaded."));
  }
}

export async function showRandomChapter() {
  try {
    const data = await getData();
    await showPassage({ chapterIndex: Math.floor(Math.random() * data.length) });
  } catch (error) {
    reportError(error, t("psalmsLoadFailed", {}, "The Psalms text could not be loaded."));
  }
}
