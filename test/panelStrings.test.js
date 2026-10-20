// @vitest-environment jsdom
// The wording of the search and Library panels: the English that ships (with its
// singular and plural forms) and the same sentences in another language.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as storage from "../src/storage.js";
import { setTablesForTests } from "../src/i18n.js";
import { getData } from "../src/data.js";
import { runSearch, setNavigator, showLibraryTab, renderHistory } from "../src/panels.js";

vi.mock("../src/data.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getData: vi.fn(),
}));

const readJson = (path) => JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
const english = [readJson("locales/ext/en.json"), readJson("locales/app/en.json")];

/** Chapter 1 has `count` verses that all say "needle"; chapter 2 has one that says "rare". */
const dataWith = (count) => [
  Array.from({ length: count }, (_, v) => `needle verse ${v + 1}`),
  ["a rare word"],
];

function mountPopup() {
  const parsed = new DOMParser().parseFromString(
    `<p id="searchCount"></p>
     <div id="searchResults"></div>
     <div id="libraryTabs" role="tablist">
       <button role="tab" data-tab="favourites"></button>
       <button role="tab" data-tab="highlights"></button>
       <button role="tab" data-tab="chapters"></button>
       <button role="tab" data-tab="notes"></button>
     </div>
     <div id="libraryBody"></div>
     <button id="btnClearHistory" type="button"></button>
     <div id="historyBody"></div>
     <div id="statusBar" hidden></div>
     <div id="dialogHost" hidden></div>`,
    "text/html"
  );
  document.body.replaceChildren(...parsed.body.childNodes);
}

const count = () => document.getElementById("searchCount").textContent;
const results = () => document.getElementById("searchResults").textContent;

beforeEach(() => {
  storage.resetStoreCache();
  installChromeMock({});
  mountPopup();
  setNavigator(() => {});
  getData.mockResolvedValue(dataWith(3));
  setTablesForTests("en", english);
});

describe("search, in English", () => {
  it("asks for more characters, with the number in the right form", async () => {
    await runSearch("n");
    expect(results()).toContain("Search the Psalms");
    expect(results()).toContain("Type at least 2 characters, then press Enter.");
    expect(count()).toBe("");
  });

  it("counts one match as a match and several as matches", async () => {
    await runSearch("rare");
    expect(count()).toBe("1 match");
    await runSearch("needle");
    expect(count()).toBe("3 matches");
  });

  it("says how many it is showing when there are more than it lists", async () => {
    getData.mockResolvedValue(dataWith(120));
    await runSearch("needle");
    expect(count()).toBe("Showing first 50 of 120 matches");
  });

  it("says nothing matched, quoting what was searched for", async () => {
    await runSearch("zzz");
    expect(results()).toContain("No verse contains “zzz”.");
    expect(results()).toContain("Try a shorter or more common word.");
  });
});

describe("search, in another language", () => {
  it("uses that language for the sentences and fills in what was typed and counted", async () => {
    setTablesForTests("de", [
      {
        searchNoVerse: "Kein Vers enthält „{{query}}“.",
        searchMatches_one: "{{count}} Treffer",
        searchMatches_other: "{{count}} Treffer",
        searchShowingFirst: "Die ersten {{shown}} von {{count}} Treffern",
      },
      ...english,
    ]);
    await runSearch("zzz");
    expect(results()).toContain("Kein Vers enthält „zzz“.");
    await runSearch("rare");
    expect(count()).toBe("1 Treffer");
    getData.mockResolvedValue(dataWith(120));
    await runSearch("needle");
    expect(count()).toBe("Die ersten 50 von 120 Treffern");
  });
});

describe("the Library and history, in English", () => {
  it("explains an empty Bookmarks tab", async () => {
    await showLibraryTab("favourites");
    const body = document.getElementById("libraryBody").textContent;
    expect(body).toContain("No bookmarks yet");
    expect(body).toContain("Open a Psalm, select a verse, and choose Bookmark to keep it here.");
  });

  it("explains an empty Notes tab", async () => {
    await showLibraryTab("notes");
    const body = document.getElementById("libraryBody").textContent;
    expect(body).toContain("No notes yet");
    expect(body).toContain("Select a verse while reading and choose Note to write something down.");
  });

  it("explains empty history", async () => {
    await renderHistory();
    const body = document.getElementById("historyBody").textContent;
    expect(body).toContain("Nothing read yet");
    expect(body).toContain("Psalms you open appear here, most recent first.");
  });

  it("labels a bookmark's remove button in the reader's language", async () => {
    await storage.toggleFavourite(0, 0);
    setTablesForTests("de", [
      {
        bookmarkRemoveOn: "Lesezeichen bei {{reference}} entfernen",
        psalmSubtitle: "Psalm {{chapter}},{{verse}}",
      },
      ...english,
    ]);
    await showLibraryTab("favourites");
    const remove = document.querySelector("#libraryBody .btn-row-action");
    expect(remove.getAttribute("aria-label")).toBe("Lesezeichen bei Psalm 1,1 entfernen");
  });
});
