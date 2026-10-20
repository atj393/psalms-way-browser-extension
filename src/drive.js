// ─── Google Drive, private app folder only ────────────────────────────────────
// A port of the phone app's services/backup/driveClient.ts. With the
// drive.appdata scope this extension can see only the hidden folder the Psalms
// Way apps share in the reader's own Drive: not their documents, photos or any
// other file. Requests go straight from the browser to Google; there is no
// Psalms Way server.

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

/** The file the phone app and this extension share; one per account. */
export const BACKUP_FILENAME = "psalms-way-backup.json";

/** The cloud copy as it was before this browser first combined with it. */
export const PREVIOUS_BACKUP_FILENAME = "psalms-way-backup.previous.json";

/** Name for an unreadable cloud copy moved aside instead of being overwritten. */
export function unreadableBackupFilename(now = new Date()) {
  return `psalms-way-backup.unreadable-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

/** How long one request may take before it counts as offline. */
export const REQUEST_TIMEOUT_MS = 30000;

/**
 * `auth`: the token is stale or revoked, reconnect. `network`: try later.
 * `quota` and `server`: Google's problem, try later. `storage-full`: the
 * reader's Drive has no space, which only they can fix.
 */
export class DriveError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = "DriveError";
    this.kind = kind;
    this.status = status;
  }
}

function kindForStatus(status) {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "quota";
  if (status >= 500) return "server";
  return "unknown";
}

async function request(url, accessToken, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
    });
  } catch (error) {
    if (controller.signal.aborted) throw new DriveError("network", "Request timed out");
    throw new DriveError(
      "network",
      error instanceof Error ? error.message : "Network request failed"
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let kind = kindForStatus(response.status);
    if (response.status === 403 && /storageQuotaExceeded/.test(detail)) {
      kind = "storage-full";
    } else if (
      response.status === 403 &&
      /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(detail)
    ) {
      kind = "quota";
    }
    throw new DriveError(
      kind,
      `Drive request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      response.status
    );
  }
  return response;
}

/** Finds a file by name in the app folder, if there is one. */
export async function findFile(accessToken, name) {
  const q = encodeURIComponent(`name = '${name}'`);
  const url = `${DRIVE_FILES}?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=10`;
  const body = await (await request(url, accessToken)).json();
  const files = body.files ?? [];
  if (files.length === 0) return null;
  // Drive permits duplicate names; the most recently modified one is the real file.
  return files.sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""))[0];
}

export function findBackupFile(accessToken) {
  return findFile(accessToken, BACKUP_FILENAME);
}

/** Writes a file to the app folder, replacing any file of the same name. */
export async function uploadFile(accessToken, name, contents) {
  const existing = await findFile(accessToken, name);
  if (existing) {
    const response = await request(
      `${DRIVE_UPLOAD}/${existing.id}?uploadType=media&fields=id,name,modifiedTime,size`,
      accessToken,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: contents }
    );
    return response.json();
  }
  const boundary = `psalmsway-${Date.now()}`;
  const metadata = JSON.stringify({ name, parents: ["appDataFolder"] });
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    `${contents}\r\n` +
    `--${boundary}--`;
  const response = await request(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,size`,
    accessToken,
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body }
  );
  return response.json();
}

export function uploadBackup(accessToken, contents) {
  return uploadFile(accessToken, BACKUP_FILENAME, contents);
}

/** The raw contents of a file. */
export async function downloadFile(accessToken, fileId) {
  const response = await request(`${DRIVE_FILES}/${fileId}?alt=media`, accessToken);
  try {
    return await response.text();
  } catch (error) {
    throw new DriveError(
      "network",
      error instanceof Error ? error.message : "Could not read the backup"
    );
  }
}

/** The signed-in account's email, which drive.appdata is enough to read. */
export async function fetchAccountEmail(accessToken) {
  const response = await request(
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)",
    accessToken
  );
  const body = await response.json();
  const email = body?.user?.emailAddress;
  if (typeof email !== "string" || email === "") {
    throw new DriveError("unknown", "Google did not return the account's email address");
  }
  return email;
}
