// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as storage from "../src/storage.js";
import { fromPhoneData, toPhoneData } from "../src/syncModel.js";
import {
  getFavoriteChapters,
  getHighlights,
  highlightOf,
  setHighlight,
  toggleFavoriteChapter,
} from "../src/phoneData.js";
import { getData, wrapChapter } from "../src/data.js";
import {
  getCurrentChapter,
  getCurrentVerse,
  highlightLabel,
  refreshFavChapter,
  setCompareOpener,
  showPassage,
} from "../src/reader.js";
import { getLibraryTab, setNavigator, showLibraryTab } from "../src/panels.js";

// The reader and the Library take their text from the current Bible version.
// A fake one keeps these tests independent of the bundled files.
vi.mock("../src/data.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getData: vi.fn(),
}));

/** `count` chapters of three verses each, e.g. "Psalm 5 verse 2". */
const fakeVersion = (count) =>
  Array.from({ length: count }, (_, c) => [1, 2, 3].map((v) => `Psalm ${c + 1} verse ${v}`));

/**
 * Presses a key the way a browser does: keydown first, then, for Enter or Space on a button
 * that nothing claimed, the button's own click (jsdom does not do that second step itself).
 */
function press(target, key) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  const activates = key === "Enter" || key === " ";
  if (!event.defaultPrevented && activates && target.tagName === "BUTTON") target.click();
  return event;
}

function mountPopup() {
  document.body.innerHTML = `
    <h2 id="chapterTitle"></h2>
    <input id="txtChapter" />
    <button id="btnFavChapter" type="button" aria-pressed="false"></button>
    <button id="btnVersion" type="button"></button>
    <div id="readingView"></div>
    <div id="libraryTabs" role="tablist">
      <button role="tab" data-tab="favourites"></button>
      <button role="tab" data-tab="highlights"></button>
      <button role="tab" data-tab="chapters"></button>
      <button role="tab" data-tab="notes"></button>
    </div>
    <div id="libraryBody"></div>
    <div id="statusBar" hidden></div>
    <div id="dialogHost" hidden></div>
  `;
}

beforeEach(() => {
  storage.resetStoreCache();
  installChromeMock({});
  mountPopup();
  getData.mockResolvedValue(fakeVersion(120));
});

// ─── Data in the phone's shape ────────────────────────────────────────────────

describe("highlights and favourite chapters, as the phone stores them", () => {
  const phoneView = async () => toPhoneData(await storage.loadStore());

  it("sets, replaces in place and removes a highlight", async () => {
    await setHighlight(22, 0, "yellow");
    await setHighlight(90, 3, "blue");
    expect((await phoneView()).highlights).toEqual([
      { chapter: 23, verse: 1, color: "yellow" },
      { chapter: 91, verse: 4, color: "blue" },
    ]);

    await setHighlight(22, 0, "pink");
    expect((await phoneView()).highlights).toEqual([
      { chapter: 23, verse: 1, color: "pink" },
      { chapter: 91, verse: 4, color: "blue" },
    ]);

    await setHighlight(22, 0, null);
    expect((await phoneView()).highlights).toEqual([{ chapter: 91, verse: 4, color: "blue" }]);
  });

  it("keeps a bookmark and a highlight on one verse through a sync round trip", async () => {
    await storage.toggleFavourite(22, 0);
    await setHighlight(22, 0, "green");
    const before = await storage.loadStore();

    const after = fromPhoneData(before, toPhoneData(before));

    expect(after.favourites).toEqual(before.favourites);
    expect(highlightOf(after, 22, 0)).toBe("green");
    expect(toPhoneData(after)).toEqual(toPhoneData(before));
  });

  it("puts a new favourite chapter first and takes it out again", async () => {
    await toggleFavoriteChapter(22);
    await toggleFavoriteChapter(90);
    expect((await phoneView()).favorites).toEqual([91, 23]);

    await toggleFavoriteChapter(22);
    expect((await phoneView()).favorites).toEqual([91]);
  });
});

// ─── The heart in the chapter bar ─────────────────────────────────────────────

