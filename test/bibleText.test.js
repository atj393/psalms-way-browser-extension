// @vitest-environment jsdom
// The Bible's own language and direction mark the Bible text and nothing else.
// A Hebrew version in an English popup (or an English one in an Arabic popup)
// must not turn the buttons, messages and errors around it into Hebrew or
// English: those keep the interface language and direction.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as storage from "../src/storage.js";
import { setTablesForTests } from "../src/i18n.js";
import { getData } from "../src/data.js";
import { openNoteEditor } from "../src/notes.js";
import { runSearch, setNavigator } from "../src/panels.js";
import { buildVerseActions, showPassage } from "../src/reader.js";
import { renderProgress } from "../src/progress.js";
import { renderToday } from "../src/today.js";

const version = vi.hoisted(() => ({ attributes: { lang: "he", dir: "rtl" }, data: [] }));

vi.mock("../src/versions.js", async (importOriginal) => ({
  ...(await importOriginal()),
  readingTextAttributes: () => version.attributes,
  // Today and Progress read the text straight from the version.
  getVersionData: async () => version.data,
}));

vi.mock("../src/data.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getData: vi.fn(),
}));

/** `count` chapters of three verses each, e.g. "Psalm 5 verse 2". */
const fakeVersion = (count) =>
  Array.from({ length: count }, (_, c) => [1, 2, 3].map((v) => `Psalm ${c + 1} verse ${v}`));

function mountPopup() {
  const parsed = new DOMParser().parseFromString(
    `<h2 id="chapterTitle"></h2>
     <input id="txtChapter" />
     <button id="btnFavChapter" type="button" aria-pressed="false"></button>
     <button id="btnVersion" type="button"></button>
     <div id="readingView" tabindex="-1"></div>
     <p id="searchCount"></p>
     <div id="searchResults"></div>
     <h2 id="noteEditorTitle"></h2>
     <blockquote id="noteVerse"></blockquote>
     <textarea id="noteText"></textarea>
     <p id="noteCounter"></p>
     <button id="btnDeleteNote" type="button"></button>
     <button id="btnSaveNote" type="button"></button>
     <button id="btnCancelNote" type="button"></button>
     <button id="btnCloseNote" type="button"></button>
     <div id="todayBody"></div>
     <div id="progressBody"></div>
     <div id="statusBar" hidden></div>
     <div id="dialogHost" hidden></div>`,
    "text/html"
  );
  document.body.replaceChildren(...parsed.body.childNodes);
}

const view = () => document.getElementById("readingView");
/** The nearest ancestor (or the element itself) below <html> that carries a dir or lang. */
const tagged = (node) => {
  const found = node.closest("[dir], [lang]");
  return found === document.documentElement ? null : found;
};

beforeEach(() => {
  storage.resetStoreCache();
  installChromeMock({});
  setTablesForTests("en", []);
  mountPopup();
  version.attributes = { lang: "he", dir: "rtl" };
  version.data = fakeVersion(150);
  getData.mockResolvedValue(fakeVersion(120));
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

describe("a chapter", () => {
  it("marks each verse's text with the Bible's language and direction", async () => {
    await showPassage({ chapterIndex: 4, record: false });

    const texts = [...view().querySelectorAll(".verse-text")];
    expect(texts).toHaveLength(3);
    for (const text of texts) {
      expect(text.getAttribute("dir")).toBe("rtl");
      expect(text.getAttribute("lang")).toBe("he");
    }
  });

  it("does not mark the reading view, the verse numbers, the markers or the list", async () => {
    await showPassage({ chapterIndex: 4, record: false });

    expect(view().hasAttribute("dir")).toBe(false);
    expect(view().hasAttribute("lang")).toBe(false);
    expect(view().querySelector("ol.verses").hasAttribute("dir")).toBe(false);
    for (const number of view().querySelectorAll(".verse-num")) {
      expect(tagged(number)).toBeNull();
    }
  });

  it("keeps the verse action buttons in the interface language and direction", async () => {
    await showPassage({ chapterIndex: 4, record: false });
    view().querySelector(".verse-body").click();
    await vi.waitFor(() => expect(view().querySelector(".verse-actions")).not.toBeNull());

    const buttons = view().querySelectorAll(".verse-actions button");
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) expect(tagged(button)).toBeNull();
  });

  it("marks nothing before a version has been chosen, so the text takes the page's own", async () => {
    version.attributes = {};
    await showPassage({ chapterIndex: 4, record: false });

    for (const text of view().querySelectorAll(".verse-text")) {
      expect(text.hasAttribute("dir")).toBe(false);
      expect(text.hasAttribute("lang")).toBe(false);
    }
  });

  it("marks a left-to-right version as left to right", async () => {
    version.attributes = { lang: "en", dir: "ltr" };
    await showPassage({ chapterIndex: 4, record: false });

    const text = view().querySelector(".verse-text");
    expect(text.getAttribute("dir")).toBe("ltr");
    expect(text.getAttribute("lang")).toBe("en");
  });
});

describe("a single verse", () => {
  it("marks the verse, but not the reference, the note, or the buttons", async () => {
    await storage.saveNote(4, 1, "My own note");
    await showPassage({ chapterIndex: 4, verseIndex: 1, record: false });
    await vi.waitFor(() => expect(view().querySelector(".verse-actions")).not.toBeNull());

    const verse = view().querySelector(".single-verse-text");
    expect(verse.getAttribute("dir")).toBe("rtl");
    expect(verse.getAttribute("lang")).toBe("he");
    for (const node of [
      view().querySelector(".single-verse"),
      view().querySelector(".single-verse-ref"),
      view().querySelector(".verse-note-preview"),
      view().querySelector(".read-chapter-btn"),
      ...view().querySelectorAll(".verse-actions button"),
    ]) {
      expect(tagged(node)).toBeNull();
    }
  });
});

describe("what surrounds the text", () => {
  it("keeps the missing-Psalm message and its button in the interface language", async () => {
    await showPassage({ chapterIndex: 129, record: false });

    const message = view().querySelector(".chapter-missing");
    expect(tagged(message)).toBeNull();
    expect(tagged(message.querySelector("button"))).toBeNull();
  });

  it("keeps the failure message in the interface language", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getData.mockRejectedValue(new Error("down"));

    await showPassage({ chapterIndex: 4, record: false });

    expect(view().querySelector(".panel-empty-title")).not.toBeNull();
    expect(tagged(view().querySelector(".panel-empty"))).toBeNull();
  });

  it("builds the verse action row with no language or direction of its own", async () => {
    const actions = await buildVerseActions(4, 0, "Psalm 5 verse 1");
    expect(tagged(actions)).toBeNull();
  });
});

