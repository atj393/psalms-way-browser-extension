// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installChromeMock } from "./chrome-mock.js";
import * as store from "../src/storage.js";
import { updateCarry } from "../src/phoneData.js";
import { setTablesForTests } from "../src/i18n.js";
import { openToday, renderToday, shownStreak } from "../src/today.js";

// The version text comes from versions.js; these tests choose what it returns.
const versions = vi.hoisted(() => ({
  module: "modern",
  data: [],
  requested: [],
  attributes: { lang: "en", dir: "ltr" },
}));
vi.mock("../src/versions.js", () => ({
  currentVersion: () => versions.module,
  readingTextAttributes: () => versions.attributes,
  getVersionData: async (module) => {
    versions.requested.push(module);
    return versions.data;
  },
}));

const niv = JSON.parse(readFileSync(resolve(process.cwd(), "psalms.json"), "utf8"));
// 20 October 2026: the verse of the day is Psalm 150:6, Today's Psalm is day 293 = Psalm 143.
const NOW = new Date(2026, 9, 20, 9, 30);

let writeText;

const body = () => document.getElementById("todayBody");
const button = (label) =>
  [...body().querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const cards = () => [...body().querySelectorAll(".today-card")];
const streakText = () => body().querySelector(".today-streak")?.textContent.trim();

async function setStreak(streak) {
  await updateCarry((carry) => {
    carry.streak = streak;
  });
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="todayBody"></div>
    <div class="status-bar" id="statusBar" hidden></div>
  `;
  store.resetStoreCache();
  installChromeMock({});
  versions.module = "modern";
  versions.data = niv;
  versions.requested = [];
  versions.attributes = { lang: "en", dir: "ltr" };
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  setTablesForTests("en", []);
});

describe("openToday", () => {
  it("opens the Today panel instead of jumping to a passage", async () => {
    const showPanel = vi.fn(async () => {});
    const navigate = vi.fn();
    await openToday({ navigate, showPanel });
    expect(showPanel).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("shownStreak", () => {
  it("keeps the count when the last read was today or yesterday", () => {
    expect(shownStreak({ lastDate: "2026-10-20", count: 5 }, "2026-10-20")).toBe(5);
    expect(shownStreak({ lastDate: "2026-10-19", count: 5 }, "2026-10-20")).toBe(5);
  });

  it("is 0 once a day has been missed", () => {
    expect(shownStreak({ lastDate: "2026-10-18", count: 5 }, "2026-10-20")).toBe(0);
  });

  it("is 0 when there is no streak or its date cannot be read", () => {
    expect(shownStreak(null, "2026-10-20")).toBe(0);
    expect(shownStreak({ lastDate: "", count: 5 }, "2026-10-20")).toBe(0);
    expect(shownStreak({ lastDate: "last tuesday", count: 5 }, "2026-10-20")).toBe(0);
  });
});

describe("renderToday: the verse of the day", () => {
  it("shows the reference and the text of the phone's pick for the day", async () => {
    await renderToday({ navigate: vi.fn(), now: NOW });
    const [verseCard] = cards();
    expect(verseCard.querySelector(".today-label").textContent).toBe("Verse of the day");
    expect(verseCard.querySelector(".today-reference").textContent).toBe("Psalm 150:6");
    expect(verseCard.querySelector(".today-verse").textContent).toBe(niv[149][5]);
  });

  it("reads the current version, not always the bundled one", async () => {
    versions.module = "kjv";
    versions.data = niv.map((verses) => verses.map((_, v) => `kjv verse ${v + 1}`));
    await renderToday({ navigate: vi.fn(), now: NOW });
    expect(versions.requested).toEqual(["kjv"]);
    expect(cards()[0].querySelector(".today-verse").textContent).toMatch(/^kjv verse \d+$/);
  });

  it("marks the verse with the Bible's own language and direction", async () => {
    await renderToday({ navigate: vi.fn(), now: NOW });
    const verse = cards()[0].querySelector(".today-verse");
    expect([verse.getAttribute("lang"), verse.getAttribute("dir")]).toEqual(["en", "ltr"]);

    versions.attributes = { lang: "he", dir: "rtl" };
    await renderToday({ navigate: vi.fn(), now: NOW });
    const hebrew = cards()[0].querySelector(".today-verse");
    expect([hebrew.getAttribute("lang"), hebrew.getAttribute("dir")]).toEqual(["he", "rtl"]);
  });

  it("Open goes to that verse", async () => {
    const navigate = vi.fn();
    await renderToday({ navigate, now: NOW });
    button("Open").click();
    expect(navigate).toHaveBeenCalledWith({ chapterIndex: 149, verseIndex: 5 });
  });

  it("Copy puts the reference and text on the clipboard and says so", async () => {
    await renderToday({ navigate: vi.fn(), now: NOW });
    button("Copy").click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(`Psalm 150:6 — ${niv[149][5]}`);
    await vi.waitFor(() =>
      expect(document.getElementById("statusBar").textContent).toBe("Psalm 150:6 copied")
    );
  });

  it("tells the reader when the browser blocks the copy", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    writeText.mockRejectedValueOnce(new Error("denied"));
    await renderToday({ navigate: vi.fn(), now: NOW });
    button("Copy").click();
    await vi.waitFor(() =>
      expect(document.getElementById("statusBar").textContent).toMatch(/blocked the copy/)
    );
    expect(error).toHaveBeenCalled();
  });

  it("says so, and keeps the rest of Today, when the version has no verse to show", async () => {
    versions.data = niv.map(() => []);
    await renderToday({ navigate: vi.fn(), now: NOW });
    expect(body().textContent).toContain("no verse of the day");
    expect(button("Open")).toBeUndefined();
    expect(button("Copy")).toBeUndefined();
    expect(button("Read")).toBeDefined();
  });
});

describe("renderToday: Today's Psalm", () => {
  it("names the psalm for the day and Read opens it", async () => {
    const navigate = vi.fn();
    await renderToday({ navigate, now: NOW });
    const psalmCard = cards()[1];
    expect(psalmCard.querySelector(".today-label").textContent).toBe("Today's Psalm");
    expect(psalmCard.querySelector(".today-psalm-title").textContent).toBe("Psalm 143");
    button("Read").click();
    expect(navigate).toHaveBeenCalledWith({ chapterIndex: 142 });
  });
});

describe("renderToday: the streak", () => {
  it("shows the stored count when today was read", async () => {
    await setStreak({ lastDate: "2026-10-20", count: 5, longestStreak: 9 });
    await renderToday({ navigate: vi.fn(), now: NOW });
    expect(streakText()).toBe("5-day streak");
  });

  it("still shows it when yesterday was the last day read", async () => {
    await setStreak({ lastDate: "2026-10-19", count: 12 });
    await renderToday({ navigate: vi.fn(), now: NOW });
    expect(streakText()).toBe("12-day streak");
  });

  it.each([
    ["a streak that was broken", { lastDate: "2026-10-10", count: 12 }],
    ["no streak yet", null],
  ])("invites the reader to start one after %s", async (_name, streak) => {
    if (streak) await setStreak(streak);
    await renderToday({ navigate: vi.fn(), now: NOW });
    expect(streakText()).toBe("Read today to start your streak.");
  });
});

describe("renderToday: the panel", () => {
  it("replaces what was there instead of adding to it", async () => {
    await renderToday({ navigate: vi.fn(), now: NOW });
    await renderToday({ navigate: vi.fn(), now: NOW });
    expect(cards()).toHaveLength(2);
    expect(body().querySelectorAll(".today-streak")).toHaveLength(1);
  });

  it("takes every word from the translation tables", async () => {
    setTablesForTests("de", [
      {
        todayVerseOfTheDay: "Vers des Tages",
        todaysPsalm: "Psalm des Tages",
        todayOpen: "Öffnen",
        todayCopy: "Kopieren",
        todayRead: "Lesen",
        todayStreak_other: "{{count}} Tage in Folge",
      },
    ]);
    await setStreak({ lastDate: "2026-10-20", count: 3 });
    await renderToday({ navigate: vi.fn(), now: NOW });
    const labels = [...body().querySelectorAll(".today-label")].map((n) => n.textContent);
    expect(labels).toEqual(["Vers des Tages", "Psalm des Tages"]);
    expect(button("Öffnen")).toBeDefined();
    expect(button("Kopieren")).toBeDefined();
    expect(button("Lesen")).toBeDefined();
    expect(streakText()).toBe("3 Tage in Folge");
  });

  it("does nothing when the panel is not in the page", async () => {
    document.body.replaceChildren();
    await expect(renderToday({ navigate: vi.fn(), now: NOW })).resolves.toBeUndefined();
  });
});
