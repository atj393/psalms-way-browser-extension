// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DataError } from "../src/data.js";
import * as store from "../src/storage.js";
import {
  currentVersion,
  getVersionData,
  initVersions,
  loadCatalogue,
  readingTextAttributes,
  resetVersions,
  setCurrentVersion,
  versionLabel,
} from "../src/versions.js";
import { installChromeMock } from "./chrome-mock.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

/** Serves the real catalogue and Bible files from the repository, as the popup would. */
function serveRepoFiles(overrides = {}) {
  const fetchMock = vi.fn(async (path) => {
    if (path in overrides) return overrides[path];
    return { ok: true, json: async () => readRepoFile(path) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const okJson = (value) => ({ ok: true, json: async () => value });

beforeEach(() => {
  store.resetStoreCache();
  resetVersions();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetVersions();
});

describe("the catalogue", () => {
  it("lists all 80 versions, each with 150 chapters and the fields other modules rely on", async () => {
    serveRepoFiles();
    const catalogue = await loadCatalogue();
    expect(catalogue).toHaveLength(80);
    for (const entry of catalogue) {
      expect(entry).toEqual({
        module: expect.stringMatching(/^[a-z0-9_]+$/),
        name: expect.any(String),
        lang: expect.any(String),
        lang_short: expect.stringMatching(/^[a-z]{2}$/),
        year: expect.any(String),
        chapters: 150,
        rtl: expect.any(Boolean),
        copyright: expect.any(String),
        file: expect.stringMatching(/\.json$/),
      });
    }
    expect(new Set(catalogue.map((v) => v.module)).size).toBe(80);
  });

  it("puts the NIV (modern) first, then sorts by language name and version name", async () => {
    serveRepoFiles();
    const [first, ...rest] = await loadCatalogue();
    expect(first).toMatchObject({
      module: "modern",
      name: "New International Version (1984)",
      lang: "English",
      lang_short: "en",
      year: "1984",
      chapters: 150,
      rtl: false,
      copyright: "",
      file: "psalms.json",
    });

    const sorted = [...rest].sort(
      (a, b) => a.lang.localeCompare(b.lang, "en") || a.name.localeCompare(b.name, "en")
    );
    expect(rest.map((v) => v.module)).toEqual(sorted.map((v) => v.module));
  });

  it("keeps every other version in bibles/<module>.json", async () => {
    serveRepoFiles();
    const [, ...rest] = await loadCatalogue();
    for (const entry of rest) expect(entry.file).toBe(`bibles/${entry.module}.json`);
  });

  it("marks only right-to-left languages", async () => {
    serveRepoFiles();
    const catalogue = await loadCatalogue();
    const byModule = (module) => catalogue.find((v) => v.module === module);
    expect(byModule("wlc").rtl).toBe(true);
    expect(byModule("svd").rtl).toBe(true);
    expect(byModule("ug_ara").rtl).toBe(true);
    expect(byModule("kjv").rtl).toBe(false);
    expect(byModule("luther").rtl).toBe(false);
    for (const entry of catalogue) {
      expect(entry.rtl).toBe(["he", "ar", "fa", "ur", "ug"].includes(entry.lang_short));
    }
  });

  it("gives each version a short credit line, marked with an ellipsis when it was cut", async () => {
    serveRepoFiles();
    const catalogue = await loadCatalogue();
    for (const entry of catalogue) {
      const length = [...entry.copyright].length;
      expect(length).toBeLessThanOrEqual(160);
      expect(entry.copyright).not.toMatch(/\s{2}|\n|^\s|\s$/);
      // A cut credit fills the 160 characters, ellipsis included (one fewer when the cut fell
      // just after a space).
      if (entry.copyright.endsWith("…")) expect(length).toBeGreaterThanOrEqual(159);
    }
    expect(catalogue.find((v) => v.module === "kjv").copyright).toMatch(/Public Domain/);
    expect(catalogue.filter((v) => v.copyright.endsWith("…")).length).toBeGreaterThan(10);
  });

  it("is read-only: the list and every entry are frozen", async () => {
    serveRepoFiles();
    const catalogue = await loadCatalogue();
    expect(Object.isFrozen(catalogue)).toBe(true);
    expect(catalogue.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(() => catalogue.push({})).toThrow(TypeError);
    expect(() => {
      catalogue[0].name = "Changed";
    }).toThrow(TypeError);
  });

  // lt_heritage is a partial translation; ta_oitce has three psalms mixed into one chapter.
  // Neither can be placed correctly, so neither is shipped.
  it.each([["lt_heritage"], ["ta_oitce"]])("leaves out %s", async (module) => {
    serveRepoFiles();
    const catalogue = await loadCatalogue();
    expect(catalogue.some((v) => v.module === module)).toBe(false);
    expect(existsSync(join(root, "bibles", `${module}.json`))).toBe(false);
  });

  it("reads the file once and keeps the result", async () => {
    const fetchMock = serveRepoFiles();
    const first = await loadCatalogue();
    expect(await loadCatalogue()).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("bibles/index.json");
  });

  it("raises a DataError when the list cannot be read, and tries again next time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net::ERR_FILE_NOT_FOUND");
      })
    );
    await expect(loadCatalogue()).rejects.toBeInstanceOf(DataError);

    serveRepoFiles();
    await expect(loadCatalogue()).resolves.toHaveLength(80);
  });

  it("raises a DataError on a non-OK response", async () => {
    serveRepoFiles({ "bibles/index.json": { ok: false, status: 404 } });
    await expect(loadCatalogue()).rejects.toThrow(/404/);
  });

  it.each([
    ["not a list", { nope: true }],
    ["an empty list", []],
    ["an entry without a file", [{ module: "kjv", name: "KJV" }]],
  ])("raises a DataError when the list is %s", async (_label, value) => {
    serveRepoFiles({ "bibles/index.json": okJson(value) });
    await expect(loadCatalogue()).rejects.toThrow(/not in the expected format/);
  });
});

