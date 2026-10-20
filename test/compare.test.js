// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as store from "../src/storage.js";
import { setTablesForTests } from "../src/i18n.js";

// A small fake catalogue stands in for the real versions: the current one,
// two ordinary ones, a right-to-left one, and one that lacks verse 2.
const fake = vi.hoisted(() => ({
  current: "modern",
  catalogue: [],
  failing: new Set(),
  gate: null,
}));

vi.mock("../src/versions.js", () => ({
  loadCatalogue: async () => fake.catalogue,
  currentVersion: () => fake.current,
  getVersionData: async (module) => {
    if (fake.failing.has(module)) throw new Error(`cannot read ${module}`);
    if (module === "kjv" && fake.gate) {
      const gate = fake.gate;
      fake.gate = null;
      await gate;
    }
    const verses = module === "short" ? ["short 1"] : [`${module} 1`, `${module} 2`];
    return [verses, verses.map((verse) => `${verse} (psalm 2)`)];
  },
}));

const { renderCompare } = await import("../src/compare.js");

function version(module, name, lang_short = "en", rtl = false) {
  return { module, name, lang: lang_short, lang_short, year: "", chapters: 150, rtl, file: "" };
}

function readCards() {
  return [...document.querySelectorAll(".compare-card")].map((card) => {
    const select = card.querySelector("select");
    return {
      select,
      module: select?.value ?? null,
      name: select
        ? select.selectedOptions[0].textContent
        : card.querySelector(".compare-card-name").textContent,
      text: card.querySelector(".compare-text"),
      note: card.querySelector(".compare-note")?.textContent ?? null,
    };
  });
}

function optionValues(select) {
  return [...select.options].map((option) => option.value);
}

/** Chooses a version in a select and waits for the re-render that follows. */
async function pick(select, module) {
  select.value = module;
  select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(select.isConnected).toBe(false));
}

let local;

beforeEach(() => {
  const statusBar = Object.assign(document.createElement("div"), { id: "statusBar", hidden: true });
  const body = Object.assign(document.createElement("div"), { id: "compareBody" });
  document.body.replaceChildren(statusBar, body);
  local = installChromeMock({});
  store.resetStoreCache();
  fake.current = "modern";
  fake.catalogue = [
    version("modern", "NIV"),
    version("kjv", "KJV"),
    version("web", "WEB"),
    version("heb", "Hebrew", "he", true),
    version("short", "Short"),
  ];
  fake.failing.clear();
  fake.gate = null;
  setTablesForTests("en", []);
});

