// ─── Sync: this extension's store <-> the phone app's backup data ─────────────
// The cloud file holds the phone app's data shape: 1-based chapters and
// verses, ISO dates, one history entry per chapter. This extension's store
// counts from 0 and keeps milliseconds. Converting here, in one pure module,
// keeps the views unchanged and makes the round trip testable: data the phone
// wrote must come back out exactly as it went in, or every sync would look
// like an edit.

import { makeNoteId, normaliseStore } from "./storage.js";

function iso(ms) {
  return new Date(ms).toISOString();
}

function msOr(isoString, fallback) {
  const t = typeof isoString === "string" ? Date.parse(isoString) : NaN;
  return Number.isNaN(t) ? fallback : t;
}

/** The phone app's backup `data` for what this browser holds. */
export function toPhoneData(store) {
  const carry = store.carry ?? {};
  return {
    bookmarks: store.favourites.map((f) => ({
      chapter: f.chapterIndex + 1,
      verse: f.verseIndex + 1,
    })),
    favorites: carry.favorites ?? [],
    highlights: carry.highlights ?? [],
    notes: store.notes.map((n) => ({
      chapter: n.chapterIndex + 1,
      verse: n.verseIndex + 1,
      text: n.text,
      date: iso(n.updatedAt),
    })),
    // A whole-chapter entry is the phone's verse 1, where reading starts.
    history: store.history.map((h) => ({
      chapter: h.chapterIndex + 1,
      verse: (h.verseIndex ?? 0) + 1,
      date: iso(h.viewedAt),
    })),
    streak: carry.streak ?? null,
    badges: carry.badges ?? null,
    challenges: carry.challenges ?? null,
    settings: carry.settings ?? {},
  };
}

const isRow = (row) =>
  row && typeof row === "object" && Number.isInteger(row.chapter) && Number.isInteger(row.verse);

/**
 * A new store holding `data`, keeping this browser's own settings and the
 * small details the phone doesn't record (when a bookmark was added here,
 * when a note was first written).
 */
export function fromPhoneData(store, data) {
  const now = Date.now();
  const verseKey = (chapterIndex, verseIndex) => `${chapterIndex}:${verseIndex}`;
  const addedAt = new Map(
    store.favourites.map((f) => [verseKey(f.chapterIndex, f.verseIndex), f.addedAt])
  );
  const createdAt = new Map(
    store.notes.map((n) => [verseKey(n.chapterIndex, n.verseIndex), n.createdAt])
  );

  const list = (value) => (Array.isArray(value) ? value : []);
  return normaliseStore({
    ...store,
    favourites: list(data.bookmarks)
      .filter(isRow)
      .map((b) => {
        const chapterIndex = b.chapter - 1;
        const verseIndex = b.verse - 1;
        return {
          chapterIndex,
          verseIndex,
          addedAt: addedAt.get(verseKey(chapterIndex, verseIndex)) ?? now,
        };
      }),
    notes: list(data.notes)
      .filter((n) => isRow(n) && typeof n.text === "string")
      .map((n) => {
        const chapterIndex = n.chapter - 1;
        const verseIndex = n.verse - 1;
        const updatedAt = msOr(n.date, now);
        return {
          id: makeNoteId(chapterIndex, verseIndex),
          chapterIndex,
          verseIndex,
          text: n.text,
          createdAt: Math.min(
            createdAt.get(verseKey(chapterIndex, verseIndex)) ?? updatedAt,
            updatedAt
          ),
          updatedAt,
        };
      }),
    history: list(data.history)
      .filter(isRow)
      .map((h) => ({
        chapterIndex: h.chapter - 1,
        verseIndex: h.verse === 1 ? null : h.verse - 1,
        viewedAt: msOr(h.date, now),
      })),
    carry: {
      favorites: list(data.favorites),
      highlights: list(data.highlights),
      streak: data.streak ?? null,
      badges: data.badges ?? null,
      challenges: data.challenges ?? null,
      settings: data.settings && typeof data.settings === "object" ? data.settings : {},
    },
  });
}