describe("getVersionData", () => {
  it("loads a version as chapters of verses", async () => {
    serveRepoFiles();
    const data = await getVersionData("kjv");
    expect(data).toHaveLength(150);
    expect(data[22][0]).toMatch(/shepherd/i);
  });

  it("serves the bundled NIV from psalms.json", async () => {
    const fetchMock = serveRepoFiles();
    const data = await getVersionData("modern");
    expect(data).toHaveLength(150);
    expect(fetchMock).toHaveBeenCalledWith("psalms.json");
  });

  it("keeps each version after the first read, even when asked at the same time", async () => {
    const fetchMock = serveRepoFiles();
    const [a, b] = await Promise.all([getVersionData("web"), getVersionData("web")]);
    expect(b).toBe(a);
    expect(await getVersionData("web")).toBe(a);
    expect(fetchMock.mock.calls.filter(([path]) => path === "bibles/web.json")).toHaveLength(1);
  });

  it("rejects an unknown version with a DataError", async () => {
    serveRepoFiles();
    await expect(getVersionData("nonsense")).rejects.toBeInstanceOf(DataError);
  });

  it.each([["lt_heritage"], ["ta_oitce"]])(
    "does not know %s, which was left out",
    async (module) => {
      serveRepoFiles();
      await expect(getVersionData(module)).rejects.toBeInstanceOf(DataError);
    }
  );

  it("gives every shipped version 150 chapters, none of them empty", async () => {
    serveRepoFiles();
    for (const { module, chapters } of await loadCatalogue()) {
      const data = await getVersionData(module);
      expect(data).toHaveLength(chapters);
      expect(data.every((chapter) => chapter.length > 0)).toBe(true);
    }
  });

  it("raises a DataError when the file cannot be read, and does not keep the failure", async () => {
    serveRepoFiles({ "bibles/kjv.json": { ok: false, status: 404 } });
    await expect(getVersionData("kjv")).rejects.toThrow(/404/);

    // The catalogue is already kept, so only the version's own file is fetched again.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    await expect(getVersionData("kjv")).rejects.toBeInstanceOf(DataError);

    serveRepoFiles();
    await expect(getVersionData("kjv")).resolves.toHaveLength(150);
  });

  it("raises a DataError when the text is the wrong shape", async () => {
    serveRepoFiles({ "bibles/kjv.json": okJson({ nope: true }) });
    await expect(getVersionData("kjv")).rejects.toThrow(/not in the expected format/);
  });

  it("raises a DataError when a version has a different chapter count than the list says", async () => {
    const kjv = readRepoFile("bibles/kjv.json");
    serveRepoFiles({ "bibles/kjv.json": okJson(kjv.slice(0, 149)) });
    await expect(getVersionData("kjv")).rejects.toThrow(/not in the expected format/);
  });

  it("raises a DataError when a chapter is not a list of verses", async () => {
    const kjv = readRepoFile("bibles/kjv.json");
    kjv[3] = "Psalm 4";
    serveRepoFiles({ "bibles/kjv.json": okJson(kjv) });
    await expect(getVersionData("kjv")).rejects.toThrow(/not in the expected format/);
  });
});