describe("the chapter heart", () => {
  const heart = () => document.getElementById("btnFavChapter");

  it("is empty for a Psalm that is not a favourite, and says how to add it", async () => {
    await showPassage({ chapterIndex: 4, record: false });
    expect(heart().getAttribute("aria-pressed")).toBe("false");
    expect(heart().title).toBe("Add this Psalm to Favourites");
    expect(heart().getAttribute("aria-label")).toBe("Add this Psalm to Favourites");
    expect(heart().querySelector("svg").getAttribute("fill")).toBe("none");
  });

  it("is filled for a favourite Psalm, and says how to remove it", async () => {
    await toggleFavoriteChapter(4);
    await showPassage({ chapterIndex: 4, record: false });
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    expect(heart().title).toBe("Remove this Psalm from Favourites");
    expect(heart().getAttribute("aria-label")).toBe("Remove this Psalm from Favourites");
    expect(heart().querySelector("svg").getAttribute("fill")).toBe("currentColor");
  });

  it("follows a toggle when the app repaints it with the new store", async () => {
    await showPassage({ chapterIndex: 4, record: false });
    await toggleFavoriteChapter(4);
    refreshFavChapter(await storage.loadStore());
    expect(heart().getAttribute("aria-pressed")).toBe("true");
    await toggleFavoriteChapter(4);
    refreshFavChapter(await storage.loadStore());
    expect(heart().getAttribute("aria-pressed")).toBe("false");
  });

  it("changes with the Psalm being read", async () => {
    await toggleFavoriteChapter(4);
    await showPassage({ chapterIndex: 4, record: false });
    await showPassage({ chapterIndex: 5, record: false });
    expect(heart().getAttribute("aria-pressed")).toBe("false");
  });
});

// ─── The verse actions ────────────────────────────────────────────────────────