describe("renderCompare", () => {
  it("shows the reference, then the current version and the two saved ones, in order", async () => {
    await renderCompare({ chapterIndex: 0, verseIndex: 1 });

    expect(document.querySelector(".compare-reference").textContent).toBe("Psalm 1:2");
    const cards = readCards();
    expect(cards.map((card) => card.name)).toEqual(["NIV", "KJV", "WEB"]);
    expect(cards.map((card) => card.text.textContent)).toEqual(["modern 2", "kjv 2", "web 2"]);
    // The current version is changed from the header chip, not here.
    expect(cards[0].select).toBeNull();
    expect(cards[1].select).not.toBeNull();
    expect(cards[2].select).not.toBeNull();
  });

  it("uses verse 1 of the chapter when no verse is passed", async () => {
    await renderCompare({ chapterIndex: 1, verseIndex: null });

    expect(document.querySelector(".compare-reference").textContent).toBe("Psalm 2:1");
    expect(readCards().map((card) => card.text.textContent)).toEqual([
      "modern 1 (psalm 2)",
      "kjv 1 (psalm 2)",
      "web 1 (psalm 2)",
    ]);
  });

  it("offers every other version once and never the current one", async () => {
    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    const choiceCards = readCards().slice(1);
    expect(choiceCards).toHaveLength(2);
    for (const { select } of choiceCards) {
      expect(optionValues(select)).toEqual(["kjv", "web", "heb", "short"]);
    }
  });

  it("does not repeat the current version when it is also a saved choice", async () => {
    fake.current = "kjv";
    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    const cards = readCards();
    // Saved choices are kjv and web; kjv is current, so the first other version stands in.
    expect(cards.map((card) => card.name)).toEqual(["KJV", "NIV", "WEB"]);
    for (const { select } of cards.slice(1)) {
      expect(optionValues(select)).not.toContain("kjv");
    }
    // Showing a stand-in is not a write: the saved choices are left as they were.
    expect(local.setCalls).toBe(0);
    expect((await store.getSettings()).compareVersions).toEqual(["kjv", "web"]);
  });

  it("falls back to the first other version for a saved version that is not in the catalogue", async () => {
    await store.updateSettings({ compareVersions: ["gone", "web"] });
    local.setCalls = 0;

    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    expect(readCards().map((card) => card.module)).toEqual([null, "kjv", "web"]);
    expect(local.setCalls).toBe(0);
  });

  it("shows only the current version when it is the only one", async () => {
    fake.catalogue = [version("modern", "NIV")];
    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    const cards = readCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("NIV");
  });

  it("shows a dash and a small note where a version lacks the verse", async () => {
    await store.updateSettings({ compareVersions: ["short", "web"] });

    await renderCompare({ chapterIndex: 0, verseIndex: 1 });

    const [, missing, present] = readCards();
    expect(missing.text.textContent).toBe("—");
    expect(missing.note).toBe("not in this version");
    expect(present.text.textContent).toBe("web 2");
    expect(present.note).toBeNull();
  });

  it("sets dir and lang from the version, right-to-left where the version is", async () => {
    await store.updateSettings({ compareVersions: ["heb", "web"] });

    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    const [current, hebrew, english] = readCards();
    expect(hebrew.text.getAttribute("dir")).toBe("rtl");
    expect(hebrew.text.getAttribute("lang")).toBe("he");
    expect(english.text.getAttribute("dir")).toBe("ltr");
    expect(english.text.getAttribute("lang")).toBe("en");
    expect(current.text.getAttribute("dir")).toBe("ltr");
  });

  it("gives each select its own name for assistive technology", async () => {
    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    const choiceCards = readCards().slice(1);
    expect(choiceCards).toHaveLength(2);
    expect(choiceCards.map(({ select }) => select.getAttribute("aria-label"))).toEqual([
      "First version",
      "Second version",
    ]);
  });

  it("names the selects in the reader's language", async () => {
    setTablesForTests("de", [
      { compareFirstVersion: "Erste Version", compareSecondVersion: "Zweite Version" },
    ]);
    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    expect(
      readCards()
        .slice(1)
        .map(({ select }) => select.getAttribute("aria-label"))
    ).toEqual(["Erste Version", "Zweite Version"]);
  });

  it("saves a new choice, shows that version's text, and keeps focus on the select", async () => {
    await renderCompare({ chapterIndex: 0, verseIndex: 1 });

    await pick(readCards()[2].select, "heb");

    expect((await store.getSettings()).compareVersions).toEqual(["kjv", "heb"]);
    const cards = readCards();
    expect(cards[2].text.textContent).toBe("heb 2");
    expect(cards[1].module).toBe("kjv");
    expect(document.activeElement).toBe(cards[2].select);
  });

  it("allows the same version in both choice cards", async () => {
    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    await pick(readCards()[2].select, "kjv");

    expect(readCards().map((card) => card.name)).toEqual(["NIV", "KJV", "KJV"]);
    expect((await store.getSettings()).compareVersions).toEqual(["kjv", "kjv"]);
  });

  it("reports a failed save and puts the select back to what is saved", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderCompare({ chapterIndex: 0, verseIndex: 0 });
    local.rejectNextSet("disk full");

    await pick(readCards()[1].select, "heb");

    expect(document.getElementById("statusBar").hidden).toBe(false);
    expect(document.getElementById("statusBar").textContent).toBe("Changes could not be saved.");
    expect(consoleError).toHaveBeenCalled();
    expect(readCards()[1].module).toBe("kjv");
    expect((await store.getSettings()).compareVersions).toEqual(["kjv", "web"]);
  });

  it("says so, in that card only, when a version cannot be loaded", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.failing.add("web");

    await renderCompare({ chapterIndex: 0, verseIndex: 0 });

    const [current, kjv, web] = readCards();
    expect(current.text.textContent).toBe("modern 1");
    expect(kjv.text.textContent).toBe("kjv 1");
    expect(web.text.textContent).toBe("—");
    expect(web.note).toBe("This version could not be loaded.");
    expect(document.getElementById("statusBar").hidden).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("lets a newer render win when an older one finishes late", async () => {
    let release;
    fake.gate = new Promise((resolve) => {
      release = resolve;
    });
    const older = renderCompare({ chapterIndex: 0, verseIndex: 0 });

    await renderCompare({ chapterIndex: 0, verseIndex: 1 });
    release();
    await older;

    expect(document.querySelector(".compare-reference").textContent).toBe("Psalm 1:2");
    expect(readCards()[1].text.textContent).toBe("kjv 2");
  });

  it("does nothing when the panel is not in the page", async () => {
    document.body.replaceChildren();

    await expect(renderCompare({ chapterIndex: 0, verseIndex: 0 })).resolves.toBeUndefined();
  });
});
