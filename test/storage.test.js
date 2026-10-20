import { describe, it, expect, beforeEach } from "vitest";
import { installChromeMock, removeChromeMock } from "./chrome-mock.js";
import * as store from "../src/storage.js";

const {
  STORE_KEY,
  LEGACY_FAVOURITES,
  LEGACY_HISTORY,
  LEGACY_SETTINGS,
  SCHEMA_VERSION,
  HISTORY_MAX,
} = store;

beforeEach(() => {
  store.resetStoreCache();
});

describe("defaults", () => {
  it("starts empty with sensible settings", async () => {
    installChromeMock({});
    const loaded = await store.loadStore();
    expect(loaded).toEqual({
      schemaVersion: SCHEMA_VERSION,
      favourites: [],
      notes: [],
      history: [],
      settings: {
        theme: "light",
        fontSize: "medium",
        lang: "en",
        toolbarCollapsed: false,
        accent: "green",
        bibleVersion: null,
        uiLanguage: "auto",
        compareVersions: ["kjv", "web"],
      },
      carry: {},
    });
  });

  it("keeps valid new settings and replaces invalid ones with defaults", () => {
    const valid = store.sanitiseSettings({
      theme: "auto",
      accent: "purple",
      bibleVersion: "luther1912",
      uiLanguage: "de",
      compareVersions: ["asv", "web"],
    });
    expect(valid).toMatchObject({
      theme: "auto",
      accent: "purple",
      bibleVersion: "luther1912",
      uiLanguage: "de",
      compareVersions: ["asv", "web"],
    });
    const invalid = store.sanitiseSettings({
      theme: "neon",
      accent: "pink",
      bibleVersion: "../etc",
      uiLanguage: "english",
      compareVersions: ["kjv"],
    });
    expect(invalid).toMatchObject({
      theme: "light",
      accent: "green",
      bibleVersion: null,
      uiLanguage: "auto",
      compareVersions: ["kjv", "web"],
    });
  });
});

describe("telling this page's saves from cloud sync's", () => {
  it("recognises its own save even when Chrome hands the keys back sorted", async () => {
    installChromeMock({});
    await store.toggleFavourite(1, 1);
    const saved = (await globalThis.chrome.storage.local.get(STORE_KEY))[STORE_KEY];
    const reordered = Object.fromEntries(Object.entries(saved).reverse());
    expect(store.matchesCache(reordered)).toBe(true);
  });

  it("does not mistake someone else's change for its own", async () => {
    installChromeMock({});
    await store.toggleFavourite(1, 1);
    const saved = (await globalThis.chrome.storage.local.get(STORE_KEY))[STORE_KEY];
    expect(store.matchesCache({ ...saved, favourites: [] })).toBe(false);
  });
});

