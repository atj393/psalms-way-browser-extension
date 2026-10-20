// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setTablesForTests } from "../src/i18n.js";
import { parsePsalmReference, renderPrayers, resetPrayersCache } from "../src/prayers.js";

const REAL = JSON.parse(readFileSync(resolve(process.cwd(), "data/prayers-en.json"), "utf8"));
// The English that ships, so "1 prayer" and "6 prayers" come from the plural forms in the table.
const EXTENSION_ENGLISH = JSON.parse(
  readFileSync(resolve(process.cwd(), "locales/ext/en.json"), "utf8")
);

// Small catalogue for the cases the real file does not contain: one prayer in
// a category, a reference to a whole Psalm, references the reader cannot map,
// a prayer with no references, and an occasion the app does not know.
const FIXTURE = {
  categories: [
    { id: "one", name: "One Prayer Only", i18nKey: "prayerCatOne" },
    { id: "none", name: "Nothing Here", i18nKey: "prayerCatNone" },
    { id: "refs", name: "Odd References", i18nKey: "prayerCatRefs" },
  ],
  prayers: [
    {
      id: "one_001",
      categoryId: "one",
      title: "Only Prayer",
      prayer: "A prayer for one.",
      occasion: "seasonal",
      tags: [],
      psalmsReference: ["23"],
    },
    {
      id: "refs_001",
      categoryId: "refs",
      title: "Odd References Prayer",
      prayer: "A prayer with odd references.",
      occasion: "daily",
      tags: [],
      psalmsReference: ["23:1", "0:1", "151:1", "5:0", "Isaiah 41:10"],
    },
    {
      id: "refs_002",
      categoryId: "refs",
      title: "Prayer Without References",
      prayer: "A prayer with none.",
      occasion: "someday",
      tags: [],
    },
  ],
};

function stubFetch(json) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => json }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const body = () => document.getElementById("prayersBody");
const rows = () => [...body().querySelectorAll(".prayer-row")];
const rowTitle = (row) => row.querySelector(".prayer-row-title").textContent;
const rowSub = (row) => row.querySelector(".prayer-row-sub")?.textContent ?? null;
const rowNamed = (name) => rows().find((row) => rowTitle(row) === name);
const backButton = () => body().querySelector(".prayer-back");
const heading = () => body().querySelector(".prayer-heading").textContent;
const refButtons = () => [...body().querySelectorAll("button.prayer-ref")];
const copyButton = () => body().querySelector(".prayer-copy");

async function open(catalogue = REAL) {
  stubFetch(catalogue);
  const navigate = vi.fn();
  await renderPrayers({ navigate });
  return navigate;
}

beforeEach(() => {
  resetPrayersCache();
  setTablesForTests("en", [EXTENSION_ENGLISH]);
  document.body.innerHTML = `
    <div class="status-bar" id="statusBar" hidden></div>
    <div id="prayersBody" tabindex="-1"></div>
  `;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete navigator.clipboard;
});

describe("the bundled prayers file", () => {
  // The phone's file, unchanged: a plain list of 50 prayers.
  it("has 19 categories and 50 prayers, every one a plain object", () => {
    expect(REAL.categories).toHaveLength(19);
    expect(REAL.prayers).toHaveLength(50);
    for (const prayer of REAL.prayers) {
      expect(Array.isArray(prayer)).toBe(false);
      expect(prayer).toEqual(
        expect.objectContaining({ id: expect.any(String), categoryId: expect.any(String) })
      );
    }
    const categories = new Set(REAL.categories.map((category) => category.id));
    expect(REAL.prayers.every((prayer) => categories.has(prayer.categoryId))).toBe(true);
  });
});