describe("initVersions", () => {
  it("keeps the saved version without writing anything", async () => {
    const local = installChromeMock();
    serveRepoFiles();
    const writes = local.setCalls;

    expect(await initVersions({ bibleVersion: "web" }, "de")).toBe("web");
    expect(currentVersion()).toBe("web");
    expect(local.setCalls).toBe(writes);
  });

  it("starts English readers on the NIV and saves the choice", async () => {
    installChromeMock();
    serveRepoFiles();

    expect(await initVersions({ bibleVersion: null }, "en")).toBe("modern");
    expect(currentVersion()).toBe("modern");
    expect((await store.getSettings()).bibleVersion).toBe("modern");
  });

  it("gives German readers the phone's German choice", async () => {
    installChromeMock();
    serveRepoFiles();

    // The first German version in the phone's list (sorted by language, then name).
    expect(await initVersions({ bibleVersion: null }, "de")).toBe("elberfelder_1871");
    expect(currentVersion()).toBe("elberfelder_1871");
    expect((await store.getSettings()).bibleVersion).toBe("elberfelder_1871");
  });

  it.each([
    ["fr", "epee"],
    ["es", "rv_1909"],
    ["he", "wlc"],
    ["ar", "svd"],
    ["ta", "ta_irv"],
  ])("gives %s readers %s", async (language, expected) => {
    installChromeMock();
    serveRepoFiles();
    expect(await initVersions({ bibleVersion: null }, language)).toBe(expected);
  });

  it.each([["xx"], [""], [undefined], [null]])(
    "falls back to the NIV for the language %j, which has no version",
    async (language) => {
      installChromeMock();
      serveRepoFiles();
      expect(await initVersions({ bibleVersion: null }, language)).toBe("modern");
    }
  );

  it("chooses again when the saved version is lt_heritage, which was left out", async () => {
    installChromeMock();
    serveRepoFiles();

    // No Lithuanian version is left, so a Lithuanian reader gets the NIV, and that is kept.
    expect(await initVersions({ bibleVersion: "lt_heritage" }, "lt")).toBe("modern");
    expect((await store.getSettings()).bibleVersion).toBe("modern");

    resetVersions();
    expect(await initVersions({ bibleVersion: "lt_heritage" }, "de")).toBe("elberfelder_1871");
    expect((await store.getSettings()).bibleVersion).toBe("elberfelder_1871");
  });

  it("chooses again when the saved version is ta_oitce, which was left out", async () => {
    installChromeMock();
    serveRepoFiles();

    // A Tamil reader keeps a Tamil version: the one that is left.
    expect(await initVersions({ bibleVersion: "ta_oitce" }, "ta")).toBe("ta_irv");
    expect((await store.getSettings()).bibleVersion).toBe("ta_irv");
    expect(currentVersion()).toBe("ta_irv");
  });

  it("chooses again when the saved version is no longer in the list", async () => {
    installChromeMock();
    serveRepoFiles();

    expect(await initVersions({ bibleVersion: "gone" }, "de")).toBe("elberfelder_1871");
    expect((await store.getSettings()).bibleVersion).toBe("elberfelder_1871");
  });

  it("keeps a reader from version 2 on the NIV they were reading, whatever the language", async () => {
    // Version 2 had only the NIV and no bibleVersion; the store already holds their reading.
    for (const saved of [
      { favourites: [{ chapterIndex: 22, verseIndex: 0, addedAt: 1730000000000 }] },
      { notes: [{ chapterIndex: 22, verseIndex: 0, text: "A note" }] },
      { history: [{ chapterIndex: 22, verseIndex: null, viewedAt: 1730000000000 }] },
    ]) {
      store.resetStoreCache();
      resetVersions();
      installChromeMock({ psalmsway: { schemaVersion: 2, settings: { theme: "dark" }, ...saved } });
      serveRepoFiles();

      expect(await initVersions({ bibleVersion: null }, "de")).toBe("modern");
      expect((await store.getSettings()).bibleVersion).toBe("modern");
    }
  });

  it("gives a new reader, with nothing saved yet, the language's first choice", async () => {
    installChromeMock({ psalmsway: { schemaVersion: 3, settings: { uiLanguage: "de" } } });
    serveRepoFiles();

    expect(await initVersions({ bibleVersion: null }, "de")).toBe("elberfelder_1871");
    expect((await store.getSettings()).bibleVersion).toBe("elberfelder_1871");
  });

  it("copes with missing settings", async () => {
    installChromeMock();
    serveRepoFiles();
    expect(await initVersions(undefined, "en")).toBe("modern");
  });

  it("reports a failed save instead of hiding it, and keeps the NIV", async () => {
    const local = installChromeMock();
    serveRepoFiles();
    await store.loadStore();
    local.rejectNextSet();

    await expect(initVersions({ bibleVersion: null }, "de")).rejects.toBeInstanceOf(
      store.StorageError
    );
    expect(currentVersion()).toBe("modern");
  });

  it("describes the text of the version it chose, for the reader to mark it with", async () => {
    installChromeMock();
    serveRepoFiles();

    await initVersions({ bibleVersion: "wlc" }, "en");
    expect(readingTextAttributes()).toEqual({ lang: "he", dir: "rtl" });
  });

  it("leaves the page alone: the Bible text is marked where it is drawn, not on the reading view", async () => {
    installChromeMock();
    serveRepoFiles();
    document.body.append(Object.assign(document.createElement("div"), { id: "readingView" }));

    await initVersions({ bibleVersion: "wlc" }, "en");
    const view = document.getElementById("readingView");
    expect(view.hasAttribute("dir")).toBe(false);
    expect(view.hasAttribute("lang")).toBe(false);
  });
});

