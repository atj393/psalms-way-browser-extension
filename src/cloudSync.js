// ─── Cloud sync with the phone app ────────────────────────────────────────────
// Keeps this browser and the Psalms Way phone app in step through one file in
// the reader's own Google Drive (the private app folder both apps share).
// Runs only in the background worker, so a sync finishes even if the popup
// closes, and one run at a time.
//
// Invariants (the same as the phone's services/backup/cloudSyncService.ts):
//  - Data is combined (syncMerge.js) before anything is written anywhere.
//    Connect and "get my data back" keep everything from both sides; other
//    runs combine three ways against what this browser and the cloud last
//    agreed on, so deletions made on either device stick.
//  - A run uploads only when the cloud differs from this browser, so the two
//    devices never keep re-uploading each other's file.
//  - A browser that suddenly holds nothing never empties a cloud copy that
//    had data on its own; the reader chooses.
//  - Automatic runs never show anything; failures are recorded for the panel.

import * as googleAuth from "./googleAuth.js";
import {
  BACKUP_FILENAME,
  DriveError,
  PREVIOUS_BACKUP_FILENAME,
  downloadFile,
  fetchAccountEmail,
  findFile,
  unreadableBackupFilename,
  uploadFile,
} from "./drive.js";
import { isEmptyData, mergeBackupData, same } from "./syncMerge.js";
import { fromPhoneData, toPhoneData } from "./syncModel.js";
import { readFreshStore, saveStore } from "./storage.js";

export const SYNC_STATE_KEY = "cloudSync";
const BACKUP_TYPE = "psalms-way-backup";
const BACKUP_SCHEMA_VERSION = 1;

/** Failures a later automatic run can fix on its own. */
export const TRANSIENT_ERRORS = ["network", "quota", "server", "unknown"];

const INITIAL = {
  email: null,
  lastSyncAt: null,
  remoteModifiedTime: null,
  lastError: null,
  /** "reconnect" | "empty-local" | null */
  attention: null,
  previousSaved: false,
  unreadableKeptAsideAt: null,
  /** What this browser and the cloud last agreed on (phone data shape), or null. */
  base: null,
  lastSyncHadData: false,
};

/** Test seam: the sign-in implementation. */
let auth = googleAuth;
export function setAuthForTests(implementation) {
  auth = implementation ?? googleAuth;
}

// ─── State ────────────────────────────────────────────────────────────────────

export async function getSyncState() {
  const stored = (await chrome.storage.local.get(SYNC_STATE_KEY))[SYNC_STATE_KEY];
  return stored && typeof stored === "object" ? { ...INITIAL, ...stored } : { ...INITIAL };
}

async function patchState(change) {
  const next =
    typeof change === "function"
      ? change(await getSyncState())
      : { ...(await getSyncState()), ...change };
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: next });
  return next;
}

/** What the popup shows: everything but the stored data itself. */
export async function getStatus() {
  const state = await getSyncState();
  delete state.base; // a fresh copy, and the popup has no use for the synced data
  return { ...state, configured: auth.isSignInConfigured(), icon: iconFor(state) };
}

/** "off", "ok" or "attention", as on the phone's header icon. */
export function iconFor(state) {
  if (!auth.isSignInConfigured() || !state.email) return "off";
  const needsReader = state.lastError !== null && !TRANSIENT_ERRORS.includes(state.lastError);
  return state.attention || needsReader ? "attention" : "ok";
}

// ─── Running ──────────────────────────────────────────────────────────────────

const fail = (code, detail = code) => ({ ok: false, code, detail });
const NO_CHANGE = { ok: true, uploaded: false, addedFromCloud: 0 };

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

function codeForDrive(error) {
  if (error.kind === "auth") return "auth-expired";
  if (error.kind === "storage-full") return "drive-full";
  return error.kind;
}

async function recordFailure(result) {
  await patchState((state) => ({
    ...state,
    lastError: result.code,
    // The empty-browser guard is never replaced: once access works again, an
    // automatic run would otherwise upload the empty browser over the backup.
    attention:
      state.attention === "empty-local"
        ? "empty-local"
        : result.code === "auth-expired"
          ? "reconnect"
          : state.attention,
  }));
  return result;
}