describe("category list", () => {
  it("shows the 19 categories, each one a button", async () => {
    await open();
    expect(rows()).toHaveLength(19);
    expect(rowTitle(rows()[0])).toBe("Morning");
    expect(rowTitle(rows()[18])).toBe("Serving Others");
    for (const row of rows()) {
      expect(row.tagName).toBe("BUTTON");
      expect(row.getAttribute("type")).toBe("button");
    }
    expect(backButton()).toBeNull();
  });

  it("names a category in the reader's language, or in English when the key is missing", async () => {
    setTablesForTests("de", [{ prayerCatMorning: "Morgen" }]);
    await open();
    expect(rowTitle(rows()[0])).toBe("Morgen");
    expect(rowTitle(rows()[12])).toBe("Healing");
  });

  it("counts the prayers in each category", async () => {
    await open();
    expect(rowSub(rowNamed("Morning"))).toBe("6 prayers");
    expect(rowSub(rowNamed("Noon"))).toBe("2 prayers");
  });

  it("says 1 prayer, not 1 prayers", async () => {
    await open(FIXTURE);
    expect(rowSub(rowNamed("One Prayer Only"))).toBe("1 prayer");
  });

  it("lists all 50 prayers, so no category is empty", async () => {
    await open();
    const counts = rows().map((row) => Number.parseInt(rowSub(row), 10));
    expect(counts.every((count) => count >= 1)).toBe(true);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(50);
    expect(rowSub(rowNamed("Hope & Future"))).toBe("3 prayers");
    expect(rowSub(rowNamed("Patience & Waiting"))).toBe("1 prayer");
    expect(rowSub(rowNamed("Wisdom & Decisions"))).toBe("1 prayer");
    expect(rowSub(rowNamed("Serving Others"))).toBe("2 prayers");
  });

  it("says so on a category that has no prayers", async () => {
    await open(FIXTURE);
    expect(rowSub(rowNamed("Nothing Here"))).toBe("No prayers in this category yet");
  });
});

describe("prayer list", () => {
  it("shows a category's prayers with their occasion, and moves focus to Back", async () => {
    await open();
    rowNamed("Morning").click();

    expect(heading()).toBe("Morning");
    expect(rows().map(rowTitle)).toEqual([
      "A Prayer to Start the Day",
      "Prayer for Strength This Morning",
      "Prayer of Thanksgiving at Dawn",
      "A Simple Act of Praise",
      "Prayer for Emotional Stability",
      "Prayer for a Heart of Joy",
    ]);
    expect(rowSub(rows()[0])).toBe("Daily");
    expect(document.activeElement).toBe(backButton());
  });

  it("lists the prayers the phone's file nests, and opens one", async () => {
    await open();
    rowNamed("Hope & Future").click();

    expect(heading()).toBe("Hope & Future");
    expect(rows().map(rowTitle)).toEqual([
      "A Prayer for a Bright Future",
      "Prayer for Light in the Darkness",
      "Prayer for a New Beginning",
    ]);
    expect(rowSub(rows()[1])).toBe("Situational");

    rows()[0].click();
    expect(heading()).toBe("A Prayer for a Bright Future");
    expect(refButtons().map((button) => button.textContent)).toEqual([
      "Psalm 33:22",
      "Psalm 130:5",
    ]);
  });

  it("shows the empty text when the category has no prayers", async () => {
    await open(FIXTURE);
    rowNamed("Nothing Here").click();

    expect(heading()).toBe("Nothing Here");
    expect(rows()).toHaveLength(0);
    expect(body().textContent).toContain("No prayers in this category yet");
    expect(document.activeElement).toBe(backButton());
  });

  it("names an occasion in the reader's language, and shows none it does not know", async () => {
    setTablesForTests("de", [{ prayerOccasionSeasonal: "Jahreszeitlich" }]);
    await open(FIXTURE);
    rowNamed("One Prayer Only").click();
    expect(rowSub(rows()[0])).toBe("Jahreszeitlich");

    backButton().click();
    rowNamed("Odd References").click();
    expect(rowSub(rows()[0])).toBe("Daily");
    expect(rowSub(rows()[1])).toBeNull();
  });

  it("goes back to the categories and puts focus on the one it came from", async () => {
    await open();
    rowNamed("Evening").click();
    backButton().click();

    expect(rows()).toHaveLength(19);
    expect(backButton()).toBeNull();
    expect(document.activeElement).toBe(rowNamed("Evening"));
  });
});

describe("prayer detail", () => {
  async function openFirstMorningPrayer() {
    const navigate = await open();
    rowNamed("Morning").click();
    rows()[0].click();
    return navigate;
  }

  it("shows the title, the text and the references, and moves focus to Back", async () => {
    await openFirstMorningPrayer();
    const prayer = REAL.prayers[0];

    expect(heading()).toBe(prayer.title);
    expect(body().querySelector(".prayer-text").textContent).toBe(prayer.prayer);
    expect(refButtons().map((button) => button.textContent)).toEqual(["Psalm 5:3", "Psalm 143:8"]);
    expect(copyButton()).not.toBeNull();
    expect(document.activeElement).toBe(backButton());
  });

  it("goes back to the list and puts focus on the prayer it came from", async () => {
    await openFirstMorningPrayer();
    backButton().click();

    expect(heading()).toBe("Morning");
    expect(rows()).toHaveLength(6);
    expect(document.activeElement).toBe(rows()[0]);

    backButton().click();
    expect(rows()).toHaveLength(19);
    expect(document.activeElement).toBe(rowNamed("Morning"));
  });

  it("leaves out the references section when a prayer has none", async () => {
    await open(FIXTURE);
    rowNamed("Odd References").click();
    rows()[1].click();

    expect(heading()).toBe("Prayer Without References");
    expect(body().querySelector(".prayer-refs")).toBeNull();
    expect(body().textContent).not.toContain("Scripture References");
  });

  it("starts again at the categories each time the panel is opened", async () => {
    await open();
    rowNamed("Morning").click();
    rows()[0].click();

    await renderPrayers({ navigate: vi.fn() });
    expect(rows()).toHaveLength(19);
    expect(backButton()).toBeNull();
  });
});