describe("the Bible text in other panels", () => {
  it("marks the previews in search results", async () => {
    setNavigator(() => {});
    await runSearch("verse 2");

    const previews = [...document.querySelectorAll("#searchResults .row-preview")];
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview.getAttribute("dir")).toBe("rtl");
      expect(preview.getAttribute("lang")).toBe("he");
    }
    for (const reference of document.querySelectorAll("#searchResults .row-ref")) {
      expect(tagged(reference)).toBeNull();
    }
  });

  it("marks the verse in the note editor, but not its title or buttons", async () => {
    await openNoteEditor({ chapterIndex: 4, verseIndex: 0, text: "Psalm 5 verse 1" });

    const verse = document.getElementById("noteVerse");
    expect(verse.getAttribute("dir")).toBe("rtl");
    expect(verse.getAttribute("lang")).toBe("he");
    expect(tagged(document.getElementById("noteEditorTitle"))).toBeNull();
    expect(tagged(document.getElementById("btnSaveNote"))).toBeNull();
  });
});

// An Arabic popup with an English Bible, and the other way round: the verse takes the Bible's
// language and direction, the words around it keep the popup's.
describe("the verse in Today and in a challenge", () => {
  beforeEach(() => {
    document.documentElement.setAttribute("lang", "ar");
    document.documentElement.setAttribute("dir", "rtl");
  });

  const startChallenge = async () => {
    await renderProgress({ navigate: vi.fn() });
    document.querySelector('[data-challenge="david_hiding"]').click();
    await vi.waitFor(() => expect(document.querySelector(".progress-detail-name")).not.toBeNull());
    [...document.querySelectorAll("#progressBody button")]
      .find((button) => button.classList.contains("button-large"))
      .click();
    await vi.waitFor(() => expect(document.querySelector(".progress-verse-text")).not.toBeNull());
  };

  it("marks Today's verse as English and left to right in an Arabic popup", async () => {
    version.attributes = { lang: "en", dir: "ltr" };
    await renderToday({ navigate: vi.fn() });

    const verse = document.querySelector(".today-verse");
    expect([verse.getAttribute("lang"), verse.getAttribute("dir")]).toEqual(["en", "ltr"]);
    for (const node of [
      document.querySelector(".today-reference"),
      document.querySelector(".today-label"),
      ...document.querySelectorAll("#todayBody button"),
    ]) {
      expect(tagged(node)).toBeNull();
    }
  });

  it("marks Today's verse as Hebrew and right to left in an English popup", async () => {
    document.documentElement.setAttribute("lang", "en");
    document.documentElement.setAttribute("dir", "ltr");
    await renderToday({ navigate: vi.fn() });

    const verse = document.querySelector(".today-verse");
    expect([verse.getAttribute("lang"), verse.getAttribute("dir")]).toEqual(["he", "rtl"]);
  });

  it("marks nothing on Today's verse before a version has been chosen", async () => {
    version.attributes = {};
    await renderToday({ navigate: vi.fn() });

    const verse = document.querySelector(".today-verse");
    expect(verse.hasAttribute("dir")).toBe(false);
    expect(verse.hasAttribute("lang")).toBe(false);
  });

  it("marks a challenge's verse as English and left to right in an Arabic popup", async () => {
    version.attributes = { lang: "en", dir: "ltr" };
    await startChallenge();

    const verse = document.querySelector(".progress-verse-text");
    expect([verse.getAttribute("lang"), verse.getAttribute("dir")]).toEqual(["en", "ltr"]);
    for (const node of [
      document.querySelector(".progress-verse-ref"),
      document.querySelector(".progress-card-title"),
      ...document.querySelectorAll("#progressBody button"),
    ]) {
      expect(tagged(node)).toBeNull();
    }
  });

  it("marks a challenge's verse as Hebrew and right to left", async () => {
    await startChallenge();

    const verse = document.querySelector(".progress-verse-text");
    expect([verse.getAttribute("lang"), verse.getAttribute("dir")]).toEqual(["he", "rtl"]);
  });
});
