import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CHAPTER_COUNT,
  DataError,
  formatReference,
  formatVerseForCopy,
  getData,
  getRandomChapterIndex,
  getRandomVerseIndex,
  hasChapter,
  isChapterRef,
  isVerseRef,
  parseChapterInput,
  resetDataCache,
  wrapChapter,
} from "../src/data.js";
import * as store from "../src/storage.js";
import { setTablesForTests } from "../src/i18n.js";
import { setCurrentVersion } from "../src/versions.js";
import { installChromeMock } from "./chrome-mock.js";

const psalms = JSON.parse(
  readFileSync(fileURLToPath(new URL("../psalms.json", import.meta.url)), "utf8")
);

const entry = (module, file, chapters) => ({
  module,
  name: module,
  lang: "English",
  lang_short: "en",
  year: "",
  chapters,
  rtl: false,
  copyright: "",
  file,
});
const catalogue = [
  entry("modern", "psalms.json", CHAPTER_COUNT),
  entry("short", "bibles/short.json", 2),
];
const shortVersion = [["In the beginning", "was the word"], ["Peace"]];

const okJson = (value) => ({ ok: true, json: async () => value });

/** Fetch that serves only the named files, so a stray request fails the test. */
function serve(files) {
  const routes = {
    "bibles/index.json": okJson(catalogue),
    "psalms.json": okJson(psalms),
    ...files,
  };
  const fetchMock = vi.fn(async (path) => {
    if (!(path in routes)) throw new Error(`unexpected fetch of ${path}`);
    return routes[path];
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  store.resetStoreCache();
  resetDataCache();
});
afterEach(() => {
  delete globalThis.fetch;
  resetDataCache();
});

describe("formatReference", () => {
  it("uses the singular 'Psalm', matching the Android app", () => {
    expect(formatReference(22)).toBe("Psalm 23");
    expect(formatReference(22, 0)).toBe("Psalm 23:1");
  });

  it("is 1-indexed for the reader and 0-indexed internally", () => {
    expect(formatReference(0, 0)).toBe("Psalm 1:1");
    expect(formatReference(149, 5)).toBe("Psalm 150:6");
  });

  it("treats a null or omitted verse as a whole chapter", () => {
    expect(formatReference(5, null)).toBe("Psalm 6");
    expect(formatReference(5, undefined)).toBe("Psalm 6");
  });
});

describe("formatReference in the reader's language", () => {
  afterEach(() => setTablesForTests("en", []));

  it("uses the phone's wording for the Psalm and the verse", () => {
    setTablesForTests("es", [
      { psalmTitle: "Salmo {{chapter}}", psalmSubtitle: "Salmo {{chapter}}:{{verse}}" },
    ]);
    expect(formatReference(22)).toBe("Salmo 23");
    expect(formatReference(22, 0)).toBe("Salmo 23:1");
    expect(formatVerseForCopy(22, 0, "El Señor es mi pastor")).toBe(
      "Salmo 23:1 — El Señor es mi pastor"
    );
  });

  it("lets a language put the number first", () => {
    setTablesForTests("ja", [
      { psalmTitle: "{{chapter}}篇", psalmSubtitle: "{{chapter}}篇{{verse}}節" },
    ]);
    expect(formatReference(22, 0)).toBe("23篇1節");
  });
});

describe("formatVerseForCopy", () => {
  it("puts the reference before the text", () => {
    expect(formatVerseForCopy(22, 0, "The LORD is my shepherd")).toBe(
      "Psalm 23:1 — The LORD is my shepherd"
    );
  });
});

describe("parseChapterInput", () => {
  it("accepts every chapter in range", () => {
    expect(parseChapterInput("1")).toBe(0);
    expect(parseChapterInput("150")).toBe(149);
    expect(parseChapterInput(" 23 ")).toBe(22);
  });

  const rejected = [
    "0",
    "151",
    "-1",
    "",
    "   ",
    "abc",
    "1.5",
    "1e2",
    "٢٣",
    "12a",
    "999",
    null,
    undefined,
    "1 2",
  ];
  it.each(rejected)("rejects %j", (input) => {
    expect(parseChapterInput(input)).toBeNull();
  });
});

describe("wrapChapter", () => {
  it("wraps in both directions", () => {
    expect(wrapChapter(0)).toBe(0);
    expect(wrapChapter(149)).toBe(149);
    expect(wrapChapter(150)).toBe(0);
    expect(wrapChapter(-1)).toBe(149);
    expect(wrapChapter(-151)).toBe(149);
    expect(wrapChapter(300)).toBe(0);
  });
});

describe("random selection", () => {
  it("covers the first and last chapter and never leaves the range", () => {
    expect(getRandomChapterIndex(() => 0)).toBe(0);
    expect(getRandomChapterIndex(() => 0.999999)).toBe(CHAPTER_COUNT - 1);
    for (let i = 0; i < 3000; i++) {
      const index = getRandomChapterIndex();
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(CHAPTER_COUNT);
    }
  });

  it("reaches every chapter given enough draws", () => {
    const seen = new Set();
    for (let i = 0; i < 50000 && seen.size < CHAPTER_COUNT; i++) {
      seen.add(getRandomChapterIndex());
    }
    expect(seen.size).toBe(CHAPTER_COUNT);
  });

  it("picks a valid verse in the shortest and longest chapters", () => {
    // Psalm 117 has 2 verses; Psalm 119 has 176.
    for (const chapterIndex of [116, 118]) {
      const chapter = psalms[chapterIndex];
      expect(getRandomVerseIndex(chapter, () => 0)).toBe(0);
      expect(getRandomVerseIndex(chapter, () => 0.999999)).toBe(chapter.length - 1);
      for (let i = 0; i < 500; i++) {
        const index = getRandomVerseIndex(chapter);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(chapter.length);
      }
    }
  });

  it("does not produce a negative index for an empty chapter", () => {
    expect(getRandomVerseIndex([])).toBe(0);
    expect(getRandomVerseIndex(null)).toBe(0);
  });
});

describe("reference validation", () => {
  it("accepts real references across the whole book", () => {
    expect(isChapterRef(psalms, 0)).toBe(true);
    expect(isChapterRef(psalms, 149)).toBe(true);
    expect(isVerseRef(psalms, 0, 0)).toBe(true);
    expect(isVerseRef(psalms, 116, 1)).toBe(true); // Psalm 117:2, the last verse
    expect(isVerseRef(psalms, 118, 175)).toBe(true); // Psalm 119:176
  });

  it("rejects references past the end of a chapter", () => {
    expect(isVerseRef(psalms, 116, 2)).toBe(false); // Psalm 117 has only 2 verses
    expect(isVerseRef(psalms, 118, 176)).toBe(false);
    expect(isChapterRef(psalms, 150)).toBe(false);
    expect(isChapterRef(psalms, -1)).toBe(false);
  });

  it("rejects non-integer and missing input without throwing", () => {
    expect(isVerseRef(psalms, 1.5, 0)).toBe(false);
    expect(isVerseRef(psalms, "1", 0)).toBe(false);
    expect(isVerseRef(psalms, 0, null)).toBe(false);
    expect(isVerseRef(null, 0, 0)).toBe(false);
    expect(isChapterRef(undefined, 0)).toBe(false);
  });
});

describe("hasChapter", () => {
  // No shipped version has a gap, but a damaged file could: the reader asks before rendering.
  const data = [["In the beginning"], [], ["a", "b"], null];

  it("is true for a chapter with verses", () => {
    expect(hasChapter(data, 0)).toBe(true);
    expect(hasChapter(data, 2)).toBe(true);
    expect(hasChapter(psalms, 149)).toBe(true);
  });

  it("is false for an empty or damaged chapter, so a gap is reported rather than rendered blank", () => {
    expect(hasChapter(data, 1)).toBe(false);
    expect(hasChapter(data, 3)).toBe(false);
  });

  it("is false past the end of the version and for input that is not a chapter number", () => {
    expect(hasChapter(data, 4)).toBe(false);
    expect(hasChapter(data, -1)).toBe(false);
    expect(hasChapter(data, 0.5)).toBe(false);
    expect(hasChapter(data, "0")).toBe(false);
    expect(hasChapter(null, 0)).toBe(false);
  });
});

describe("getData", () => {
  it("loads and caches the bundled text", async () => {
    const fetchMock = serve();

    const first = await getData();
    const second = await getData();

    expect(first).toHaveLength(CHAPTER_COUNT);
    expect(second).toBe(first);
    expect(fetchMock.mock.calls.filter(([path]) => path === "psalms.json")).toHaveLength(1);
  });

  it("raises a DataError when psalms.json cannot be read", async () => {
    const fetchMock = serve();
    // The list of versions loads; only the text itself fails.
    fetchMock.mockImplementation(async (path) => {
      if (path === "bibles/index.json") return okJson(catalogue);
      throw new Error("net::ERR_FILE_NOT_FOUND");
    });

    await expect(getData()).rejects.toBeInstanceOf(DataError);
    expect(fetchMock).toHaveBeenCalledWith("psalms.json");
  });

  it("raises a DataError when the list of versions cannot be read", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("net::ERR_FILE_NOT_FOUND");
    });
    await expect(getData()).rejects.toThrow(/list of Bible versions/);
  });

  it("raises a DataError on a non-OK response", async () => {
    serve({ "psalms.json": { ok: false, status: 404 } });
    await expect(getData()).rejects.toThrow(/404/);
  });

  it("raises a DataError when the text is the wrong shape", async () => {
    serve({ "psalms.json": okJson({ nope: true }) });
    await expect(getData()).rejects.toThrow(/not in the expected format/);
  });

  it("raises a DataError when a chapter is missing", async () => {
    serve({ "psalms.json": okJson(psalms.slice(0, 149)) });
    await expect(getData()).rejects.toThrow(/not in the expected format/);
  });

  it("does not cache a failure", async () => {
    serve().mockImplementation(async (path) => {
      if (path === "bibles/index.json") return okJson(catalogue);
      throw new Error("offline");
    });
    await expect(getData()).rejects.toBeInstanceOf(DataError);
    serve();
    await expect(getData()).resolves.toHaveLength(CHAPTER_COUNT);
  });

  it("returns the chosen version's chapters, as the list says it has them", async () => {
    installChromeMock();
    serve({ "bibles/short.json": okJson(shortVersion) });

    await setCurrentVersion("short");

    const data = await getData();
    expect(data).toEqual(shortVersion);
    expect(isChapterRef(data, 2)).toBe(false);
  });

  it("goes back to the bundled text when the cache is reset", async () => {
    installChromeMock();
    serve({ "bibles/short.json": okJson(shortVersion) });
    await setCurrentVersion("short");
    expect(await getData()).toHaveLength(2);

    resetDataCache();

    expect(await getData()).toHaveLength(CHAPTER_COUNT);
  });
});
