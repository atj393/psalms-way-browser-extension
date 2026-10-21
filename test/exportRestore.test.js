// @vitest-environment jsdom
// Export, restore and the language change in Settings: the wording (each count with its own
// noun), and what a restored backup does to the language and the page.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as storage from "../src/storage.js";
import { createBackup } from "../src/backup.js";
import { setHighlight, toggleFavoriteChapter, updateCarry } from "../src/phoneData.js";
import { currentLanguage, setTablesForTests } from "../src/i18n.js";
import { refreshPassage } from "../src/reader.js";
import { applyLanguage, exportBackup, restoreBackup } from "../src/settings.js";

vi.mock("../src/reader.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshPassage: vi.fn(async () => {}),
}));

const readJson = (path) => JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
const english = [readJson("locales/ext/en.json"), readJson("locales/app/en.json")];

function mountPopup() {
  const parsed = new DOMParser().parseFromString(
    `<h2 id="settingsHeading" data-i18n="settings">Settings</h2>
     <div id="toolbarWrapper"></div>
     <button id="btnToggleToolbar" type="button"></button>
     <button id="btnCloud" type="button"></button>
     <div id="statusBar" hidden></div>
     <div id="dialogHost" hidden></div>`,
    "text/html"
  );
  document.body.replaceChildren(...parsed.body.childNodes);
}

const status = () => document.getElementById("statusBar").textContent;
const dialogMessage = () => document.querySelector(".dialog-message")?.textContent;

/** Presses the dialog's confirm (the last button) or cancel (the first). */
const answerDialog = (confirm) => {
  const buttons = document.querySelectorAll(".dialog-actions button");
  buttons[confirm ? buttons.length - 1 : 0].click();
};

/** A backup file holding `bookmarks` bookmarks, `notes` notes and `history` history entries. */
function backupFile({ bookmarks = 1, notes = 1, history = 1, settings = {} } = {}) {
  const document_ = createBackup(
    {
      favourites: Array.from({ length: bookmarks }, (_, i) => ({
        chapterIndex: i,
        verseIndex: 0,
        addedAt: 1730000000000 + i,
      })),
      notes: Array.from({ length: notes }, (_, i) => ({
        id: `n_${i}_0`,
        chapterIndex: i,
        verseIndex: 0,
        text: `Note ${i}`,
        createdAt: 1730000000000,
        updatedAt: 1730000000000,
      })),
      history: Array.from({ length: history }, (_, i) => ({
        chapterIndex: i,
        verseIndex: null,
        viewedAt: 1730000000000 + i,
      })),
      settings,
    },
    "3.0"
  );
  const text = JSON.stringify(document_);
  // jsdom's File has no text(); importBackup only needs a size and text().
  return { size: text.length, text: async () => text };
}

/** Serves language files from `fetch`, as the extension's own origin does. */
function serve(files) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => ({ ok: path in files, status: 404, json: async () => files[path] }))
  );
}

beforeEach(() => {
  storage.resetStoreCache();
  installChromeMock({});
  mountPopup();
  setTablesForTests("en", english);
  vi.mocked(refreshPassage).mockClear();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTablesForTests("en", []);
});

describe("exporting", () => {
  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("says each count with its own noun, singular or plural", async () => {
    await storage.toggleFavourite(0, 0);
    await storage.saveNote(1, 0, "one");
    await storage.saveNote(2, 0, "two");
    await exportBackup();
    expect(status()).toBe("Exported 1 bookmark, 2 notes");

    await storage.toggleFavourite(1, 0);
    await storage.toggleFavourite(2, 0);
    await storage.deleteNote(2, 0);
    await exportBackup();
    expect(status()).toBe("Exported 3 bookmarks, 1 note");
  });

  it("says it in the reader's language, with each noun in that language's form", async () => {
    setTablesForTests("de", [
      {
        exportDone: "{{bookmarks}} und {{notes}} exportiert",
        countBookmarks_one: "{{count}} Lesezeichen",
        countBookmarks_other: "{{count}} Lesezeichen",
        countNotes_one: "{{count}} Notiz",
        countNotes_other: "{{count}} Notizen",
      },
    ]);
    await storage.toggleFavourite(0, 0);
    await storage.saveNote(1, 0, "one");
    await exportBackup();
    expect(status()).toBe("1 Lesezeichen und 1 Notiz exportiert");
  });

  it.each([
    ["highlights", () => setHighlight(22, 0, "yellow")],
    ["favourite Psalms", () => toggleFavoriteChapter(22)],
    [
      "a challenge's progress",
      () =>
        updateCarry((carry) => {
          carry.challenges = { psalms30: { startDate: "2026-10-18", completedDays: [0] } };
        }),
    ],
  ])("exports a reader who has only %s", async (_, save) => {
    await save();
    await exportBackup();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(status()).toBe("Exported 0 bookmarks, 0 notes");
  });

  it("still says there is nothing to export when there is nothing", async () => {
    await exportBackup();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(status()).toBe("There is nothing to export yet.");
  });
});

