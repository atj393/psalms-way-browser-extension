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
//   3. Valid data is never changed on read. Cloud sync brings in what the phone
//      app saved, and anything altered here (a trimmed or shortened note, a
//      dropped duplicate) would be uploaded back as if the reader had edited
//      it. Limits apply to what the reader types, not to what is stored.

import { CHAPTER_COUNT } from "./data.js";
import { t } from "./i18n.js";
import { stableJson } from "./syncMerge.js";

// 3: notes are no longer trimmed or cut on read, history keeps one entry per
// chapter (as the phone app does), and `carry` keeps the phone app's data this
// extension does not show yet.
export const SCHEMA_VERSION = 3;

const STORE_KEY = "psalmsway";

// v1 keys, still written by released version 1.1.
const LEGACY_FAVOURITES = "psalmsway_favourites";
const LEGACY_HISTORY = "psalmsway_history";
const LEGACY_SETTINGS = "psalmsway_settings";

export const HISTORY_MAX = 50;
/** The longest note the editor accepts. Longer notes written on the phone are kept as they are. */
export const NOTE_MAX_LENGTH = 10000;
/** More than the 2,461 verses in the Psalms (one note each), so it only stops absurd input. */
export const NOTES_MAX = 2500;

/** The phone app's data kept untouched until this extension shows it. */
const CARRY_KEYS = ["favorites", "highlights", "streak", "badges", "challenges", "settings"];

export const THEMES = ["light", "sepia", "dark", "auto"];
export const FONT_SIZES = ["small", "medium", "large"];
/** The phone app's five accent colours. */
export const ACCENTS = ["green", "blue", "red", "amber", "purple"];
const MODULE_PATTERN = /^[a-z0-9_]+$/;

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
    accent: "green",
    /** The Bible version's module key; null until chosen from the browser language. */
    bibleVersion: null,
    /** "auto" follows the browser's language. */
    uiLanguage: "auto",
    compareVersions: ["kjv", "web"],
  };
}

export function defaultStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    favourites: [],
    notes: [],
    history: [],
    settings: defaultSettings(),
    carry: {},
  };
}

// ─── chrome.storage plumbing ──────────────────────────────────────────────────

function storageArea() {
  const area = globalThis.chrome?.storage?.local;
  if (!area) {
    throw new StorageError(
      t("storageErrUnavailable", {}, "Browser storage is unavailable."),
      "unavailable"
    );
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
    throw new StorageError(
      t("storageErrRead", {}, "Could not read saved data."),
      "read_failed",
      error
    );
  }
}