/** The phone app's validateBackup: strict about the envelope, tolerant inside it. */
export function parseCloudBackup(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: "unreadable" };
  }
  if (!value || typeof value !== "object" || value.type !== BACKUP_TYPE)
    return { ok: false, code: "unreadable" };
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1)
    return { ok: false, code: "unreadable" };
  if (value.schemaVersion > BACKUP_SCHEMA_VERSION) return { ok: false, code: "future-version" };
  const d = value.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return { ok: false, code: "unreadable" };
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    ok: true,
    data: {
      bookmarks: list(d.bookmarks),
      favorites: list(d.favorites),
      highlights: list(d.highlights),
      notes: list(d.notes),
      history: list(d.history),
      streak: d.streak ?? null,
      badges: d.badges ?? null,
      challenges: d.challenges ?? null,
      settings:
        d.settings && typeof d.settings === "object" && !Array.isArray(d.settings)
          ? d.settings
          : {},
    },
  };
}

function envelope(data) {
  const version = globalThis.chrome?.runtime?.getManifest?.().version ?? "unknown";
  return JSON.stringify({
    type: BACKUP_TYPE,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: `browser-${version}`,
    createdAt: new Date().toISOString(),
    data,
  });
}

/**
 * Combines `remote` into this browser and saves the result, retrying if the
 * popup saved something in between. Returns the browser's data afterwards.
 */
async function combineIntoBrowser(remote, base) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const store = await readFreshStore();
    const local = toPhoneData(store);
    const merged = mergeBackupData(local, remote, base);
    // The phone app owns its settings; this browser only carries them, so the
    // cloud's copy wins (the shared rules keep the device's own settings).
    merged.data.settings = remote.settings;
    if (same(merged.data, local)) return { data: local, addedFromCloud: 0 };
    // Only write if nothing changed since the read above.
    const check = await readFreshStore();
    if (!same(toPhoneData(check), local)) continue;
    const saved = await saveStore(fromPhoneData(check, merged.data));
    return { data: toPhoneData(saved), addedFromCloud: merged.addedFromCloud };
  }
  throw new Error("This browser kept changing while combining; try again");
}

async function run({ forceCombine, automatic, onlyIfLocalChanged, allowEmpty }) {
  const state = await getSyncState();
  if (!state.email) return fail("not-signed-in");

  const local = toPhoneData(await readFreshStore());
  const localChanged = !same(local, state.base);
  if (onlyIfLocalChanged && !localChanged) return NO_CHANGE;

  const emptyGuard =
    state.attention === "empty-local" || (isEmptyData(local) && state.lastSyncHadData);
  if (!forceCombine && !allowEmpty && emptyGuard) {
    await patchState({ attention: "empty-local" });
    return fail("empty-local", "Sync is paused until you choose what to keep");
  }

  // Reconnecting is the reader's action; retrying would only fail again.
  if (automatic && state.attention === "reconnect") return NO_CHANGE;

  const token = await auth.getAccessToken(state.email);
  if (!token) return recordFailure(fail("auth-expired", "Google needs you to sign in again"));

  try {
    let snapshot = local;
    let addedFromCloud = 0;
    let keptAside = false;
    let previousSaved = state.previousSaved;
    let remoteData = null;

    const remote = await findFile(token, BACKUP_FILENAME);
    const remoteChanged =
      remote !== null && (remote.modifiedTime ?? null) !== state.remoteModifiedTime;

    // Every automatic run checks the cloud, so changes made on the phone
    // arrive even when this browser changed nothing.
    if (automatic && !localChanged && !remoteChanged) return NO_CHANGE;

    if (remote && (forceCombine || remoteChanged)) {
      const raw = await downloadFile(token, remote.id);
      const parsed = parseCloudBackup(raw);
      if (!parsed.ok && parsed.code === "future-version") {
        return recordFailure(
          fail("incompatible-backup", "The backup was made by a newer app version")
        );
      }
      if (!parsed.ok) {
        // Keep an unreadable copy aside rather than overwrite it.
        await uploadFile(token, unreadableBackupFilename(), raw);
        keptAside = true;
        await patchState({ unreadableKeptAsideAt: new Date().toISOString() });
      } else {
        if (forceCombine && !previousSaved) {
          await uploadFile(token, PREVIOUS_BACKUP_FILENAME, raw);
          previousSaved = true;
          await patchState({ previousSaved: true });
        }
        remoteData = parsed.data;
        const combined = await combineIntoBrowser(parsed.data, forceCombine ? null : state.base);
        snapshot = combined.data;
        addedFromCloud = combined.addedFromCloud;
      }
    }

    const cloudMatches =
      !forceCombine &&
      !allowEmpty &&
      remote !== null &&
      !keptAside &&
      (remoteData !== null
        ? same(remoteData, snapshot)
        : !remoteChanged && same(snapshot, state.base));

    let remoteModifiedTime = remote?.modifiedTime ?? null;
    if (!cloudMatches) {
      const file = await uploadFile(token, BACKUP_FILENAME, envelope(snapshot));
      remoteModifiedTime = file.modifiedTime ?? null;
    }
    await patchState({
      lastSyncAt: new Date().toISOString(),
      remoteModifiedTime,
      lastError: null,
      attention: null,
      previousSaved,
      base: snapshot,
      lastSyncHadData: !isEmptyData(snapshot),
    });
    return { ok: true, uploaded: !cloudMatches, addedFromCloud };
  } catch (error) {
    if (error instanceof DriveError) {
      if (error.kind === "auth")
        await auth
          .forgetToken()
          .catch((e) => console.warn("Psalms Way: could not forget the token", e));
      return recordFailure(fail(codeForDrive(error), describe(error)));
    }
    return recordFailure(fail("unknown", describe(error)));
  }
}