describe("the verse actions", () => {
  const verseRow = (verseIndex) => document.querySelector(`.verse[data-verse="${verseIndex}"]`);
  const body = (verseIndex) => verseRow(verseIndex).querySelector(".verse-body");

  async function openActions(verseIndex) {
    body(verseIndex).click();
    await vi.waitFor(() =>
      expect(verseRow(verseIndex).querySelector(".verse-actions")).not.toBeNull()
    );
    return verseRow(verseIndex).querySelector(".verse-actions");
  }

  const openPicker = async (verseIndex) => {
    const actions = await openActions(verseIndex);
    actions.querySelector(".btn-highlight").click();
    return actions.querySelector(".highlight-picker");
  };

  it("offers Bookmark, Highlight, Note, Copy and Compare, in that order", async () => {
    await showPassage({ chapterIndex: 22, record: false });
    const actions = await openActions(0);
    const labels = Array.from(actions.querySelectorAll(":scope > .btn-action")).map(
      (button) => button.querySelector(".btn-action-label").textContent
    );
    expect(labels).toEqual(["Bookmark", "Highlight", "Note", "Copy", "Compare"]);
  });

  it("opens Compare for that verse", async () => {
    const opener = vi.fn();
    setCompareOpener(opener);
    await showPassage({ chapterIndex: 22, record: false });
    const actions = await openActions(1);
    actions.querySelector(".btn-compare").click();
    expect(opener.mock.calls).toEqual([[22, 1]]);
  });

  it("tints a verse that is already highlighted", async () => {
    await setHighlight(22, 1, "blue");
    await showPassage({ chapterIndex: 22, record: false });
    expect(body(1).dataset.highlight).toBe("blue");
    expect(body(0).dataset.highlight).toBeUndefined();
    expect(verseRow(1).textContent).toContain("Highlighted: Blue");
  });

  it("keeps the colour choices hidden until Highlight is pressed", async () => {
    await showPassage({ chapterIndex: 22, record: false });
    const actions = await openActions(0);
    const button = actions.querySelector(".btn-highlight");
    const picker = actions.querySelector(".highlight-picker");
    expect(picker.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    button.click();
    expect(picker.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(picker.querySelector(".hl-swatch"));
    expect(picker.getAttribute("aria-label")).toBe("Highlight colour");
    expect(
      Array.from(picker.querySelectorAll(".hl-swatch")).map((swatch) => [
        swatch.dataset.highlight,
        swatch.getAttribute("aria-label"),
      ])
    ).toEqual([
      ["yellow", "Yellow"],
      ["green", "Green"],
      ["blue", "Blue"],
      ["pink", "Pink"],
    ]);
    expect(picker.querySelector(".hl-none").textContent).toBe("None");

    button.click();
    expect(picker.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("highlights the verse with the chosen colour and saves it", async () => {
    await showPassage({ chapterIndex: 22, record: false });
    const picker = await openPicker(2);
    picker.querySelector('.hl-swatch[data-highlight="green"]').click();

    await vi.waitFor(() => expect(body(2).dataset.highlight).toBe("green"));
    expect(getHighlights(await storage.loadStore())).toEqual([
      { chapter: 23, verse: 3, color: "green" },
    ]);
    expect(picker.hidden).toBe(true);
    expect(picker.querySelector('[data-highlight="green"]').getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(verseRow(2).querySelector(".btn-highlight .hl-dot").dataset.highlight).toBe("green");
  });

  it("changes the colour of a highlighted verse", async () => {
    await setHighlight(22, 0, "yellow");
    await showPassage({ chapterIndex: 22, record: false });
    const picker = await openPicker(0);
    expect(picker.querySelector('[data-highlight="yellow"]').getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(document.activeElement.dataset.highlight).toBe("yellow");
    picker.querySelector('[data-highlight="pink"]').click();

    await vi.waitFor(() => expect(body(0).dataset.highlight).toBe("pink"));
    expect(getHighlights(await storage.loadStore())).toEqual([
      { chapter: 23, verse: 1, color: "pink" },
    ]);
  });

  it("does not write again when the colour chosen is the one already set", async () => {
    await setHighlight(22, 0, "yellow");
    await showPassage({ chapterIndex: 22, record: false });
    const picker = await openPicker(0);
    const local = chrome.storage.local;
    const writesBefore = local.setCalls;

    picker.querySelector('[data-highlight="yellow"]').click();

    await vi.waitFor(() => expect(picker.hidden).toBe(true));
    expect(local.setCalls).toBe(writesBefore);
  });

  it("removes the highlight with None", async () => {
    await setHighlight(22, 0, "yellow");
    await showPassage({ chapterIndex: 22, record: false });
    const picker = await openPicker(0);
    picker.querySelector(".hl-none").click();

    await vi.waitFor(() => expect(body(0).dataset.highlight).toBeUndefined());
    expect(getHighlights(await storage.loadStore())).toEqual([]);
    expect(verseRow(0).textContent).not.toContain("Highlighted");
  });

  it("says so, and paints nothing, when the highlight cannot be saved", async () => {
    await showPassage({ chapterIndex: 22, record: false });
    const picker = await openPicker(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    chrome.storage.local.rejectNextSet();

    picker.querySelector('[data-highlight="blue"]').click();

    await vi.waitFor(() =>
      expect(document.getElementById("statusBar").textContent).toContain(
        "Changes could not be saved."
      )
    );
    expect(body(0).dataset.highlight).toBeUndefined();
    expect(getHighlights(await storage.loadStore())).toEqual([]);
  });

  it("names the current colour on the Highlight button and marks None when there is none", async () => {
    await showPassage({ chapterIndex: 22, record: false });
    const actions = await openActions(0);
    const button = actions.querySelector(".btn-highlight");
    const none = actions.querySelector(".hl-none");
    expect(button.getAttribute("aria-label")).toBe("Highlight colour: None");
    expect(none.getAttribute("aria-pressed")).toBe("true");

    button.click();
    actions.querySelector('[data-highlight="blue"]').click();
    await vi.waitFor(() =>
      expect(button.getAttribute("aria-label")).toBe("Highlight colour: Blue")
    );
    expect(button.title).toBe("Highlight colour: Blue");
    expect(none.getAttribute("aria-pressed")).toBe("false");

    button.click();
    none.click();
    await vi.waitFor(() =>
      expect(button.getAttribute("aria-label")).toBe("Highlight colour: None")
    );
    expect(none.getAttribute("aria-pressed")).toBe("true");
  });

  describe("from the keyboard", () => {
    const stillOpen = (verseIndex) => {
      expect(verseRow(verseIndex).classList.contains("is-selected")).toBe(true);
      expect(verseRow(verseIndex).querySelector(".verse-actions")).not.toBeNull();
    };

    it.each(["Enter", " "])("presses Highlight with %j and leaves the verse open", async (key) => {
      await showPassage({ chapterIndex: 22, record: false });
      const actions = await openActions(0);
      const button = actions.querySelector(".btn-highlight");
      button.focus();
      press(button, key);
      expect(actions.querySelector(".highlight-picker").hidden).toBe(false);
      stillOpen(0);
    });

    it.each(["Enter", " "])("chooses a colour with %j and leaves the verse open", async (key) => {
      await showPassage({ chapterIndex: 22, record: false });
      const picker = await openPicker(1);
      const swatch = picker.querySelector('[data-highlight="green"]');
      swatch.focus();
      press(swatch, key);
      await vi.waitFor(() => expect(body(1).dataset.highlight).toBe("green"));
      stillOpen(1);
    });

    it.each(["Enter", " "])("bookmarks with %j and leaves the verse open", async (key) => {
      await showPassage({ chapterIndex: 22, record: false });
      const actions = await openActions(2);
      const button = actions.querySelector(".btn-fav");
      button.focus();
      press(button, key);
      await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
      expect(storage.hasFavourite(await storage.loadStore(), 22, 2)).toBe(true);
      stillOpen(2);
    });

    it("opens Compare with Enter and leaves the verse open", async () => {
      const opener = vi.fn();
      setCompareOpener(opener);
      await showPassage({ chapterIndex: 22, record: false });
      const actions = await openActions(1);
      const button = actions.querySelector(".btn-compare");
      button.focus();
      press(button, "Enter");
      expect(opener.mock.calls).toEqual([[22, 1]]);
      stillOpen(1);
    });

    it("leaves the arrow keys, Home and End to the buttons instead of jumping verses", async () => {
      await showPassage({ chapterIndex: 22, record: false });
      const actions = await openActions(1);
      const button = actions.querySelector(".btn-highlight");
      button.focus();
      for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
        expect(press(button, key).defaultPrevented).toBe(false);
      }
      expect(document.activeElement).toBe(button);
    });

    it("still opens and closes a verse from the verse itself with Enter and Space", async () => {
      await showPassage({ chapterIndex: 22, record: false });
      const row = verseRow(0);
      row.focus();
      press(row, "Enter");
      await vi.waitFor(() => expect(row.querySelector(".verse-actions")).not.toBeNull());

      row.focus();
      press(row, " ");
      await vi.waitFor(() => expect(row.querySelector(".verse-actions")).toBeNull());
    });
  });

  describe("in the single-verse view", () => {
    const actionsReady = () =>
      vi.waitFor(() =>
        expect(document.querySelector(".single-verse .btn-highlight")).not.toBeNull()
      );

    it("keeps focus on Highlight after a colour is chosen", async () => {
      await showPassage({ chapterIndex: 22, verseIndex: 1, record: false });
      await actionsReady();
      const before = document.querySelector(".btn-highlight");
      before.click();
      document.querySelector('.hl-swatch[data-highlight="blue"]').click();

      await vi.waitFor(() =>
        expect(document.querySelector(".single-verse-text").dataset.highlight).toBe("blue")
      );
      await vi.waitFor(() => expect(document.activeElement.classList).toContain("btn-highlight"));
      expect(document.activeElement).not.toBe(before);
      expect(document.activeElement.isConnected).toBe(true);
    });

    it("keeps focus on Bookmark after it is pressed", async () => {
      await showPassage({ chapterIndex: 22, verseIndex: 1, record: false });
      await actionsReady();
      const before = document.querySelector(".btn-fav");
      before.focus();
      before.click();

      await vi.waitFor(() =>
        expect(document.querySelector(".btn-fav").getAttribute("aria-pressed")).toBe("true")
      );
      await vi.waitFor(() => expect(document.activeElement.classList).toContain("btn-fav"));
      expect(document.activeElement).not.toBe(before);
    });

    it("does not pull focus back if the reader has already moved on", async () => {
      await showPassage({ chapterIndex: 22, verseIndex: 1, record: false });
      await actionsReady();
      document.querySelector(".btn-highlight").click();
      document.querySelector('.hl-swatch[data-highlight="pink"]').click();
      document.getElementById("txtChapter").focus();

      await vi.waitFor(() =>
        expect(document.querySelector(".single-verse-text").dataset.highlight).toBe("pink")
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(document.activeElement).toBe(document.getElementById("txtChapter"));
    });
  });

  it("highlights the text of a single verse", async () => {
    await setHighlight(22, 0, "pink");
    await showPassage({ chapterIndex: 22, verseIndex: 0, record: false });
    expect(document.querySelector(".single-verse-text").dataset.highlight).toBe("pink");
  });
});

describe("highlight colour names", () => {
  it("names the phone's four colours", () => {
    expect(["yellow", "green", "blue", "pink"].map(highlightLabel)).toEqual([
      "Yellow",
      "Green",
      "Blue",
      "Pink",
    ]);
  });

  it("names a colour it does not know in its error, rather than failing obscurely", () => {
    expect(() => highlightLabel("purple")).toThrow("Unknown highlight colour: purple");
    expect(() => highlightLabel("constructor")).toThrow("Unknown highlight colour: constructor");
  });
});

// ─── A Psalm the version does not have ────────────────────────────────────────

describe("a Psalm missing from the current version", () => {
  it("says so and offers the version list instead of failing", async () => {
    const opened = vi.fn();
    document.getElementById("btnVersion").addEventListener("click", opened);

    await showPassage({ chapterIndex: 129, record: false });

    const message = document.querySelector("#readingView .chapter-missing");
    expect(message.textContent).toContain("This version does not include Psalm 130.");
    expect(document.getElementById("chapterTitle").textContent).toBe("Psalm 130");
    message.querySelector("button").click();
    expect(opened).toHaveBeenCalledOnce();
    expect(message.querySelector("button").textContent).toBe("Choose another version");
  });

  it("keeps its place, so the reader can step to the neighbouring Psalms", async () => {
    // The fake version has 120 Psalms, so Psalm 121 (index 120) is the first one missing.
    await showPassage({ chapterIndex: 120, verseIndex: 2, record: false });
    expect(getCurrentChapter()).toBe(120);
    expect(getCurrentVerse()).toBeNull();

    // What the previous and next buttons do (stepChapter in app.js).
    await showPassage({ chapterIndex: wrapChapter(getCurrentChapter() - 1), record: false });
    expect(document.getElementById("chapterTitle").textContent).toBe("Psalm 120");
    expect(document.querySelectorAll("#readingView .verse")).toHaveLength(3);

    await showPassage({ chapterIndex: wrapChapter(getCurrentChapter() + 1), record: false });
    expect(document.querySelector("#readingView .chapter-missing").textContent).toContain(
      "Psalm 121"
    );
    await showPassage({ chapterIndex: wrapChapter(getCurrentChapter() + 1), record: false });
    expect(document.getElementById("chapterTitle").textContent).toBe("Psalm 122");
  });

  it("is not added to the reading history", async () => {
    await showPassage({ chapterIndex: 129 });
    expect(await storage.getHistory()).toEqual([]);
  });

  it("keeps the heart working for it", async () => {
    await toggleFavoriteChapter(129);
    await showPassage({ chapterIndex: 129, record: false });
    expect(document.getElementById("btnFavChapter").getAttribute("aria-pressed")).toBe("true");
  });

  it("still refuses a Psalm number that does not exist at all", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await showPassage({ chapterIndex: 5, record: false });
    await showPassage({ chapterIndex: 150, record: false });
    expect(getCurrentChapter()).toBe(5);
    expect(document.getElementById("statusBar").textContent).toContain("out of range");
  });
});

// ─── The Library ──────────────────────────────────────────────────────────────

describe("the Library tabs", () => {
  const tabs = () => Array.from(document.querySelectorAll("#libraryTabs [role='tab']"));
  const rows = () => Array.from(document.querySelectorAll("#libraryBody .row"));

  it("selects the chosen tab and nothing else", async () => {
    await showLibraryTab("highlights");
    expect(getLibraryTab()).toBe("highlights");
    expect(tabs().map((tab) => [tab.dataset.tab, tab.getAttribute("aria-selected")])).toEqual([
      ["favourites", "false"],
      ["highlights", "true"],
      ["chapters", "false"],
      ["notes", "false"],
    ]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it("renders each of the four tabs", async () => {
    await storage.toggleFavourite(22, 0);
    await setHighlight(22, 1, "green");
    await toggleFavoriteChapter(22);
    await storage.saveNote(22, 2, "A note");

    const seen = {};
    for (const tab of ["favourites", "highlights", "chapters", "notes"]) {
      await showLibraryTab(tab);
      seen[tab] = rows().map((row) => row.querySelector(".row-ref").textContent.trim());
    }
    expect(seen).toEqual({
      favourites: ["Psalm 23:1"],
      highlights: ["Green Psalm 23:2"],
      chapters: ["Psalm 23"],
      notes: ["Psalm 23:3"],
    });
  });

  it("refuses a tab it does not have", async () => {
    await showLibraryTab("notes");
    await expect(showLibraryTab("bogus")).rejects.toThrow("Unknown Library tab: bogus");
    expect(getLibraryTab()).toBe("notes");
  });

  describe("when the Library cannot read or change its data", () => {
    const status = () => document.getElementById("statusBar").textContent;

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("says so when the highlights cannot be read", async () => {
      getData.mockRejectedValueOnce(new TypeError("no text"));
      await showLibraryTab("highlights");
      expect(status()).toContain("Your highlights could not be read.");
    });

    it("says so when the favourite Psalms cannot be read", async () => {
      getData.mockRejectedValueOnce(new TypeError("no text"));
      await showLibraryTab("chapters");
      expect(status()).toContain("Your favourite Psalms could not be read.");
    });

    it("keeps a highlight, and says so, when it cannot be removed", async () => {
      await setHighlight(22, 0, "blue");
      await showLibraryTab("highlights");
      chrome.storage.local.rejectNextSet();

      rows()[0].querySelector(".btn-row-action").click();

      await vi.waitFor(() => expect(status()).toContain("Changes could not be saved."));
      expect(status()).not.toContain("Highlight removed");
      expect(getHighlights(await storage.loadStore())).toHaveLength(1);
      expect(rows()).toHaveLength(1);
    });

    it("keeps a favourite Psalm, and says so, when it cannot be removed", async () => {
      await toggleFavoriteChapter(22);
      await showLibraryTab("chapters");
      chrome.storage.local.rejectNextSet();

      rows()[0].querySelector(".btn-row-action").click();

      await vi.waitFor(() => expect(status()).toContain("Changes could not be saved."));
      expect(status()).not.toContain("removed from Favourites");
      expect(getFavoriteChapters(await storage.loadStore())).toEqual([23]);
      expect(rows()).toHaveLength(1);
    });

    // Renaming the list's id makes the repaint after a removal find nothing to paint into.
    it("does not call a highlight removal that worked a failure when the repaint fails", async () => {
      await setHighlight(22, 0, "blue");
      await showLibraryTab("highlights");

      rows()[0].querySelector(".btn-row-action").click();
      document.getElementById("libraryBody").id = "gone";

      await vi.waitFor(() =>
        expect(status()).toContain("Removed, but the Library could not be refreshed.")
      );
      expect(status()).not.toContain("could not be removed");
      expect(getHighlights(await storage.loadStore())).toEqual([]);
    });

    it("does not call a favourite removal that worked a failure when the repaint fails", async () => {
      await toggleFavoriteChapter(22);
      await showLibraryTab("chapters");

      rows()[0].querySelector(".btn-row-action").click();
      document.getElementById("libraryBody").id = "gone";

      await vi.waitFor(() =>
        expect(status()).toContain("Removed, but the Library could not be refreshed.")
      );
      expect(status()).not.toContain("could not be removed");
      expect(getFavoriteChapters(await storage.loadStore())).toEqual([]);
    });
  });

  describe("Highlights", () => {
    it("says what to do when there are none", async () => {
      await showLibraryTab("highlights");
      expect(document.getElementById("libraryBody").textContent).toContain("No highlights yet");
    });

    it("lists each highlight in reading order with its colour, reference and verse", async () => {
      await setHighlight(90, 0, "pink");
      await setHighlight(22, 1, "yellow");
      await setHighlight(22, 0, "blue");
      await showLibraryTab("highlights");

      expect(
        rows().map((row) => [
          row.querySelector(".hl-dot").dataset.highlight,
          row.querySelector(".row-ref").textContent.trim(),
          row.querySelector(".row-preview").textContent,
        ])
      ).toEqual([
        ["blue", "Blue Psalm 23:1", "Psalm 23 verse 1"],
        ["yellow", "Yellow Psalm 23:2", "Psalm 23 verse 2"],
        ["pink", "Pink Psalm 91:1", "Psalm 91 verse 1"],
      ]);
    });

    it("leaves out a highlight on a verse this version does not have", async () => {
      await setHighlight(22, 0, "blue");
      await setHighlight(139, 0, "pink");
      await showLibraryTab("highlights");
      expect(rows()).toHaveLength(1);
    });

    it("opens the verse", async () => {
      const navigate = vi.fn();
      setNavigator(navigate);
      await setHighlight(22, 1, "green");
      await showLibraryTab("highlights");
      rows()[0].querySelector(".row-body").click();
      expect(navigate.mock.calls).toEqual([[{ chapterIndex: 22, verseIndex: 1 }]]);
    });

    it("removes a highlight, repaints the list and the open Psalm", async () => {
      await setHighlight(22, 0, "blue");
      await setHighlight(22, 1, "pink");
      await showPassage({ chapterIndex: 22, record: false });
      await showLibraryTab("highlights");

      const remove = rows()[0].querySelector(".btn-row-action");
      expect(remove.getAttribute("aria-label")).toBe("Remove the highlight on Psalm 23:1");
      remove.click();

      await vi.waitFor(() => expect(rows()).toHaveLength(1));
      expect(getHighlights(await storage.loadStore())).toEqual([
        { chapter: 23, verse: 2, color: "pink" },
      ]);
      await vi.waitFor(() =>
        expect(
          document.querySelector('.verse[data-verse="0"] .verse-body').dataset.highlight
        ).toBeUndefined()
      );
    });
  });

  describe("Favourites", () => {
    it("says what to do when there are none", async () => {
      await showLibraryTab("chapters");
      expect(document.getElementById("libraryBody").textContent).toContain(
        "No favourite Psalms yet"
      );
    });

    it("lists the favourite Psalms newest first, each with its first verse", async () => {
      await toggleFavoriteChapter(22);
      await toggleFavoriteChapter(90);
      await showLibraryTab("chapters");
      expect(
        rows().map((row) => [
          row.querySelector(".row-ref").textContent,
          row.querySelector(".row-preview").textContent,
        ])
      ).toEqual([
        ["Psalm 91", "Psalm 91 verse 1"],
        ["Psalm 23", "Psalm 23 verse 1"],
      ]);
    });

    it("lists a Psalm the version lacks, without a verse, so it can still be removed", async () => {
      await toggleFavoriteChapter(129);
      await showLibraryTab("chapters");
      expect(rows()).toHaveLength(1);
      expect(rows()[0].querySelector(".row-ref").textContent).toBe("Psalm 130");
      expect(rows()[0].querySelector(".row-preview").textContent).toBe("");
    });

    it("ignores stored numbers that are not Psalms", async () => {
      await toggleFavoriteChapter(22);
      await storage.updateStore((draft) => {
        draft.carry.favorites = [0, 151, 23];
        return draft;
      });
      await showLibraryTab("chapters");
      expect(rows()).toHaveLength(1);
    });

    it("opens the whole Psalm", async () => {
      const navigate = vi.fn();
      setNavigator(navigate);
      await toggleFavoriteChapter(22);
      await showLibraryTab("chapters");
      rows()[0].querySelector(".row-body").click();
      expect(navigate.mock.calls).toEqual([[{ chapterIndex: 22, verseIndex: null }]]);
    });

    it("removes a Psalm and repaints the heart when it is the one being read", async () => {
      await toggleFavoriteChapter(22);
      await toggleFavoriteChapter(40);
      await showPassage({ chapterIndex: 22, record: false });
      await showLibraryTab("chapters");

      const remove = rows()[1].querySelector(".btn-row-action");
      expect(remove.getAttribute("aria-label")).toBe("Remove Psalm 23 from Favourites");
      remove.click();

      await vi.waitFor(() => expect(rows()).toHaveLength(1));
      expect(getFavoriteChapters(await storage.loadStore())).toEqual([41]);
      expect(document.getElementById("btnFavChapter").getAttribute("aria-pressed")).toBe("false");
    });
  });
});

// ─── Colours ──────────────────────────────────────────────────────────────────

describe("highlight colours", () => {
  // jsdom replaces the global URL, so resolve the path with Node's own.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (file) => readFileSync(resolve(root, file), "utf8");
  const library = read("styles/library.css");
  const base = read("style.css");

  /** The custom properties declared in the first block that starts with `selector {`. */
  function declared(css, selector) {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`No ${selector} block`);
    const block = css.slice(start, css.indexOf("}", start));
    return Object.fromEntries(
      [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
    );
  }

  /** [r, g, b, a] of #rrggbb or rgba(r, g, b, a). */
  function parse(value) {
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
    const rgba = value.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/);
    if (rgba) return rgba.slice(1).map(Number);
    throw new Error(`Cannot read the colour ${value}`);
  }

  const over = ([r, g, b, a], [br, bg, bb]) =>
    [r, g, b].map((c, i) => c * a + [br, bg, bb][i] * (1 - a));
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const themes = [
    ["light", ":root"],
    ["sepia", ':root[data-theme="sepia"]'],
    ["dark", ':root[data-theme="dark"]'],
  ];

  it("uses the phone's colours: light values on light, dark values on dark", () => {
    const light = declared(library, ":root");
    const dark = declared(library, ':root[data-theme="dark"]');
    expect([
      light["--hl-yellow"],
      light["--hl-green"],
      light["--hl-blue"],
      light["--hl-pink"],
    ]).toEqual(["#fff176", "#c8e6c9", "#bbdefb", "#f8bbd0"]);
    expect([dark["--hl-yellow"], dark["--hl-green"], dark["--hl-blue"], dark["--hl-pink"]]).toEqual(
      ["#665a00", "#1b5e20", "#0d47a1", "#880e4f"]
    );
  });

  it("uses the light values at 70% opacity in sepia", () => {
    const sepia = declared(library, ':root[data-theme="sepia"]');
    expect(["yellow", "green", "blue", "pink"].map((name) => parse(sepia[`--hl-${name}`]))).toEqual(
      [
        [255, 241, 118, 0.7],
        [200, 230, 201, 0.7],
        [187, 222, 251, 0.7],
        [248, 187, 208, 0.7],
      ]
    );
  });

  for (const [theme, selector] of themes) {
    it(`keeps verse text readable on every highlight in the ${theme} theme`, () => {
      const colours = { ...declared(base, ":root"), ...declared(base, selector) };
      const highlights = declared(library, selector);
      const text = parse(colours["--text"]);
      const page = parse(colours["--bg"]);
      for (const name of ["yellow", "green", "blue", "pink"]) {
        const background = over(parse(highlights[`--hl-${name}`]), page);
        expect(contrast(text, background), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
