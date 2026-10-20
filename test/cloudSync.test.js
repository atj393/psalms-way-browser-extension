// Cloud sync against an in-memory Google Drive.
//
// The fake Drive implements just the REST calls drive.js makes, so these tests
// exercise the real merge, conversion, storage and upload code. Each case is
// one of the ways phone and browser could disagree or lose data, shown not to.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as store from "../src/storage.js";
import {
  SYNC_STATE_KEY,
  autoSync,
  connect,
  disconnect,
  getStatus,
  getSyncState,
  iconFor,
  parseCloudBackup,
  recover,
  setAuthForTests,
  syncAnyway,
  syncNow,
} from "../src/cloudSync.js";
import { BACKUP_FILENAME, PREVIOUS_BACKUP_FILENAME } from "../src/drive.js";

function respond(body, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

/** Just enough of Drive v3: list by name, download, create, update, about. */
function createFakeDrive() {
  const files = [];
  let tick = 0;
  const stamp = () => `2026-10-20T10:00:${String(++tick).padStart(2, "0")}.000Z`;
  const meta = (f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime });
  const idFrom = (url) => url.split("/files/")[1].split("?")[0];

  async function handle(url, init = {}) {
    const method = init.method ?? "GET";
    if (url.includes("/about")) return respond({ user: { emailAddress: drive.email } });
    if (drive.failWith) return respond(drive.failWith.body, drive.failWith.status);
    if (method === "GET" && url.includes("alt=media")) {
      const file = files.find((f) => f.id === idFrom(url));
      return file ? respond(file.content) : respond("not found", 404);
    }
    if (method === "GET") {
      const name = /name = '(.+)'/.exec(new URL(url).searchParams.get("q") ?? "")?.[1];
      return respond({ files: files.filter((f) => f.name === name).map(meta) });
    }
    if (method === "PATCH") {
      const file = files.find((f) => f.id === idFrom(url));
      file.content = String(init.body);
      file.modifiedTime = stamp();
      return respond(meta(file));
    }
    if (method === "POST") {
      const boundary = init.headers["Content-Type"].split("boundary=")[1];
      const parts = String(init.body)
        .split(`--${boundary}`)
        .filter((p) => p.includes("\r\n\r\n"));
      const payload = (part) => part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
      const file = {
        id: `file-${files.length + 1}`,
        name: JSON.parse(payload(parts[0])).name,
        modifiedTime: stamp(),
        content: payload(parts[1]),
      };
      files.push(file);
      return respond(meta(file));
    }
    throw new Error(`Unexpected ${method} ${url}`);
  }

  const drive = {
    email: "reader@example.com",
    failWith: null,
    files,
    fetch: vi.fn(handle),
    named: (name) => files.find((f) => f.name === name),
    main: () => JSON.parse(files.find((f) => f.name === BACKUP_FILENAME).content),
    /** The phone app (or anything else) writing the shared file. */
    putMain(data, extra = {}) {
      const content = JSON.stringify({
        type: "psalms-way-backup",
        schemaVersion: 1,
        appVersion: "2.1.0",
        createdAt: "2026-10-20T08:00:00.000Z",
        data: {
          bookmarks: [],
          favorites: [],
          highlights: [],
          notes: [],
          history: [],
          streak: null,
          badges: null,
          challenges: null,
          settings: {},
          ...data,
        },
        ...extra,
      });
      const existing = files.find((f) => f.name === BACKUP_FILENAME);
      if (existing) {
        existing.content = content;
        existing.modifiedTime = stamp();
      } else {
        files.push({
          id: `file-${files.length + 1}`,
          name: BACKUP_FILENAME,
          modifiedTime: stamp(),
          content,
        });
      }
    },
  };
  return drive;
}

let drive;
let auth;
let local;