describe("setCurrentVersion", () => {
  it("changes the version and saves it for next time", async () => {
    installChromeMock();
    serveRepoFiles();

    await setCurrentVersion("kjv");
    expect(currentVersion()).toBe("kjv");
    expect((await store.getSettings()).bibleVersion).toBe("kjv");
  });

  it("refuses an unknown version and changes nothing", async () => {
    installChromeMock();
    serveRepoFiles();

    await expect(setCurrentVersion("nonsense")).rejects.toBeInstanceOf(DataError);
    expect(currentVersion()).toBe("modern");
    expect((await store.getSettings()).bibleVersion).toBeNull();
  });

  it("keeps the old version when the save fails", async () => {
    const local = installChromeMock();
    serveRepoFiles();
    await store.loadStore();
    local.rejectNextSet();

    await expect(setCurrentVersion("kjv")).rejects.toBeInstanceOf(store.StorageError);
    expect(currentVersion()).toBe("modern");
  });

  it("switches the text between right-to-left and left-to-right", async () => {
    installChromeMock();
    serveRepoFiles();

    await setCurrentVersion("wlc");
    expect(readingTextAttributes()).toEqual({ lang: "he", dir: "rtl" });

    await setCurrentVersion("kjv");
    expect(readingTextAttributes()).toEqual({ lang: "en", dir: "ltr" });
  });

  it("keeps the old version's description when the choice fails", async () => {
    const local = installChromeMock();
    serveRepoFiles();
    await setCurrentVersion("wlc");
    await store.loadStore();
    local.rejectNextSet();

    await expect(setCurrentVersion("kjv")).rejects.toBeInstanceOf(store.StorageError);
    expect(readingTextAttributes()).toEqual({ lang: "he", dir: "rtl" });
  });

  it("works where there is no document at all, as in the background worker", async () => {
    installChromeMock();
    serveRepoFiles();
    vi.stubGlobal("document", undefined);
    await expect(setCurrentVersion("wlc")).resolves.toBeUndefined();
    expect(currentVersion()).toBe("wlc");
  });
});

describe("readingTextAttributes", () => {
  it("is empty until a version has been chosen, so the text takes the page's own language", () => {
    expect(readingTextAttributes()).toEqual({});
  });

  it("is empty again after a reset", async () => {
    installChromeMock();
    serveRepoFiles();
    await setCurrentVersion("wlc");
    resetVersions();
    expect(readingTextAttributes()).toEqual({});
  });
});

describe("versionLabel", () => {
  it("is NIV for the bundled version", () => {
    expect(versionLabel("modern")).toBe("NIV");
  });

  it("is the module in capitals when it is six characters or fewer", () => {
    expect(versionLabel("kjv")).toBe("KJV");
    expect(versionLabel("asvs")).toBe("ASVS");
    expect(versionLabel("luther")).toBe("LUTHER");
  });

  it("is the first word of the name when the module is longer", async () => {
    serveRepoFiles();
    await loadCatalogue();
    expect(versionLabel("bishops")).toBe("Bishops");
    expect(versionLabel("chinese_union_simp")).toBe("Chinese");
    expect(versionLabel("mal1910")).toBe("Sathyavedapusthakam");
  });

  it("is the module in capitals while the list has not loaded yet", () => {
    expect(versionLabel("bishops")).toBe("BISHOPS");
  });
});