// ─── Migration from the shipped 1.1 schema ───────────────────────────────────
describe("migration from version 1.1", () => {
  /** Exactly what released version 1.1 writes. */
  const legacyProfile = {
    [LEGACY_FAVOURITES]: [
      { chapterIndex: 22, verseIndex: 0, addedAt: 1730000000000 },
      { chapterIndex: 90, verseIndex: 3, addedAt: 1730000100000 },
    ],
    [LEGACY_HISTORY]: [
      { chapterIndex: 22, verseIndex: null, viewedAt: 1730000200000 },
      { chapterIndex: 1, verseIndex: 2, viewedAt: 1730000300000 },
    ],
    [LEGACY_SETTINGS]: {
      theme: "dark",
      fontSize: "large",
      lang: "en",
      toolbarCollapsed: true,
    },
  };

  it("carries favourites, history and settings across intact", async () => {
    installChromeMock(legacyProfile);
    const loaded = await store.loadStore();

    expect(loaded.favourites).toEqual([
      { chapterIndex: 22, verseIndex: 0, addedAt: 1730000000000 },
      { chapterIndex: 90, verseIndex: 3, addedAt: 1730000100000 },
    ]);
    // Newest first, one per chapter, as the phone app keeps it.
    expect(loaded.history).toEqual([
      { chapterIndex: 1, verseIndex: 2, viewedAt: 1730000300000 },
      { chapterIndex: 22, verseIndex: null, viewedAt: 1730000200000 },
    ]);
    expect(loaded.settings).toMatchObject({
      theme: "dark",
      fontSize: "large",
      lang: "en",
      toolbarCollapsed: true,
    });
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("never deletes the legacy keys, so a rollback still finds its data", async () => {
    const area = installChromeMock(legacyProfile);
    await store.loadStore();

    expect(area.data[LEGACY_FAVOURITES]).toEqual(legacyProfile[LEGACY_FAVOURITES]);
    expect(area.data[LEGACY_HISTORY]).toEqual(legacyProfile[LEGACY_HISTORY]);
    expect(area.data[LEGACY_SETTINGS]).toEqual(legacyProfile[LEGACY_SETTINGS]);
  });

  it("is idempotent", async () => {
    const area = installChromeMock(legacyProfile);
    const first = await store.loadStore();
    store.resetStoreCache();
    const second = await store.loadStore();
    expect(second).toEqual(first);
    // Second load reads the migrated record and writes nothing further.
    const writesAfterFirst = area.setCalls;
    store.resetStoreCache();
    await store.loadStore();
    expect(area.setCalls).toBe(writesAfterFirst);
  });

  it("does not re-run once v2 data exists, even if legacy keys linger", async () => {
    installChromeMock({
      ...legacyProfile,
      [STORE_KEY]: {
        schemaVersion: SCHEMA_VERSION,
        favourites: [{ chapterIndex: 5, verseIndex: 1, addedAt: 1 }],
        notes: [],
        history: [],
        settings: { theme: "sepia", fontSize: "small", lang: "en", toolbarCollapsed: false },
      },
    });
    const loaded = await store.loadStore();
    expect(loaded.favourites).toEqual([{ chapterIndex: 5, verseIndex: 1, addedAt: 1 }]);
    expect(loaded.settings.theme).toBe("sepia");
  });

  it("survives a partial legacy profile", async () => {
    installChromeMock({ [LEGACY_FAVOURITES]: [{ chapterIndex: 3, verseIndex: 0 }] });
    const loaded = await store.loadStore();
    expect(loaded.favourites).toHaveLength(1);
    expect(loaded.history).toEqual([]);
    expect(loaded.settings.theme).toBe("light");
  });

  it("keeps the good records when legacy data is partly corrupt", async () => {
    installChromeMock({
      [LEGACY_FAVOURITES]: [
        { chapterIndex: 10, verseIndex: 0, addedAt: 1730000000000 },
        { chapterIndex: 999, verseIndex: 0 }, // out of range
        null,
        "nonsense",
        { chapterIndex: -1, verseIndex: 0 },
        { chapterIndex: 2.5, verseIndex: 0 },
      ],
      [LEGACY_SETTINGS]: { theme: "neon", fontSize: 42, lang: "zzz", toolbarCollapsed: "yes" },
    });
    const loaded = await store.loadStore();
    expect(loaded.favourites).toEqual([
      { chapterIndex: 10, verseIndex: 0, addedAt: 1730000000000 },
    ]);
    // Invalid settings fall back to defaults rather than propagating.
    expect(loaded.settings).toMatchObject({
      theme: "light",
      fontSize: "medium",
      lang: "en",
      toolbarCollapsed: false,
    });
  });

  it("still returns migrated data when persisting the migration fails", async () => {
    const area = installChromeMock(legacyProfile);
    area.rejectNextSet("disk on fire");
    const loaded = await store.loadStore();
    expect(loaded.favourites).toHaveLength(2);
    // Legacy keys untouched, so the next open recomputes the same result.
    expect(area.data[LEGACY_FAVOURITES]).toHaveLength(2);
  });
});

// ─── Validation of hostile stored data ───────────────────────────────────────
describe("stored data validation", () => {
  it("does not throw on wholly malformed storage", async () => {
    installChromeMock({ [STORE_KEY]: "this is not an object" });
    const loaded = await store.loadStore();
    expect(loaded.favourites).toEqual([]);
    expect(loaded.settings.theme).toBe("light");
  });

  it("drops malformed notes but keeps valid ones", () => {
    const result = store.normaliseStore({
      notes: [
        { chapterIndex: 1, verseIndex: 1, text: "keep me", createdAt: 1000, updatedAt: 2000 },
        { chapterIndex: 1, verseIndex: 2, text: "   " }, // whitespace only
        { chapterIndex: 1, verseIndex: 3, text: 12345 }, // not a string
        { chapterIndex: 500, verseIndex: 0, text: "out of range" },
        {},
      ],
    });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].text).toBe("keep me");
  });

  it("repairs impossible timestamps instead of discarding the record", () => {
    const result = store.normaliseStore({
      favourites: [{ chapterIndex: 1, verseIndex: 1, addedAt: -5 }],
    });
    expect(result.favourites).toHaveLength(1);
    expect(result.favourites[0].addedAt).toBeGreaterThan(0);
  });

  it("removes duplicate references", () => {
    const result = store.normaliseStore({
      favourites: [
        { chapterIndex: 1, verseIndex: 1, addedAt: 1000 },
        { chapterIndex: 1, verseIndex: 1, addedAt: 2000 },
      ],
    });
    expect(result.favourites).toHaveLength(1);
    expect(result.favourites[0].addedAt).toBe(1000);
  });

  it("never shortens, trims or caps a stored note, so synced phone notes stay intact", () => {
    const long = `  ${"Long reflection. ".repeat(900)}\n`;
    const result = store.normaliseStore({
      notes: [{ chapterIndex: 1, verseIndex: 1, text: long, createdAt: 1000, updatedAt: 2000 }],
    });
    expect(result.notes[0].text).toBe(long);
  });

  it("joins two notes on one verse instead of dropping one", () => {
    const result = store.normaliseStore({
      notes: [
        { chapterIndex: 1, verseIndex: 1, text: "Mine", createdAt: 1000, updatedAt: 1000 },
        { chapterIndex: 1, verseIndex: 1, text: "Theirs", createdAt: 1000, updatedAt: 3000 },
      ],
    });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].text).toBe("Mine\n\nTheirs");
    expect(result.notes[0].updatedAt).toBe(3000);
  });

  it("keeps the phone app's other data untouched through every change", async () => {
    const carry = {
      favorites: [23],
      highlights: [{ chapter: 5, verse: 1, color: "green" }],
      streak: { lastDate: "2026-10-20", count: 3 },
      badges: { day1: "2026-10-18T08:00:00.000Z" },
      challenges: { psalms30: { completedDays: [0, 1] } },
      settings: { fontSize: 20 },
    };
    installChromeMock({
      [STORE_KEY]: { schemaVersion: 3, favourites: [], notes: [], history: [], carry },
    });
    await store.toggleFavourite(22, 0);
    await store.saveNote(22, 0, "A note");
    await store.addHistoryEntry(22, 0);
    store.resetStoreCache();
    expect((await store.loadStore()).carry).toEqual(carry);
  });

  it("keeps one history entry per chapter on read", () => {
    const result = store.normaliseStore({
      history: [
        { chapterIndex: 5, verseIndex: 1, viewedAt: 1000 },
        { chapterIndex: 5, verseIndex: 7, viewedAt: 3000 },
      ],
    });
    expect(result.history).toEqual([{ chapterIndex: 5, verseIndex: 7, viewedAt: 3000 }]);
  });

  it("caps history at the maximum", () => {
    const many = Array.from({ length: HISTORY_MAX + 40 }, (_, i) => ({
      chapterIndex: i % 150,
      verseIndex: null,
      viewedAt: 1730000000000 + i,
    }));
    expect(store.normaliseStore({ history: many }).history).toHaveLength(HISTORY_MAX);
  });
});