/** run() that never rejects: an unexpected throw becomes "unknown". */
async function safeRun(options) {
  try {
    return await run(options);
  } catch (error) {
    const failure = fail("unknown", describe(error));
    await recordFailure(failure).catch((e) =>
      console.warn("Psalms Way: could not record a sync failure", e)
    );
    return failure;
  }
}

let queue = Promise.resolve();
let running = false;

/** One run at a time. */
function exclusive(task) {
  const result = queue.then(async () => {
    running = true;
    try {
      return await task();
    } finally {
      running = false;
    }
  });
  queue = result.catch(() => undefined);
  return result;
}

// ─── Public API (called from the background worker) ──────────────────────────

/** Shows Google's account picker, then combines this browser with the account's cloud copy. */
export async function connect() {
  if (!auth.isSignInConfigured()) return fail("not-configured");
  let email;
  try {
    const token = await auth.signInInteractive();
    email = await fetchAccountEmail(token);
  } catch (error) {
    if (error?.code === "cancelled") return fail("cancelled");
    if (error instanceof DriveError) return fail(codeForDrive(error), describe(error));
    return fail("sign-in-failed", describe(error));
  }
  return exclusive(async () => {
    try {
      // A different account starts clean. The same account keeps a tripped
      // empty guard until the combine below succeeds. Either way the base is
      // dropped: connect keeps both sides and saves a fresh one.
      await patchState((state) =>
        state.email === email
          ? {
              ...state,
              attention: state.attention === "empty-local" ? "empty-local" : null,
              lastError: null,
              base: null,
            }
          : { ...INITIAL, email }
      );
    } catch (error) {
      return fail("unknown", describe(error));
    }
    return safeRun({
      forceCombine: true,
      automatic: false,
      onlyIfLocalChanged: false,
      allowEmpty: true,
    });
  });
}

/**
 * When the popup opens, shortly after a change, and when the browser starts.
 * Never shows anything. With `onlyIfLocalChanged` it makes no request unless
 * this browser changed.
 */
export async function autoSync({ onlyIfLocalChanged = false } = {}) {
  if (!auth.isSignInConfigured()) return NO_CHANGE;
  const state = await getSyncState();
  if (!state.email) return NO_CHANGE;
  return exclusive(() =>
    safeRun({ forceCombine: false, automatic: true, onlyIfLocalChanged, allowEmpty: false })
  );
}

export function isRunning() {
  return running;
}

/** "Sync now" in the panel. */
export function syncNow() {
  return exclusive(() =>
    safeRun({ forceCombine: false, automatic: false, onlyIfLocalChanged: false, allowEmpty: false })
  );
}

/** "Get my data back": combines the cloud copy into this browser, keeping both. */
export function recover() {
  return exclusive(() =>
    safeRun({ forceCombine: true, automatic: false, onlyIfLocalChanged: false, allowEmpty: true })
  );
}

/** "Sync anyway": the reader confirmed this browser's (empty) data is what they want. */
export function syncAnyway() {
  return exclusive(() =>
    safeRun({ forceCombine: false, automatic: false, onlyIfLocalChanged: false, allowEmpty: true })
  );
}

/** Forgets the connection. This browser's data and the Drive file stay. */
export function disconnect() {
  return exclusive(async () => {
    await auth
      .forgetToken()
      .catch((e) => console.warn("Psalms Way: could not forget the token", e));
    await chrome.storage.local.set({ [SYNC_STATE_KEY]: { ...INITIAL } });
    return { ok: true };
  });
}