describe("Psalm references", () => {
  it("opens the verse a reference names, in the reading view", async () => {
    const navigate = await open();
    rowNamed("Noon").click();
    rows()[1].click();

    expect(heading()).toBe("Prayer for Rest at Noon");
    expect(refButtons().map((button) => button.textContent)).toEqual(["Psalm 23:2", "Psalm 62:1"]);
    refButtons()[0].click();

    expect(navigate.mock.calls).toEqual([[{ chapterIndex: 22, verseIndex: 1 }]]);
  });

  it("opens the whole Psalm for a reference without a verse", async () => {
    const navigate = await open(FIXTURE);
    rowNamed("One Prayer Only").click();
    rows()[0].click();

    expect(refButtons().map((button) => button.textContent)).toEqual(["Psalm 23"]);
    refButtons()[0].click();
    expect(navigate.mock.calls).toEqual([[{ chapterIndex: 22, verseIndex: null }]]);
  });

  it("shows a reference it cannot map as plain text, not a link", async () => {
    await open(FIXTURE);
    rowNamed("Odd References").click();
    rows()[0].click();

    expect(refButtons().map((button) => button.textContent)).toEqual(["Psalm 23:1"]);
    const plain = [...body().querySelectorAll(".prayer-ref.is-plain")];
    expect(plain.map((node) => node.textContent)).toEqual(["0:1", "151:1", "5:0", "Isaiah 41:10"]);
    expect(plain.every((node) => node.tagName === "SPAN")).toBe(true);
  });

  it("maps every reference in the bundled file", () => {
    const references = REAL.prayers.flatMap((prayer) => prayer.psalmsReference);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(parsePsalmReference(reference), reference).not.toBeNull();
    }
  });
});

describe("parsePsalmReference", () => {
  it("turns chapter:verse into 0-based indices", () => {
    expect(parsePsalmReference("23:1")).toEqual({ chapterIndex: 22, verseIndex: 0 });
    expect(parsePsalmReference("119:176")).toEqual({ chapterIndex: 118, verseIndex: 175 });
    expect(parsePsalmReference("150:6")).toEqual({ chapterIndex: 149, verseIndex: 5 });
  });

  it("turns a bare chapter into a whole-Psalm reference", () => {
    expect(parsePsalmReference("23")).toEqual({ chapterIndex: 22, verseIndex: null });
  });

  it("returns null for anything it cannot place", () => {
    for (const reference of [
      "",
      "0",
      "151",
      "0:1",
      "5:0",
      "23:",
      ":3",
      "23:1-3",
      "Psalm 23",
      "a:b",
    ]) {
      expect(parsePsalmReference(reference), reference).toBeNull();
    }
    expect(parsePsalmReference(undefined)).toBeNull();
    expect(parsePsalmReference(23)).toBeNull();
  });
});

