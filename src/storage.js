// ─── Storage ──────────────────────────────────────────────────────────────────
// The single place that talks to chrome.storage.local. Owns defaults,
// validation, migration and error normalisation so that no view has to.
//
// Two rules drive the design:
//
//   1. A failed write is never reported as a success. The previous code caught
//      every storage error and discarded it, so a verse could appear saved
//      while nothing reached disk. Writes here reject with a StorageError and
//      the caller shows a message.
//   2. Stored data is untrusted. Users upgrade from older versions, restore
//      backups, and edit storage by hand during development. Every record is
//      validated on read; anything malformed is dropped rather than allowed to
//      throw halfway through rendering.

import { CHAPTER_COUNT } from "./data.js";

export const SCHEMA_VERSION = 2;

const STORE_KEY = "psalmsway";

// v1 keys, still written by released version 1.1.
const LEGACY_FAVOURITES = "psalmsway_favourites";
const LEGACY_HISTORY = "psalmsway_history";
const LEGACY_SETTINGS = "psalmsway_settings";

export const HISTORY_MAX = 50;
export const NOTE_MAX_LENGTH = 2000;
export const NOTES_MAX = 500;

export const THEMES = ["light", "sepia", "dark"];
export const FONT_SIZES = ["small", "medium", "large"];

/** A storage operation that genuinely failed. Surfaced to the user. */
export class StorageError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.cause = cause;
  }
}

export function defaultSettings() {
  return {
    theme: "light",
    fontSize: "medium",
    lang: "en",
    toolbarCollapsed: false,
  };
}

export function defaultStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    favourites: [],
    notes: [],
    history: [],
    settings: defaultSettings(),
  };
}

// ─── chrome.storage plumbing ──────────────────────────────────────────────────

function storageArea() {
  const area = globalThis.chrome?.storage?.local;
  if (!area) {
    throw new StorageError("Browser storage is unavailable.", "unavailable");
  }
  return area;
}

export function isStorageAvailable() {
  return Boolean(globalThis.chrome?.storage?.local);
}

async function readRaw(keys) {
  try {
    return await storageArea().get(keys);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError("Could not read saved data.", "read_failed", error);
  }
}

async function writeRaw(items) {
  try {
    await storageArea().set(items);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    const message = String(error?.message ?? "");
    if (/quota/i.test(message)) {
      throw new StorageError("There is no room left in browser storage.", "quota_exceeded", error);
    }
    throw new StorageError("Changes could not be saved.", "write_failed", error);
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isChapterIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < CHAPTER_COUNT;
}

function isVerseIndex(value) {
  // Verse counts differ per chapter; the exact upper bound is checked against
  // the loaded text at render time. Here we only reject impossible shapes.
  return Number.isInteger(value) && value >= 0 && value < 1000;
}

function isTimestamp(value) {
  return Number.isFinite(value) && value > 0 && value <= 4102444800000; // < year 2100
}

function coerceTimestamp(value) {
  return isTimestamp(value) ? value : Date.now();
}

export function sanitiseFavourite(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { chapterIndex, verseIndex } = entry;
  if (!isChapterIndex(chapterIndex) || !isVerseIndex(verseIndex)) return null;
  return { chapterIndex, verseIndex, addedAt: coerceTimestamp(entry.addedAt) };
}

export function sanitiseHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { chapterIndex } = entry;
  if (!isChapterIndex(chapterIndex)) return null;
  const verseIndex = isVerseIndex(entry.verseIndex) ? entry.verseIndex : null;
  return { chapterIndex, verseIndex, viewedAt: coerceTimestamp(entry.viewedAt) };
}

export function sanitiseNote(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { chapterIndex, verseIndex } = entry;
  if (!isChapterIndex(chapterIndex) || !isVerseIndex(verseIndex)) return null;
  if (typeof entry.text !== "string") return null;
  const text = entry.text.trim().slice(0, NOTE_MAX_LENGTH);
  if (text === "") return null;
  const createdAt = coerceTimestamp(entry.createdAt);
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : makeNoteId(chapterIndex, verseIndex),
    chapterIndex,
    verseIndex,
    text,
    createdAt,
    updatedAt: isTimestamp(entry.updatedAt) ? entry.updatedAt : createdAt,
  };
}