// ─── Favourites ──────────────────────────────────────────────────────────────
describe("favourites", () => {
  it("adds, detects and removes", async () => {
    installChromeMock({});
    expect(await store.isFavourite(22, 0)).toBe(false);
    expect(await store.toggleFavourite(22, 0)).toBe(true);
    expect(await store.isFavourite(22, 0)).toBe(true);
    expect(await store.toggleFavourite(22, 0)).toBe(false);
    expect(await store.isFavourite(22, 0)).toBe(false);
  });

  it("does not add the same verse twice", async () => {
    installChromeMock({});
    await store.toggleFavourite(1, 1);
    await store.updateStore((draft) => {
      draft.favourites.push({ chapterIndex: 1, verseIndex: 1, addedAt: Date.now() });
      return draft;
    });
    expect(await store.getFavourites()).toHaveLength(1);
  });

  it("persists across a simulated popup close and reopen", async () => {
    const area = installChromeMock({});
    await store.toggleFavourite(41, 2);
    store.resetStoreCache(); // popup destroyed
    globalThis.chrome = { storage: { local: area } }; // reopened
    expect(await store.isFavourite(41, 2)).toBe(true);
  });
});

// ─── Notes ───────────────────────────────────────────────────────────────────
describe("notes", () => {
  it("creates, reads back, updates and deletes", async () => {
    installChromeMock({});
    await store.saveNote(22, 0, "  A shepherd psalm.  ");
    let note = await store.getNote(22, 0);
    expect(note.text).toBe("A shepherd psalm.");
    const created = note.createdAt;

    await store.saveNote(22, 0, "Revised.");
    note = await store.getNote(22, 0);
    expect(note.text).toBe("Revised.");
    expect(note.createdAt).toBe(created);
    expect(await store.getNotes()).toHaveLength(1);

    await store.deleteNote(22, 0);
    expect(await store.getNote(22, 0)).toBeNull();
  });

  it("treats an emptied note as a deletion", async () => {
    installChromeMock({});
    await store.saveNote(5, 1, "temporary");
    expect(await store.saveNote(5, 1, "    ")).toBeNull();
    expect(await store.getNotes()).toHaveLength(0);
  });

  it("rejects a note beyond the length limit", async () => {
    installChromeMock({});
    await expect(store.saveNote(1, 1, "x".repeat(store.NOTE_MAX_LENGTH + 1))).rejects.toThrow(
      store.StorageError
    );
  });

  it("keeps notes for different verses separate", async () => {
    installChromeMock({});
    await store.saveNote(1, 1, "first");
    await store.saveNote(1, 2, "second");
    expect((await store.getNote(1, 1)).text).toBe("first");
    expect((await store.getNote(1, 2)).text).toBe("second");
  });
});