describe("Copy", () => {
  const COPIED = [
    "A Prayer to Start the Day",
    REAL.prayers[0].prayer,
    "Scripture Reference: Psalm 5:3, Psalm 143:8",
    "Shared from Psalms Way",
  ].join("\n\n");

  async function openFirstMorningPrayer() {
    await open();
    rowNamed("Morning").click();
    rows()[0].click();
  }

  it("puts the title, the prayer, the references and the credit on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await openFirstMorningPrayer();

    copyButton().click();

    await vi.waitFor(() => expect(writeText.mock.calls).toEqual([[COPIED]]));
    await vi.waitFor(() =>
      expect(document.getElementById("statusBar").textContent).toContain("Prayer copied")
    );
  });

  it("copies a prayer with no references without the references line", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await open(FIXTURE);
    rowNamed("Odd References").click();
    rows()[1].click();

    copyButton().click();

    await vi.waitFor(() =>
      expect(writeText.mock.calls).toEqual([
        ["Prayer Without References\n\nA prayer with none.\n\nShared from Psalms Way"],
      ])
    );
  });

  it("tells the reader when the browser blocks the copy", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await openFirstMorningPrayer();

    copyButton().click();

    await vi.waitFor(() =>
      expect(document.getElementById("statusBar").textContent).toContain("blocked the copy")
    );
    expect(document.getElementById("statusBar").querySelector(".status-error")).not.toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("loading", () => {
  it("reads the file once and keeps it", async () => {
    const fetchMock = stubFetch(REAL);
    await renderPrayers({ navigate: vi.fn() });
    await renderPrayers({ navigate: vi.fn() });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("data/prayers-en.json");
  });

  it("says so when the file cannot be read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    await renderPrayers({ navigate: vi.fn() });

    expect(body().textContent).toContain("The prayers could not be loaded.");
    expect(document.getElementById("statusBar").textContent).toContain(
      "The prayers could not be loaded."
    );
    expect(consoleError).toHaveBeenCalled();
  });

  it("says so when the network fails, and tries again next time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await renderPrayers({ navigate: vi.fn() });
    expect(body().textContent).toContain("The prayers could not be loaded.");

    await open();
    expect(rows()).toHaveLength(19);
  });

  it("says so when the file is not shaped like the prayers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch({ categories: "nope" });
    await renderPrayers({ navigate: vi.fn() });

    expect(body().textContent).toContain("The prayers could not be loaded.");
  });
});

describe("the Back button's name", () => {
  it("says it goes back to the categories, from a category's prayers", async () => {
    await open();
    rowNamed("Morning").click();

    expect(backButton().getAttribute("aria-label")).toBe("Back to categories");
    // The word on the button is unchanged, and the name contains it.
    expect(backButton().textContent).toBe("Back");
  });

  it("says which category it goes back to, from a prayer", async () => {
    await open();
    rowNamed("Morning").click();
    rows()[0].click();

    expect(backButton().getAttribute("aria-label")).toBe("Back to Morning");
  });

  it("names the place in the reader's language", async () => {
    setTablesForTests("de", [
      {
        prayerBackToCategories: "Zurück zu den Kategorien",
        prayerBackTo: "Zurück zu {{name}}",
        prayerCatMorning: "Morgen",
        prayerBack: "Zurück",
      },
    ]);
    await open();
    rowNamed("Morgen").click();
    expect(backButton().getAttribute("aria-label")).toBe("Zurück zu den Kategorien");
    expect(backButton().textContent).toBe("Zurück");

    rows()[0].click();
    expect(backButton().getAttribute("aria-label")).toBe("Zurück zu Morgen");
  });
});

describe("the prayers' own language", () => {
  // The titles and texts are English on the phone too, so they are marked as English
  // and keep their direction when the rest of the popup reads right to left.
  it("marks a prayer's title and text as English, but not the translated category name", async () => {
    await open();
    rowNamed("Morning").click();

    expect(body().querySelector(".prayer-heading").hasAttribute("lang")).toBe(false);
    expect(rows()[0].querySelector(".prayer-row-title").getAttribute("lang")).toBe("en");
    expect(rows()[0].querySelector(".prayer-row-title").getAttribute("dir")).toBe("ltr");

    rows()[0].click();
    const prayer = body().querySelector(".prayer-text");
    expect(prayer.getAttribute("lang")).toBe("en");
    expect(prayer.getAttribute("dir")).toBe("ltr");
    expect(body().querySelector(".prayer-heading").getAttribute("lang")).toBe("en");
    expect(body().querySelector(".prayer-copy").hasAttribute("lang")).toBe(false);
  });
});

describe("scripture references in the reader's language", () => {
  it("name a verse and a whole Psalm the way the phone does in that language", async () => {
    setTablesForTests("es", [
      { psalmTitle: "Salmo {{chapter}}", psalmSubtitle: "Salmo {{chapter}}:{{verse}}" },
      EXTENSION_ENGLISH,
    ]);
    await open(FIXTURE);
    rowNamed("One Prayer Only").click();
    rows()[0].click();
    expect(refButtons().map((button) => button.textContent)).toEqual(["Salmo 23"]);

    backButton().click();
    backButton().click();
    rowNamed("Odd References").click();
    rows()[0].click();
    expect(refButtons().map((button) => button.textContent)).toEqual(["Salmo 23:1"]);
  });
});