async function writeRaw(items) {
  try {
    await storageArea().set(items);
  } catch (error) {
    if (error instanceof StorageError) throw error;
    const message = String(error?.message ?? "");
    if (/quota/i.test(message)) {
      throw new StorageError(
        t("storageErrQuota", {}, "There is no room left in browser storage."),
        "quota_exceeded",
        error
      );
    }
    throw new StorageError(
      t("storageErrWrite", {}, "Changes could not be saved."),
      "write_failed",
      error
    );
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
  const text = entry.text;
  if (text.trim() === "") return null;
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
    accent: ACCENTS.includes(value.accent) ? value.accent : base.accent,
    bibleVersion:
      typeof value.bibleVersion === "string" && MODULE_PATTERN.test(value.bibleVersion)
        ? value.bibleVersion
        : base.bibleVersion,
    uiLanguage:
      value.uiLanguage === "auto" ||
      (typeof value.uiLanguage === "string" && /^[a-z]{2}$/.test(value.uiLanguage))
        ? value.uiLanguage
        : base.uiLanguage,
    compareVersions:
      Array.isArray(value.compareVersions) &&
      value.compareVersions.length === 2 &&
      value.compareVersions.every((m) => typeof m === "string" && MODULE_PATTERN.test(m))
        ? [...value.compareVersions]
        : base.compareVersions,
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

/** Deduplicate favourites that point at the same verse, keeping the first. */
function dedupeByVerse(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.chapterIndex}:${item.verseIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Two texts as one, without repeating either; the phone app's rule. */
export function combineNoteText(first, second) {
  if (first.includes(second)) return first;
  if (second.includes(first)) return second;
  return `${first}\n\n${second}`;
}

/** Two notes on one verse become one, so neither text is lost. */
function joinNotesByVerse(list) {
  const byVerse = new Map();
  for (const note of list) {
    const key = `${note.chapterIndex}:${note.verseIndex}`;
    const first = byVerse.get(key);
    if (!first) {
      byVerse.set(key, note);
      continue;
    }
    byVerse.set(key, {
      ...first,
      text: combineNoteText(first.text, note.text),
      updatedAt: Math.max(first.updatedAt, note.updatedAt),
    });
  }
  return [...byVerse.values()];
}

/** Keeps one entry per chapter, the most recent, newest first (as the phone app stores it). */
function onePerChapter(history) {
  const seen = new Set();
  return [...history]
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .filter((entry) => {
      if (seen.has(entry.chapterIndex)) return false;
      seen.add(entry.chapterIndex);
      return true;
    });
}

/** Keeps the phone app's values as they are; only JSON-safe objects survive storage anyway. */
function sanitiseCarry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const carry = {};
  for (const key of CARRY_KEYS) {
    if (Object.hasOwn(value, key)) carry[key] = value[key];
  }
  return carry;
}

export function makeNoteId(chapterIndex, verseIndex) {
  return `n_${chapterIndex}_${verseIndex}`;
}

/**
 * Normalise any candidate object (a v2 or v3 store) into a valid v3 store.
 * Never throws: unusable pieces fall back to their defaults, and valid records
 * are kept exactly as they are.
 */
export function normaliseStore(candidate) {
  const base = defaultStore();
  if (!candidate || typeof candidate !== "object") return base;
  return {
    schemaVersion: SCHEMA_VERSION,
    favourites: dedupeByVerse(sanitiseList(candidate.favourites, sanitiseFavourite)),
    notes: joinNotesByVerse(sanitiseList(candidate.notes, sanitiseNote, NOTES_MAX)),
    history: onePerChapter(sanitiseList(candidate.history, sanitiseHistoryEntry)).slice(
      0,
      HISTORY_MAX
    ),
    settings: sanitiseSettings(candidate.settings),
    carry: sanitiseCarry(candidate.carry),
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
 * The last value this page asked to write, recorded before the write: Chrome
 * can report the change before the write's promise settles, and the page must
 * still recognise its own save. Compared without key order, because Chrome
 * hands stored objects back with their keys sorted.
 */
let lastWrittenJson = null;

async function writeStore(next) {
  lastWrittenJson = stableJson(next);
  await writeRaw({ [STORE_KEY]: next });
}

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
      await writeStore(cachedStore);
    } catch (error) {
      console.error("Psalms Way: could not persist migrated data", error);
    }
  }

  return cachedStore;
}

/** Test seam, and how the popup forgets a cache that cloud sync outdated. */
export function resetStoreCache() {
  cachedStore = null;
}

/** Whether a stored value is the one this page last wrote, i.e. not someone else's change. */
export function matchesCache(value) {
  const json = stableJson(value);
  return json === lastWrittenJson || (cachedStore !== null && json === stableJson(cachedStore));
}

/**
 * This page's store changes run one at a time. Two changes started together
 * (the daily streak at start-up and a bookmark, say) would otherwise both copy
 * the same store and the second write would undo the first. A failed change
 * still rejects for its own caller; the queue only moves on past it.
 */
let pendingWrite = Promise.resolve();

function oneAtATime(task) {
  const run = pendingWrite.then(task);
  pendingWrite = run.catch(() => {});
  return run;
}

/**
 * Apply a change to the store and persist it.
 * The mutator receives a draft it may modify in place or replace by returning
 * a new object. The cache is only advanced once the write succeeds, so a failed
 * save leaves the in-memory state matching what is actually on disk.
 */
export function updateStore(mutator) {
  return oneAtATime(async () => {
    const current = await loadStore();
    const draft = structuredClone(current);
    const next = normaliseStore(mutator(draft) ?? draft);
    await writeStore(next);
    cachedStore = next;
    return next;
  });
}

/**
 * Read the store from disk, ignoring the cache. Cloud sync runs in the
 * background worker while the popup may also be writing, so it must never
 * work from a cache the popup has outdated.
 */
export async function readFreshStore() {
  cachedStore = null;
  return loadStore();
}

/** Write a whole store (cloud sync's combined data). */
export function saveStore(candidate) {
  return oneAtATime(async () => {
    const next = normaliseStore(candidate);
    await writeStore(next);
    cachedStore = next;
    return next;
  });
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
    throw new StorageError(
      t(
        "storageErrNoteLength",
        { count: NOTE_MAX_LENGTH },
        `Notes are limited to ${NOTE_MAX_LENGTH} characters.`
      ),
      "note_too_long"
    );
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
        throw new StorageError(
          t("storageErrNotesLimit", { count: NOTES_MAX }, `You can keep up to ${NOTES_MAX} notes.`),
          "notes_limit"
        );
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
 * one was singled out. Like the phone app, it keeps one entry per chapter:
 * re-opening a chapter, or a verse in it, moves that chapter to the top with
 * the latest place, so the list stays a useful record rather than a click log
 * and matches the phone once synced.
 */
export function applyHistoryEntry(history, chapterIndex, verseIndex, now = Date.now()) {
  const withoutDuplicate = history.filter((h) => h.chapterIndex !== chapterIndex);
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

/** Replace all user data at once. Used by restore; the phone app's carried data stays. */
export async function replaceUserData(data) {
  return updateStore((draft) => ({
    ...draft,
    favourites: data.favourites ?? [],
    notes: data.notes ?? [],
    history: data.history ?? [],
    settings: data.settings ?? draft.settings,
    carry: data.carry ?? draft.carry,
  }));
}

export { STORE_KEY, LEGACY_FAVOURITES, LEGACY_HISTORY, LEGACY_SETTINGS };