// ─── History ─────────────────────────────────────────────────────────────────
describe("history", () => {
  it("puts the most recent passage first", async () => {
    installChromeMock({});
    await store.addHistoryEntry(1, null);
    await store.addHistoryEntry(2, null);
    const history = await store.getHistory();
    expect(history[0].chapterIndex).toBe(2);
  });

  it("moves a repeat visit to the top rather than duplicating it", () => {
    let history = store.applyHistoryEntry([], 5, null, 1000);
    history = store.applyHistoryEntry(history, 9, null, 2000);
    history = store.applyHistoryEntry(history, 5, null, 3000);
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ chapterIndex: 5, verseIndex: null, viewedAt: 3000 });
  });

  it("keeps one entry per chapter, with the latest place, as the phone app does", () => {
    let history = store.applyHistoryEntry([], 5, null, 1000);
    history = store.applyHistoryEntry(history, 5, 2, 2000);
    expect(history).toEqual([{ chapterIndex: 5, verseIndex: 2, viewedAt: 2000 }]);
  });

  it("caps the list", () => {
    let history = [];
    for (let i = 0; i < HISTORY_MAX + 25; i++) {
      history = store.applyHistoryEntry(history, i % 150, null, 1000 + i);
    }
    expect(history).toHaveLength(HISTORY_MAX);
  });

  it("clears", async () => {
    installChromeMock({});
    await store.addHistoryEntry(1, null);
    await store.clearHistory();
    expect(await store.getHistory()).toEqual([]);
  });
});

// ─── Settings ────────────────────────────────────────────────────────────────
describe("settings", () => {
  it("round-trips a change", async () => {
    installChromeMock({});
    await store.updateSettings({ theme: "dark" });
    store.resetStoreCache();
    expect((await store.getSettings()).theme).toBe("dark");
  });

  it("ignores an unknown value rather than storing it", async () => {
    installChromeMock({});
    const settings = await store.updateSettings({ theme: "chartreuse" });
    expect(settings.theme).toBe("light");
  });
});

// ─── Failure paths ───────────────────────────────────────────────────────────
describe("failures are reported, never swallowed", () => {
  it("rejects with a quota error the caller can act on", async () => {
    const area = installChromeMock({});
    await store.loadStore();
    area.rejectNextSetWithQuota();
    await expect(store.toggleFavourite(1, 1)).rejects.toMatchObject({
      name: "StorageError",
      code: "quota_exceeded",
    });
  });

  it("rejects when the write fails for any other reason", async () => {
    const area = installChromeMock({});
    await store.loadStore();
    area.rejectNextSet();
    await expect(store.saveNote(1, 1, "hello")).rejects.toMatchObject({
      name: "StorageError",
      code: "write_failed",
    });
  });

  it("keeps both changes when two are made at the same time", async () => {
    installChromeMock({});
    await store.loadStore();
    await Promise.all([store.toggleFavourite(1, 1), store.toggleFavourite(2, 2)]);
    store.resetStoreCache();
    expect(await store.isFavourite(1, 1)).toBe(true);
    expect(await store.isFavourite(2, 2)).toBe(true);
  });

  it("still runs the next change after one fails", async () => {
    const area = installChromeMock({});
    await store.loadStore();
    area.rejectNextSet();
    const results = await Promise.allSettled([
      store.toggleFavourite(1, 1),
      store.toggleFavourite(2, 2),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
    store.resetStoreCache();
    expect(await store.isFavourite(1, 1)).toBe(false);
    expect(await store.isFavourite(2, 2)).toBe(true);
  });

  it("leaves the cache matching disk after a failed write", async () => {
    const area = installChromeMock({});
    await store.loadStore();
    area.rejectNextSet();
    await expect(store.toggleFavourite(7, 0)).rejects.toThrow();
    // The failed toggle must not appear to have worked.
    expect(await store.isFavourite(7, 0)).toBe(false);
  });

  it("reports storage being unavailable altogether", async () => {
    removeChromeMock();
    expect(store.isStorageAvailable()).toBe(false);
    await expect(store.loadStore()).rejects.toMatchObject({
      name: "StorageError",
      code: "unavailable",
    });
  });

  it("reports a failed read", async () => {
    const area = installChromeMock({});
    area.rejectNextGet();
    await expect(store.loadStore()).rejects.toMatchObject({
      name: "StorageError",
      code: "read_failed",
    });
  });
});