export function sanitiseSettings(value) {
  const base = defaultSettings();
  if (!value || typeof value !== "object") return base;
  return {
    theme: THEMES.includes(value.theme) ? value.theme : base.theme,
    fontSize: FONT_SIZES.includes(value.fontSize) ? value.fontSize : base.fontSize,
    lang: typeof value.lang === "string" && /^[a-z]{2}$/.test(value.lang) ? value.lang : base.lang,
    toolbarCollapsed:
      typeof value.toolbarCollapsed === "boolean" ? value.toolbarCollapsed : base.toolbarCollapsed,
  };
}

function sanitiseList(value, sanitiser, limit) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const clean = sanitiser(item);
    if (clean) out.push(clean);
    if (limit && out.length >= limit) break;
  }
  return out;
}

/** Deduplicate favourites/notes that point at the same verse, keeping the first. */
function dedupeByVerse(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.chapterIndex}:${item.verseIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function makeNoteId(chapterIndex, verseIndex) {
  return `n_${chapterIndex}_${verseIndex}`;
}

/**
 * Normalise any candidate object into a valid v2 store.
 * Never throws: unusable pieces fall back to their defaults.
 */
export function normaliseStore(candidate) {
  const base = defaultStore();
  if (!candidate || typeof candidate !== "object") return base;
  return {
    schemaVersion: SCHEMA_VERSION,
    favourites: dedupeByVerse(sanitiseList(candidate.favourites, sanitiseFavourite)),
    notes: dedupeByVerse(sanitiseList(candidate.notes, sanitiseNote, NOTES_MAX)),
    history: sanitiseList(candidate.history, sanitiseHistoryEntry, HISTORY_MAX),
    settings: sanitiseSettings(candidate.settings),
  };
}

// ─── Migration ────────────────────────────────────────────────────────────────

/**
 * Build a v2 store from the three v1 keys.
 * Pure so that migration can be tested against the exact shape version 1.1
 * writes, without touching a browser.
 */
export function migrateFromLegacy(legacy) {
  return normaliseStore({
    favourites: legacy?.[LEGACY_FAVOURITES],
    history: legacy?.[LEGACY_HISTORY],
    settings: legacy?.[LEGACY_SETTINGS],
    notes: [],
  });
}

let cachedStore = null;

/**
 * Read the whole store, migrating v1 data on first run after the upgrade.
 *
 * Migration is non-destructive and idempotent: the legacy keys are read but
 * never deleted, so a user who rolls back to 1.1 still finds their favourites,
 * and running this twice produces the same result.
 */
export async function loadStore() {
  if (cachedStore) return cachedStore;

  const raw = await readRaw([STORE_KEY, LEGACY_FAVOURITES, LEGACY_HISTORY, LEGACY_SETTINGS]);
  const existing = raw?.[STORE_KEY];

  if (existing && typeof existing === "object") {
    cachedStore = normaliseStore(existing);
    return cachedStore;
  }

  const hasLegacy =
    raw?.[LEGACY_FAVOURITES] !== undefined ||
    raw?.[LEGACY_HISTORY] !== undefined ||
    raw?.[LEGACY_SETTINGS] !== undefined;

  cachedStore = hasLegacy ? migrateFromLegacy(raw) : defaultStore();

  if (hasLegacy) {
    // Persist the migrated shape. A failure here is not fatal: the migration is
    // recomputed from the untouched legacy keys on the next open.
    try {
      await writeRaw({ [STORE_KEY]: cachedStore });
    } catch (error) {
      console.error("Psalms Way: could not persist migrated data", error);
    }
  }

  return cachedStore;
}

/** Test seam. */
export function resetStoreCache() {
  cachedStore = null;
}

/**
 * Apply a change to the store and persist it.
 * The mutator receives a draft it may modify in place or replace by returning
 * a new object. The cache is only advanced once the write succeeds, so a failed
 * save leaves the in-memory state matching what is actually on disk.
 */
export async function updateStore(mutator) {
  const current = await loadStore();
  const draft = structuredClone(current);
  const next = normaliseStore(mutator(draft) ?? draft);
  await writeRaw({ [STORE_KEY]: next });
  cachedStore = next;
  return next;
}

// ─── Favourites ───────────────────────────────────────────────────────────────

export async function getFavourites() {
  return (await loadStore()).favourites;
}

export function hasFavourite(store, chapterIndex, verseIndex) {
  return store.favourites.some(
    (f) => f.chapterIndex === chapterIndex && f.verseIndex === verseIndex
  );
}

export async function isFavourite(chapterIndex, verseIndex) {
  return hasFavourite(await loadStore(), chapterIndex, verseIndex);
}

/** Add or remove in one call. Returns the resulting state. */
export async function toggleFavourite(chapterIndex, verseIndex) {
  let nowFavourite = false;
  await updateStore((draft) => {
    const index = draft.favourites.findIndex(
      (f) => f.chapterIndex === chapterIndex && f.verseIndex === verseIndex
    );
    if (index >= 0) {
      draft.favourites.splice(index, 1);
      nowFavourite = false;
    } else {
      draft.favourites.unshift({ chapterIndex, verseIndex, addedAt: Date.now() });
      nowFavourite = true;
    }
    return draft;
  });
  return nowFavourite;
}

export async function removeFavourite(chapterIndex, verseIndex) {
  await updateStore((draft) => {
    draft.favourites = draft.favourites.filter(
      (f) => !(f.chapterIndex === chapterIndex && f.verseIndex === verseIndex)
    );
    return draft;
  });
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function getNotes() {
  return (await loadStore()).notes;
}

export function findNote(store, chapterIndex, verseIndex) {
  return (
    store.notes.find((n) => n.chapterIndex === chapterIndex && n.verseIndex === verseIndex) ?? null
  );
}

export async function getNote(chapterIndex, verseIndex) {
  return findNote(await loadStore(), chapterIndex, verseIndex);
}

/**
 * Create or replace the note on a verse.
 * An empty note is a deletion, which keeps "clear the box and save" from
 * leaving an invisible empty record behind.
 */
export async function saveNote(chapterIndex, verseIndex, text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") {
    await deleteNote(chapterIndex, verseIndex);
    return null;
  }
  if (trimmed.length > NOTE_MAX_LENGTH) {
    throw new StorageError(`Notes are limited to ${NOTE_MAX_LENGTH} characters.`, "note_too_long");
  }

  let saved = null;
  await updateStore((draft) => {
    const now = Date.now();
    const existing = draft.notes.find(
      (n) => n.chapterIndex === chapterIndex && n.verseIndex === verseIndex
    );
    if (existing) {
      existing.text = trimmed;
      existing.updatedAt = now;
      saved = existing;
    } else {
      if (draft.notes.length >= NOTES_MAX) {
        throw new StorageError(`You can keep up to ${NOTES_MAX} notes.`, "notes_limit");
      }
      saved = {
        id: makeNoteId(chapterIndex, verseIndex),
        chapterIndex,
        verseIndex,
        text: trimmed,
        createdAt: now,
        updatedAt: now,
      };
      draft.notes.unshift(saved);
    }
    return draft;
  });
  return saved;
}

export async function deleteNote(chapterIndex, verseIndex) {
  await updateStore((draft) => {
    draft.notes = draft.notes.filter(
      (n) => !(n.chapterIndex === chapterIndex && n.verseIndex === verseIndex)
    );
    return draft;
  });
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function getHistory() {
  return (await loadStore()).history;
}

/**
 * Record a reading event.
 *
 * History tracks what the reader *opened*: a chapter, or a specific verse when
 * one was singled out. Re-opening something moves it to the top instead of
 * adding a duplicate, so the list stays a useful record of distinct passages
 * rather than a click log.
 */
export function applyHistoryEntry(history, chapterIndex, verseIndex, now = Date.now()) {
  const withoutDuplicate = history.filter(
    (h) => !(h.chapterIndex === chapterIndex && h.verseIndex === verseIndex)
  );
  withoutDuplicate.unshift({ chapterIndex, verseIndex, viewedAt: now });
  return withoutDuplicate.slice(0, HISTORY_MAX);
}

export async function addHistoryEntry(chapterIndex, verseIndex = null) {
  await updateStore((draft) => {
    draft.history = applyHistoryEntry(draft.history, chapterIndex, verseIndex);
    return draft;
  });
}

export async function clearHistory() {
  await updateStore((draft) => {
    draft.history = [];
    return draft;
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings() {
  return (await loadStore()).settings;
}

export async function updateSettings(patch) {
  const next = await updateStore((draft) => {
    draft.settings = sanitiseSettings({ ...draft.settings, ...patch });
    return draft;
  });
  return next.settings;
}

// ─── Backup ───────────────────────────────────────────────────────────────────

/** Replace all user data at once. Used by restore. */
export async function replaceUserData(data) {
  return updateStore((draft) => ({
    ...draft,
    favourites: data.favourites ?? [],
    notes: data.notes ?? [],
    history: data.history ?? [],
    settings: data.settings ?? draft.settings,
  }));
}

export { STORE_KEY, LEGACY_FAVOURITES, LEGACY_HISTORY, LEGACY_SETTINGS };
