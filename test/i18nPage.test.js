// @vitest-environment jsdom
// What the interface language does to the page: the document's direction, the
// marked-up text, and the English wording the extension ships. The lookup rules
// themselves are in i18n.test.js.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { icon } from "../src/icons.js";
import { hydrateIcons } from "../src/dom.js";
import { applyTranslations, dateLocale, initI18n, setTablesForTests, t } from "../src/i18n.js";

const readJson = (path) => JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));

beforeEach(() => {
  setTablesForTests("en", []);
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the document's direction", () => {
  // Every language file exists and is empty: only the page's attributes are under test here.
  beforeEach(() =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    )
  );

  it.each(["ar", "fa", "he", "ur", "ug"])("is right to left for %s", async (code) => {
    await initI18n(code);
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe(code);
  });

  it.each(["en", "de", "ta", "zh"])("is left to right for %s", async (code) => {
    await initI18n(code);
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(document.documentElement.getAttribute("lang")).toBe(code);
  });

  it("follows the browser's language for 'auto'", async () => {
    vi.stubGlobal("navigator", { languages: ["he-IL"] });
    await initI18n("auto");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("switches back when the reader moves from a right-to-left language to a left-to-right one", async () => {
    await initI18n("ar");
    await initI18n("fr");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(document.documentElement.getAttribute("lang")).toBe("fr");
  });
});

describe("choosing a language twice in quick succession", () => {
  it("ends in the language chosen last, even when the earlier one finishes loading later", async () => {
    let releaseGerman;
    const german = new Promise((resolve) => (releaseGerman = resolve));
    const files = {
      "locales/ext/en.json": {},
      "locales/app/en.json": {},
      "locales/ext/de.json": { greeting: "Hallo" },
      "locales/app/de.json": {},
      "locales/ext/fr.json": { greeting: "Bonjour" },
      "locales/app/fr.json": {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => {
        if (path === "locales/ext/de.json") await german;
        return { ok: path in files, status: 404, json: async () => files[path] };
      })
    );

    const first = initI18n("de");
    const second = initI18n("fr");
    expect(await second).toBe("fr");
    releaseGerman();
    await first;

    expect(t("greeting")).toBe("Bonjour");
    expect(document.documentElement.getAttribute("lang")).toBe("fr");
  });
});

describe("applyTranslations", () => {
  function mount(markup) {
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    document.body.replaceChildren(...parsed.body.childNodes);
  }

  it("fills the text, title, aria-label and placeholder of marked elements", () => {
    setTablesForTests("de", [
      {
        save: "Speichern",
        closeNote: "Notiz schließen",
        searchBox: "Suchen…",
        psalmsWay: "Psalms Way",
      },
    ]);
    mount(`
      <h2 data-i18n="psalmsWay">Psalms Way</h2>
      <button id="b" data-i18n="save" data-i18n-title="closeNote" data-i18n-aria-label="closeNote">Save</button>
      <input id="i" data-i18n-placeholder="searchBox" placeholder="Search…" />
    `);
    applyTranslations();
    expect(document.querySelector("h2").textContent).toBe("Psalms Way");
    const button = document.getElementById("b");
    expect(button.textContent).toBe("Speichern");
    expect(button.title).toBe("Notiz schließen");
    expect(button.getAttribute("aria-label")).toBe("Notiz schließen");
    expect(document.getElementById("i").getAttribute("placeholder")).toBe("Suchen…");
  });

  it("keeps the English already in the markup when no language has the key", () => {
    mount(`
      <span data-i18n="noSuchKey">  Plain English  </span>
      <button data-i18n-title="noSuchTitle" title="Title in English"></button>
      <input data-i18n-placeholder="noSuchPlaceholder" placeholder="Type here" />
    `);
    applyTranslations();
    expect(document.querySelector("span").textContent).toBe("Plain English");
    expect(document.querySelector("button").title).toBe("Title in English");
    expect(document.querySelector("input").placeholder).toBe("Type here");
  });

  it("leaves an icon button's icon in place when the label has its own span", () => {
    setTablesForTests("de", [{ exportButton: "Exportieren…" }]);
    mount(`
      <button id="btnExport" data-icon="download" data-icon-size="14">
        <span data-i18n="exportButton">Export…</span>
      </button>
    `);
    hydrateIcons();
    const before = document.querySelector("#btnExport svg");
    expect(before).not.toBeNull();

    applyTranslations();

    expect(document.querySelector("#btnExport span").textContent).toBe("Exportieren…");
    expect(document.querySelector("#btnExport svg")).toBe(before);
  });

  it("can be run again after the language changes, and the new language replaces the old", () => {
    mount(`<button data-i18n="save">Save</button>`);
    setTablesForTests("de", [{ save: "Speichern" }]);
    applyTranslations();
    setTablesForTests("fr", [{ save: "Enregistrer" }]);
    applyTranslations();
    expect(document.querySelector("button").textContent).toBe("Enregistrer");
  });

  it("only touches the part of the page it is given", () => {
    setTablesForTests("de", [{ save: "Speichern" }]);
    mount(
      `<div id="a"><b data-i18n="save">Save</b></div><div id="b"><b data-i18n="save">Save</b></div>`
    );
    applyTranslations(document.getElementById("a"));
    expect(document.querySelector("#a b").textContent).toBe("Speichern");
    expect(document.querySelector("#b b").textContent).toBe("Save");
  });

  it("does not turn a translation into markup", () => {
    setTablesForTests("de", [{ save: "<img src=x onerror=alert(1)>" }]);
    mount(`<button data-i18n="save">Save</button>`);
    applyTranslations();
    expect(document.querySelector("button img")).toBeNull();
    expect(document.querySelector("button").textContent).toBe("<img src=x onerror=alert(1)>");
    // An icon is still a real element elsewhere.
    expect(icon("check").tagName.toLowerCase()).toBe("svg");
  });
});

describe("the dates' locale", () => {
  it("is the browser's own variant of the chosen language", () => {
    setTablesForTests("en", []);
    vi.stubGlobal("navigator", { languages: ["en-GB", "de"] });
    expect(dateLocale()).toBe("en-GB");
  });

  it("is the language itself when the browser does not speak it", () => {
    setTablesForTests("ta", []);
    vi.stubGlobal("navigator", { languages: ["en-GB"] });
    expect(dateLocale()).toBe("ta");
  });

  it("is the language when there is no browser to ask", () => {
    setTablesForTests("fr", []);
    vi.stubGlobal("navigator", undefined);
    expect(dateLocale()).toBe("fr");
  });
});

describe("the English wording that ships", () => {
  const ext = readJson("locales/ext/en.json");
  const app = readJson("locales/app/en.json");

  beforeEach(() => setTablesForTests("en", [ext, app]));

  it.each([
    ["statsLongestStreak", 1, "Longest streak: 1 day"],
    ["statsLongestStreak", 2, "Longest streak: 2 days"],
    ["statsLongestStreak", 0, "Longest streak: 0 days"],
    ["challengeDays", 1, "1 day"],
    ["challengeDays", 40, "40 days"],
    ["todayStreak", 1, "1-day streak"],
    ["todayStreak", 12, "12-day streak"],
    ["prayerCount", 1, "1 prayer"],
    ["prayerCount", 6, "6 prayers"],
    ["searchMatches", 1, "1 match"],
    ["searchMatches", 12, "12 matches"],
    ["searchMinCharacters", 1, "Type at least 1 character, then press Enter."],
    ["searchMinCharacters", 2, "Type at least 2 characters, then press Enter."],
    ["syncConnectedAdded", 1, "Connected. 1 item came from your phone."],
    ["syncConnectedAdded", 3, "Connected. 3 items came from your phone."],
    ["chapterVerseCount", 1, "{{reference}}, 1 verse"],
    ["chapterVerseCount", 176, "{{reference}}, 176 verses"],
  ])("says %s correctly for %i", (key, count, expected) => {
    expect(t(key, { count })).toBe(expected);
  });

  it("spells Favourites the British way, where the phone says Favorites", () => {
    expect(t("statFavorites")).toBe("Favourites");
    expect(app.statFavorites).toBe("Favorites");
  });

  it("names the Psalm the phone's way", () => {
    expect(t("psalmTitle", { chapter: 23 })).toBe("Psalm 23");
    expect(t("psalmSubtitle", { chapter: 23, verse: 1 })).toBe("Psalm 23:1");
  });
});