beforeEach(() => {
  local = installChromeMock({});
  globalThis.chrome.runtime = { getManifest: () => ({ version: "3.0" }) };
  store.resetStoreCache();
  drive = createFakeDrive();
  vi.stubGlobal("fetch", drive.fetch);
  auth = {
    isSignInConfigured: () => true,
    signInInteractive: vi.fn(async () => "tok"),
    getAccessToken: vi.fn(async () => "tok"),
    forgetToken: vi.fn(async () => {}),
  };
  setAuthForTests(auth);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setAuthForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const writes = () =>
  drive.fetch.mock.calls.filter(([, init]) => ["PATCH", "POST"].includes(init?.method));

async function bookmarksHere() {
  store.resetStoreCache();
  return (await store.getFavourites()).map((f) => [f.chapterIndex, f.verseIndex]);
}

describe("connecting", () => {
  it("uploads this browser in the phone app's format when the account has no backup", async () => {
    await store.toggleFavourite(22, 0);
    const result = await connect();
    expect(result).toMatchObject({ ok: true, uploaded: true });
    const file = drive.main();
    expect(file).toMatchObject({
      type: "psalms-way-backup",
      schemaVersion: 1,
      appVersion: "browser-3.0",
    });
    expect(file.data.bookmarks).toEqual([{ chapter: 23, verse: 1 }]);
    expect(drive.named(PREVIOUS_BACKUP_FILENAME)).toBeUndefined();
    expect((await getSyncState()).email).toBe("reader@example.com");
  });

  it("brings the phone's data into an empty browser", async () => {
    drive.putMain({ bookmarks: [{ chapter: 91, verse: 1 }], favorites: [23] });
    const result = await connect();
    expect(result).toMatchObject({ ok: true, addedFromCloud: 2 });
    expect(await bookmarksHere()).toEqual([[90, 0]]);
    // Chapter favourites wait in the carry slot until this extension shows them.
    expect((await store.loadStore()).carry.favorites).toEqual([23]);
  });

  it("keeps everything from both sides, and a copy of the cloud as it was", async () => {
    await store.toggleFavourite(0, 0);
    drive.putMain({ bookmarks: [{ chapter: 2, verse: 2 }] });
    const before = drive.named(BACKUP_FILENAME).content;
    await connect();
    expect(drive.main().data.bookmarks).toEqual([
      { chapter: 1, verse: 1 },
      { chapter: 2, verse: 2 },
    ]);
    expect(drive.named(PREVIOUS_BACKUP_FILENAME).content).toBe(before);
  });

  it("changes nothing when the Google window is closed", async () => {
    auth.signInInteractive.mockRejectedValue(
      Object.assign(new Error("closed"), { code: "cancelled" })
    );
    expect(await connect()).toMatchObject({ ok: false, code: "cancelled" });
    expect(drive.fetch).not.toHaveBeenCalled();
    expect((await getSyncState()).email).toBeNull();
  });

  it("reports a sign-in that failed for another reason", async () => {
    auth.signInInteractive.mockRejectedValue(Object.assign(new Error("nope"), { code: "failed" }));
    expect(await connect()).toMatchObject({ ok: false, code: "sign-in-failed" });
  });

  it("is unavailable in a build without a Google client", async () => {
    auth.isSignInConfigured = () => false;
    expect(await connect()).toMatchObject({ ok: false, code: "not-configured" });
    expect(await autoSync()).toMatchObject({ ok: true, uploaded: false });
    expect((await getStatus()).configured).toBe(false);
  });

  it("refuses a backup made by a newer app version and changes nothing", async () => {
    drive.putMain({ bookmarks: [{ chapter: 1, verse: 1 }] }, { schemaVersion: 2 });
    expect(await connect()).toMatchObject({ ok: false, code: "incompatible-backup" });
    expect(await bookmarksHere()).toEqual([]);
    expect(writes()).toHaveLength(0);
  });

  it("moves an unreadable backup aside instead of overwriting it", async () => {
    drive.files.push({ id: "bad", name: BACKUP_FILENAME, modifiedTime: "t", content: "{not json" });
    await store.toggleFavourite(4, 0);
    await connect();
    const aside = drive.files.find((f) => f.name.startsWith("psalms-way-backup.unreadable-"));
    expect(aside.content).toBe("{not json");
    expect((await getSyncState()).unreadableKeptAsideAt).not.toBeNull();
  });

  it("starts clean for a different account", async () => {
    await connect();
    drive.email = "other@example.com";
    await connect();
    expect((await getSyncState()).email).toBe("other@example.com");
  });
});

describe("staying in step with the phone", () => {
  beforeEach(async () => {
    await store.toggleFavourite(0, 0);
    await connect();
    drive.fetch.mockClear();
  });

  it("does nothing, and asks nothing, when not connected", async () => {
    await disconnect();
    drive.fetch.mockClear();
    expect(await autoSync()).toMatchObject({ ok: true, uploaded: false });
    expect(drive.fetch).not.toHaveBeenCalled();
  });

  it("only checks the cloud, and uploads nothing, when nothing changed anywhere", async () => {
    await autoSync();
    expect(drive.fetch).toHaveBeenCalledTimes(1);
  });

  it("makes no request after a change event when this browser changed nothing", async () => {
    await autoSync({ onlyIfLocalChanged: true });
    expect(drive.fetch).not.toHaveBeenCalled();
  });

  it("brings in a bookmark saved on the phone", async () => {
    drive.putMain({
      bookmarks: [
        { chapter: 50, verse: 5 },
        { chapter: 1, verse: 1 },
      ],
    });
    await autoSync();
    expect(await bookmarksHere()).toEqual([
      [49, 4],
      [0, 0],
    ]);
  });

  it("does not upload back what it just brought in, so the devices don't bounce the file", async () => {
    drive.putMain({
      bookmarks: [
        { chapter: 50, verse: 5 },
        { chapter: 1, verse: 1 },
      ],
    });
    await autoSync();
    expect(writes()).toHaveLength(0);
    drive.fetch.mockClear();
    await autoSync();
    expect(drive.fetch).toHaveBeenCalledTimes(1);
  });

  it("removes a bookmark deleted on the phone", async () => {
    drive.putMain({
      bookmarks: [],
      notes: [{ chapter: 9, verse: 9, text: "x", date: "2026-10-20T00:00:00.000Z" }],
    });
    await autoSync();
    expect(await bookmarksHere()).toEqual([]);
  });

  it("removes from the cloud a bookmark deleted here, keeping the phone's new one", async () => {
    await store.toggleFavourite(4, 4);
    await autoSync({ onlyIfLocalChanged: true });
    drive.putMain({
      bookmarks: [
        { chapter: 5, verse: 5 },
        { chapter: 1, verse: 1 },
      ],
      favorites: [9],
    });
    await store.removeFavourite(0, 0);
    await autoSync();
    expect(drive.main().data.bookmarks).toEqual([{ chapter: 5, verse: 5 }]);
    expect(drive.main().data.favorites).toEqual([9]);
  });

  it("uploads a change made here", async () => {
    await store.saveNote(22, 0, "The Lord is my shepherd");
    await autoSync({ onlyIfLocalChanged: true });
    expect(drive.main().data.notes).toEqual([
      expect.objectContaining({ chapter: 23, verse: 1, text: "The Lord is my shepherd" }),
    ]);
  });

  it("keeps the phone's highlights, streak, badges, challenges and settings intact", async () => {
    const phoneOnly = {
      highlights: [{ chapter: 5, verse: 1, color: "green" }],
      streak: { lastDate: "2026-10-20", count: 4 },
      badges: { day1: "2026-10-01T08:00:00.000Z" },
      challenges: { psalms30: { completedDays: [0, 1] } },
      settings: { fontSize: 20 },
    };
    drive.putMain({ bookmarks: [{ chapter: 1, verse: 1 }], ...phoneOnly });
    await autoSync();
    await store.toggleFavourite(2, 2);
    await autoSync({ onlyIfLocalChanged: true });
    expect(drive.main().data).toMatchObject(phoneOnly);
  });

  it("never alters a long phone note on the way through", async () => {
    const text = `  ${"A long reflection written on the phone. ".repeat(200)}\n`;
    drive.putMain({
      bookmarks: [{ chapter: 1, verse: 1 }],
      notes: [{ chapter: 5, verse: 2, text, date: "2026-10-19T09:00:00.000Z" }],
    });
    await autoSync();
    await store.toggleFavourite(7, 0);
    await autoSync({ onlyIfLocalChanged: true });
    expect(drive.main().data.notes[0].text).toBe(text);
  });

  it("'Sync now' with nothing changed records the time without uploading", async () => {
    const result = await syncNow();
    expect(result).toMatchObject({ ok: true, uploaded: false });
    expect(writes()).toHaveLength(0);
  });
});

describe("the empty-browser guard", () => {
  beforeEach(async () => {
    await store.toggleFavourite(0, 0);
    await connect();
  });

  it("never empties a cloud copy that had data on its own", async () => {
    await store.removeFavourite(0, 0);
    drive.fetch.mockClear();
    expect(await autoSync()).toMatchObject({ ok: false, code: "empty-local" });
    expect(drive.fetch).not.toHaveBeenCalled();
    expect(iconFor(await getSyncState())).toBe("attention");
  });

  it("brings the data back on 'Get my data back'", async () => {
    await store.removeFavourite(0, 0);
    await autoSync();
    await recover();
    expect(await bookmarksHere()).toEqual([[0, 0]]);
    expect((await getSyncState()).attention).toBeNull();
  });

  it("empties the cloud only on 'Sync anyway'", async () => {
    await store.removeFavourite(0, 0);
    await autoSync();
    await syncAnyway();
    expect(drive.main().data.bookmarks).toEqual([]);
  });
});

describe("when Google says no", () => {
  beforeEach(async () => {
    await store.toggleFavourite(0, 0);
    await connect();
    await store.toggleFavourite(1, 1);
  });

  it("asks to reconnect when access was revoked, forgets the token, and waits", async () => {
    drive.failWith = { status: 401, body: "" };
    expect(await autoSync()).toMatchObject({ ok: false, code: "auth-expired" });
    expect(auth.forgetToken).toHaveBeenCalled();
    expect((await getSyncState()).attention).toBe("reconnect");
    drive.fetch.mockClear();
    await autoSync();
    expect(drive.fetch).not.toHaveBeenCalled();
  });

  it("asks to reconnect when no token can be had without the reader", async () => {
    auth.getAccessToken.mockResolvedValue(null);
    expect(await autoSync()).toMatchObject({ ok: false, code: "auth-expired" });
    expect((await getStatus()).icon).toBe("attention");
  });

  it("stays quiet when offline, and the icon stays ok", async () => {
    drive.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await autoSync()).toMatchObject({ ok: false, code: "network" });
    expect(iconFor(await getSyncState())).toBe("ok");
  });

  it("does not show a full Drive as synced", async () => {
    drive.failWith = { status: 403, body: "storageQuotaExceeded" };
    expect(await autoSync()).toMatchObject({ ok: false, code: "drive-full" });
    expect(iconFor(await getSyncState())).toBe("attention");
  });
});

describe("disconnecting", () => {
  it("forgets the connection and the token, keeping this browser's data and the cloud file", async () => {
    await store.toggleFavourite(0, 0);
    await connect();
    await disconnect();
    expect(auth.forgetToken).toHaveBeenCalled();
    expect(await getSyncState()).toMatchObject({ email: null, base: null });
    expect(await bookmarksHere()).toEqual([[0, 0]]);
    expect(drive.main().data.bookmarks).toEqual([{ chapter: 1, verse: 1 }]);
  });

  it("keeps its state under its own key, outside the reader's data", async () => {
    await store.toggleFavourite(0, 0);
    await connect();
    expect(local.data[SYNC_STATE_KEY].email).toBe("reader@example.com");
    expect(local.data[store.STORE_KEY].cloudSync).toBeUndefined();
  });
});

describe("reading the cloud file", () => {
  it.each([
    ["not JSON", "{", "unreadable"],
    [
      "another app's file",
      JSON.stringify({ type: "other", schemaVersion: 1, data: {} }),
      "unreadable",
    ],
    [
      "a bad version",
      JSON.stringify({ type: "psalms-way-backup", schemaVersion: 0, data: {} }),
      "unreadable",
    ],
    ["no data", JSON.stringify({ type: "psalms-way-backup", schemaVersion: 1 }), "unreadable"],
    [
      "a newer version",
      JSON.stringify({ type: "psalms-way-backup", schemaVersion: 9, data: {} }),
      "future-version",
    ],
  ])("refuses %s", (_label, raw, code) => {
    expect(parseCloudBackup(raw)).toEqual({ ok: false, code });
  });

  it("fills in what an older file lacks", () => {
    const parsed = parseCloudBackup(
      JSON.stringify({ type: "psalms-way-backup", schemaVersion: 1, data: { settings: [] } })
    );
    expect(parsed.data).toEqual({
      bookmarks: [],
      favorites: [],
      highlights: [],
      notes: [],
      history: [],
      streak: null,
      badges: null,
      challenges: null,
      settings: {},
    });
  });
});