describe("the restore question", () => {
  it("counts each kind with its own noun", async () => {
    const pending = restoreBackup(backupFile({ bookmarks: 1, notes: 1, history: 1 }), {
      onRestored: vi.fn(),
    });
    await vi.waitFor(() => expect(dialogMessage()).toBeDefined());
    expect(dialogMessage()).toBe(
      "This backup holds 1 bookmark, 1 note and 1 history entry. Restoring replaces what is on this browser now."
    );
    answerDialog(false);
    await pending;

    const second = restoreBackup(backupFile({ bookmarks: 2, notes: 3, history: 4 }), {
      onRestored: vi.fn(),
    });
    await vi.waitFor(() => expect(dialogMessage()).toBeDefined());
    expect(dialogMessage()).toContain("2 bookmarks, 3 notes and 4 history entries.");
    answerDialog(false);
    await second;
  });
});

describe("restoreBackup", () => {
  const arabic = {
    "locales/ext/en.json": english[0],
    "locales/app/en.json": english[1],
    "locales/ext/ar.json": {},
    "locales/app/ar.json": { settings: "الإعدادات" },
  };

  it("loads and draws the language the backup brings, then lets the page redraw", async () => {
    serve(arabic);
    const onRestored = vi.fn(async () => {
      // By now the language is already the backup's.
      expect(currentLanguage()).toBe("ar");
    });

    const pending = restoreBackup(backupFile({ settings: { uiLanguage: "ar" } }), { onRestored });
    await vi.waitFor(() => expect(dialogMessage()).toBeDefined());
    answerDialog(true);
    await pending;

    expect(document.documentElement.getAttribute("lang")).toBe("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.getElementById("settingsHeading").textContent).toBe("الإعدادات");
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored.mock.calls[0][0].settings.uiLanguage).toBe("ar");
    expect(status()).toContain("Backup restored");
  });

  it("changes nothing when the reader says no", async () => {
    serve(arabic);
    const onRestored = vi.fn();

    const pending = restoreBackup(backupFile({ settings: { uiLanguage: "ar" } }), { onRestored });
    await vi.waitFor(() => expect(dialogMessage()).toBeDefined());
    answerDialog(false);
    await pending;

    expect(onRestored).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute("dir")).toBe(false);
    expect((await storage.getSettings()).uiLanguage).toBe("auto");
  });

  it("reports a failure to show the restored data instead of losing it", async () => {
    serve(arabic);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onRestored = vi.fn(async () => {
      throw new Error("Could not draw the passage");
    });

    const pending = restoreBackup(backupFile(), { onRestored });
    await vi.waitFor(() => expect(dialogMessage()).toBeDefined());
    answerDialog(true);
    await pending;

    expect(status()).toContain("Could not draw the passage");
  });

  it("does nothing for no file", async () => {
    const onRestored = vi.fn();
    await restoreBackup(undefined, { onRestored });
    expect(onRestored).not.toHaveBeenCalled();
  });
});

describe("applyLanguage", () => {
  it("loads the language, draws the marked text and the state-named buttons, and redraws the Psalm", async () => {
    serve({
      "locales/ext/en.json": english[0],
      "locales/app/en.json": english[1],
      "locales/ext/ar.json": { toolbarHide: "إخفاء الشريط" },
      "locales/app/ar.json": { settings: "الإعدادات" },
    });

    await applyLanguage("ar");

    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.getElementById("settingsHeading").textContent).toBe("الإعدادات");
    expect(document.getElementById("btnToggleToolbar").title).toBe("إخفاء الشريط");
    expect(document.getElementById("btnToggleToolbar").getAttribute("aria-label")).toBe(
      "إخفاء الشريط"
    );
    expect(refreshPassage).toHaveBeenCalledTimes(1);
  });
});
