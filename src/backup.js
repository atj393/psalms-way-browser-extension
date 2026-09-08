// ─── Backup ───────────────────────────────────────────────────────────────────
// Manual export and import of personal data as a versioned JSON file.
//
// Why this rather than chrome.storage.sync: sync allows roughly 100 KB in
// total and 8 KB per item, and it rejects writes past that quota. Notes are
// free text, so a reader who writes steadily would eventually hit the ceiling
// and have saves start failing — the one outcome worth avoiding in a tool
// people trust with their own words. Export/import has no quota, no account,
// no network, and works across browsers and profiles. Local storage stays
// authoritative.

import {
  SCHEMA_VERSION,
  normaliseStore,
  sanitiseSettings,
} from "./storage.js";

export const BACKUP_TYPE = "psalms-way-browser-backup";
export const BACKUP_SCHEMA_VERSION = 1;

/** Refuse anything larger than this. Real backups are a few tens of KB. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export class BackupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

/**
 * Build the backup document for the current store.
 * Only user-created data is included. The bundled scripture, icons and caches
 * are part of the extension package and would be dead weight in a backup.
 */
export function createBackup(store, extensionVersion, now = new Date()) {
  return {
    type: BACKUP_TYPE,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    extensionVersion: String(extensionVersion ?? "unknown"),
    createdAt: now.toISOString(),
    data: {
      favourites: store.favourites ?? [],
      notes: store.notes ?? [],
      history: store.history ?? [],
      settings: store.settings ?? {},
    },
  };
}

export function backupFileName(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `psalms-way-backup-${stamp}.json`;
}

/**
 * Parse and validate a backup file.
 *
 * Imported JSON is treated as hostile: it may come from a different product, a
 * newer version, a corrupted download, or someone's idea of a joke. Everything
 * that survives has been through the same sanitisers as stored data, so a
 * restore cannot inject a shape the rest of the app has not already handled.
 *
 * @param {string} text raw file contents
 * @returns {{data: object, counts: {favourites: number, notes: number, history: number}}}
 */
export function parseBackup(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new BackupError("That file is empty.", "empty");
  }
  if (byteLength(text) > MAX_BACKUP_BYTES) {
    throw new BackupError("That file is too large to be a Psalms Way backup.", "too_large");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("That file is not valid JSON.", "invalid_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BackupError("That file is not a Psalms Way backup.", "wrong_shape");
  }
  if (parsed.type !== BACKUP_TYPE) {
    throw new BackupError("That file is not a Psalms Way backup.", "wrong_type");
  }
  if (!Number.isInteger(parsed.schemaVersion)) {
    throw new BackupError("That backup is missing its version.", "missing_version");
  }
  if (parsed.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new BackupError(
      "That backup was made by a newer version of Psalms Way.",
      "future_version"
    );
  }
  if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    throw new BackupError("That backup has no data in it.", "no_data");
  }

  // Reuse the store sanitisers: identical rules for stored and imported data.
  const normalised = normaliseStore({
    schemaVersion: SCHEMA_VERSION,
    favourites: parsed.data.favourites,
    notes: parsed.data.notes,
    history: parsed.data.history,
    settings: sanitiseSettings(parsed.data.settings),
  });

  const counts = {
    favourites: normalised.favourites.length,
    notes: normalised.notes.length,
    history: normalised.history.length,
  };

  if (counts.favourites === 0 && counts.notes === 0 && counts.history === 0) {
    throw new BackupError("That backup contains nothing to restore.", "no_records");
  }

  return { data: normalised, counts };
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}
