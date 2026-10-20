// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as store from "../src/storage.js";
import { setTablesForTests } from "../src/i18n.js";
import { BADGE_DEFS } from "../src/badges.js";
import { CHALLENGE_DEFS } from "../src/challenges.js";
import { recordVisit, renderProgress } from "../src/progress.js";

// gate: a promise the version text waits for, so a test can look at the panel while it loads.
const catalogue = vi.hoisted(() => ({ rtl: false, chapters: 150, failLoad: false, gate: null }));

// A version with five verses in every psalm, each "Verse <chapter>:<verse>".
vi.mock("../src/versions.js", () => ({
  currentVersion: () => "test",
  getVersionData: async () => {
    if (catalogue.gate) await catalogue.gate;
    if (catalogue.failLoad) throw new Error("The text could not be loaded.");
    return Array.from({ length: catalogue.chapters }, (_, c) =>
      Array.from({ length: 5 }, (_, v) => `Verse ${c + 1}:${v + 1}`)
    );
  },
  loadCatalogue: async () => [{ module: "test", rtl: catalogue.rtl }],
}));

const phoneEnglish = JSON.parse(
  readFileSync(resolve(process.cwd(), "locales/app/en.json"), "utf8")
);

// Local 20 October 2026, 09:00.
const MORNING = new Date(2026, 9, 20, 9, 0);
const NEXT_MORNING = new Date(2026, 9, 21, 9, 0);

let local;
const carryOf = () => local.data[store.STORE_KEY].carry;
const text = () => document.getElementById("progressBody").textContent;
const buttonWith = (label) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes(label));

// Polls quickly and allows for a busy machine; the panel finishes its work in a few milliseconds.
const until = (check) => vi.waitFor(check, { timeout: 5000, interval: 10 });
const card = (id) => document.querySelector(`[data-challenge="${id}"]`);

function savedStore(parts) {
  return { [store.STORE_KEY]: { schemaVersion: store.SCHEMA_VERSION, ...parts } };
}

beforeEach(() => {
  const host = (tag, props) => Object.assign(document.createElement(tag), props);
  document.body.replaceChildren(
    host("div", { id: "progressBody" }),
    host("div", { id: "statusBar", className: "status-bar", hidden: true }),
    host("div", { id: "dialogHost", hidden: true })
  );
  store.resetStoreCache();
  local = installChromeMock({});
  setTablesForTests("en", [phoneEnglish]);
  catalogue.rtl = false;
  catalogue.chapters = 150;
  catalogue.failLoad = false;
  catalogue.gate = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MORNING);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the phone's wording", () => {
  it("has every badge and challenge key the panel asks for", () => {
    for (const def of BADGE_DEFS) {
      expect(phoneEnglish).toHaveProperty(def.i18nKey);
      expect(phoneEnglish).toHaveProperty(def.i18nDescKey);
    }
    for (const def of CHALLENGE_DEFS) {
      expect(phoneEnglish).toHaveProperty(def.i18nKey);
      expect(phoneEnglish).toHaveProperty(def.i18nDescKey);
    }
  });
});

describe("recordVisit", () => {
  it("starts the streak and awards the first badge on the first visit", async () => {
    const newly = await recordVisit(MORNING);
    expect(newly.map((b) => b.id)).toEqual(["day1"]);
    expect(carryOf().streak).toEqual({ lastDate: "2026-10-20", count: 1, longestStreak: 1 });
    expect(carryOf().badges).toEqual({ day1: MORNING.toISOString() });
  });

  it("writes nothing on a later visit the same day", async () => {
    await recordVisit(MORNING);
    const writes = local.setCalls;
    expect(await recordVisit(new Date(2026, 9, 20, 22, 0))).toEqual([]);
    expect(local.setCalls).toBe(writes);
  });

  it("moves the streak on the next day and awards each badge once", async () => {
    await recordVisit(new Date(2026, 9, 18, 9));
    await recordVisit(new Date(2026, 9, 19, 9));
    const newly = await recordVisit(MORNING);
    expect(carryOf().streak).toEqual({ lastDate: "2026-10-20", count: 3, longestStreak: 3 });
    expect(newly.map((b) => b.id)).toEqual(["day3"]);
    expect(Object.keys(carryOf().badges)).toEqual(["day1", "day3"]);
    expect(carryOf().badges.day1).toBe(new Date(2026, 9, 18, 9).toISOString());
  });

  it("restarts after a missed day but keeps the longest streak and the badges", async () => {
    local = installChromeMock(
      savedStore({
        carry: {
          streak: { lastDate: "2026-10-10", count: 5, longestStreak: 8 },
          badges: { day1: "2026-10-06T08:00:00.000Z", day3: "2026-10-08T08:00:00.000Z" },
        },
      })
    );
    store.resetStoreCache();
    expect(await recordVisit(MORNING)).toEqual([]);
    expect(carryOf().streak).toEqual({ lastDate: "2026-10-20", count: 1, longestStreak: 8 });
    expect(Object.keys(carryOf().badges)).toEqual(["day1", "day3"]);
  });

  it("keeps the longest streak when the stored record is damaged", async () => {
    local = installChromeMock(
      savedStore({
        carry: { streak: { lastDate: "2026-10-19", count: "bad", longestStreak: 30 } },
      })
    );
    store.resetStoreCache();
    await recordVisit(MORNING);
    expect(carryOf().streak).toEqual({ lastDate: "2026-10-20", count: 1, longestStreak: 30 });
  });

  it("leaves the rest of the phone's data and the reader's own data as it was", async () => {
    local = installChromeMock(
      savedStore({
        favourites: [{ chapterIndex: 22, verseIndex: 0, addedAt: 5 }],
        carry: { highlights: [{ chapter: 1, verse: 1, color: "blue" }], favorites: [23] },
      })
    );
    store.resetStoreCache();
    await recordVisit(MORNING);
    expect(carryOf().highlights).toEqual([{ chapter: 1, verse: 1, color: "blue" }]);
    expect(carryOf().favorites).toEqual([23]);
    expect(local.data[store.STORE_KEY].favourites).toHaveLength(1);
  });

  it("reports a failed save instead of hiding it", async () => {
    local.rejectNextSet();
    await expect(recordVisit(MORNING)).rejects.toThrow("Changes could not be saved.");
  });
});

describe("the overview", () => {
  async function overview(parts = {}) {
    local = installChromeMock(savedStore(parts));
    store.resetStoreCache();
    await renderProgress({ navigate: vi.fn() });
  }

  it("has the three sections", async () => {
    await overview();
    const headings = [...document.querySelectorAll(".progress-heading")].map((h) => h.textContent);
    expect(headings).toEqual(["Reading Stats", "Badges", "Challenges"]);
  });

  it("shows the streak, the week and the totals from the stored data", async () => {
    await overview({
      history: [
        { chapterIndex: 22, verseIndex: null, viewedAt: new Date(2026, 9, 20, 8).getTime() },
        { chapterIndex: 0, verseIndex: 2, viewedAt: new Date(2026, 9, 18, 8).getTime() },
      ],
      favourites: [{ chapterIndex: 22, verseIndex: 0, addedAt: 5 }],
      notes: [],
      carry: {
        streak: { lastDate: "2026-10-20", count: 4, longestStreak: 9 },
        highlights: [{ chapter: 1, verse: 1, color: "blue" }],
        favorites: [23, 1],
      },
    });
    expect(document.querySelector(".progress-streak-number").textContent).toBe("4");
    expect(document.querySelector(".progress-streak-longest").textContent).toBe(
      "Longest streak: 9 days"
    );
    const week = [...document.querySelectorAll(".progress-day")];
    expect(week).toHaveLength(7);
    // The streak (4 days to today) fills 17 to 20 October; the history adds nothing new here.
    expect(week.map((d) => d.classList.contains("is-read"))).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    const totals = [...document.querySelectorAll(".progress-total-row")].map((row) => [
      row.querySelector("dt").textContent,
      row.querySelector("dd").textContent,
    ]);
    expect(totals.map(([, value]) => value)).toEqual(["2", "1", "1", "0", "2"]);
    expect(totals[0][0]).toBe("Chapters read (unique)");
    // History keeps one entry per chapter, so neither a session count nor "most read" says anything.
    expect(text()).not.toContain("Total sessions");
    expect(text()).not.toMatch(/most read/i);
    expect(document.querySelector(".progress-ranked")).toBeNull();
  });

  it("marks a day as read when a chapter was opened again that day, whatever the history keeps", async () => {
    await overview({
      history: [
        { chapterIndex: 22, verseIndex: null, viewedAt: new Date(2026, 9, 20, 8).getTime() },
      ],
      carry: { streak: { lastDate: "2026-10-20", count: 3, longestStreak: 3 } },
    });
    const week = [...document.querySelectorAll(".progress-day")];
    expect(week.map((d) => d.classList.contains("is-read"))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(week[5].textContent).toContain("Read");
  });

  it("shows all nine badges, earned ones with their date and locked ones greyed", async () => {
    await overview({
      carry: { badges: { day1: "2026-10-18T09:00:00.000Z", day3: "2026-10-20T09:00:00.000Z" } },
    });
    expect(document.querySelector(".progress-count").textContent).toBe("2/9");
    const badges = [...document.querySelectorAll(".progress-badge")];
    expect(badges).toHaveLength(9);
    expect(badges.filter((b) => b.classList.contains("is-earned"))).toHaveLength(2);
    expect(badges.filter((b) => b.classList.contains("is-locked"))).toHaveLength(7);
    expect(badges[0].querySelector(".progress-badge-name").textContent).toBe("First Step");
    expect(badges[0].querySelector(".progress-badge-emoji").textContent).toBe("🌱");
    expect(badges[0].querySelector(".progress-badge-note").textContent).toMatch(/2026/);
    expect(badges[2].querySelector(".progress-badge-note").textContent).toBe(
      "7-day reading streak"
    );
  });

  it("shows the six challenges with progress on the ones started", async () => {
    await overview({
      carry: {
        challenges: {
          david_hiding: {
            startDate: "2026-10-18",
            notifHour: 8,
            notifMinute: 0,
            dayAssignments: Array.from({ length: 7 }, (_, i) => ({
              chapter: i + 1,
              verseNumber: 1,
            })),
            completedDays: [0, 1],
            completed: false,
          },
        },
      },
    });
    expect(document.querySelectorAll(".progress-challenge")).toHaveLength(6);
    expect(card("david_hiding").textContent).toContain("Day 3 of 7");
    expect(card("david_hiding").textContent).toContain("2 / 7 chapters");
    expect(card("david_hiding").querySelector("progress").value).toBe(2);
    expect(card("praise_journey").querySelector("progress")).toBeNull();
  });

  it("shows a damaged challenge record as not started instead of failing", async () => {
    await overview({ carry: { challenges: { david_hiding: { startDate: "2026-10-18" } } } });
    expect(document.querySelectorAll(".progress-challenge")).toHaveLength(6);
    expect(card("david_hiding").querySelector("progress")).toBeNull();
  });
});

describe("a challenge", () => {
  let navigate;

  async function openChallenge(id, parts = {}) {
    local = installChromeMock(savedStore(parts));
    store.resetStoreCache();
    navigate = vi.fn();
    await renderProgress({ navigate });
    card(id).click();
    await until(() => expect(document.querySelector(".progress-detail")).not.toBeNull());
  }

  it("is not started at first and says what it is", async () => {
    await openChallenge("david_hiding");
    expect(document.querySelector(".progress-detail-name").textContent).toBe("David's Refuge");
    expect(text()).toContain("7 psalms written while David hid from his enemies");
    expect(buttonWith("Start Challenge")).toBeDefined();
    expect(buttonWith("Mark today's reading as done")).toBeUndefined();
  });

  it("starts with the phone's record: the reminder time, today, and a verse for each day", async () => {
    await openChallenge("david_hiding", {
      carry: { settings: { notificationHour: 21, notificationMinute: 30 } },
    });
    buttonWith("Start Challenge").click();
    await until(() => expect(buttonWith("Mark today's reading as done")).toBeDefined());

    const progress = carryOf().challenges.david_hiding;
    expect(progress).toMatchObject({
      startDate: "2026-10-20",
      notifHour: 21,
      notifMinute: 30,
      completedDays: [],
      completed: false,
    });
    expect(progress.dayAssignments.map((a) => a.chapter)).toEqual([57, 142, 54, 52, 34, 56, 63]);
    for (const { verseNumber } of progress.dayAssignments) {
      expect(verseNumber).toBeGreaterThanOrEqual(1);
      expect(verseNumber).toBeLessThanOrEqual(5);
    }
    expect(text()).toContain("Day 1 of 7");
    expect(text()).toContain("0 / 7 chapters");
  });

  it("uses 8:00 when the phone has not set a reminder time", async () => {
    await openChallenge("praise_journey");
    buttonWith("Start Challenge").click();
    await until(() => expect(carryOf().challenges?.praise_journey).toBeDefined());
    expect(carryOf().challenges.praise_journey).toMatchObject({ notifHour: 8, notifMinute: 0 });
  });

  it("shows today's verse and opens it in the reader", async () => {
    await openChallenge("david_hiding");
    buttonWith("Start Challenge").click();
    await until(() => expect(buttonWith("Open verse")).toBeDefined());

    const { chapter, verseNumber } = carryOf().challenges.david_hiding.dayAssignments[0];
    expect(document.querySelector(".progress-verse-ref").textContent).toBe(
      `Psalm ${chapter}:${verseNumber}`
    );
    expect(document.querySelector(".progress-verse-text").textContent).toBe(
      `Verse ${chapter}:${verseNumber}`
    );
    expect(document.querySelector(".progress-verse-text").hasAttribute("dir")).toBe(false);

    buttonWith("Open verse").click();
    expect(navigate).toHaveBeenCalledWith({
      chapterIndex: chapter - 1,
      verseIndex: verseNumber - 1,
    });
  });

  it("shows right-to-left verse text the right way round", async () => {
    catalogue.rtl = true;
    await openChallenge("david_hiding");
    buttonWith("Start Challenge").click();
    await until(() => expect(document.querySelector(".progress-verse-text")).not.toBeNull());
    expect(document.querySelector(".progress-verse-text").getAttribute("dir")).toBe("rtl");
  });

  it("says so when the version does not have the psalm", async () => {
    catalogue.chapters = 50; // Psalm 57 onwards is missing
    await openChallenge("david_hiding");
    buttonWith("Start Challenge").click();
    await until(() => expect(buttonWith("Mark today's reading as done")).toBeDefined());
    expect(document.querySelector(".progress-verse-text")).toBeNull();
    expect(text()).toContain("This psalm is not available in the selected translation");
    expect(carryOf().challenges.david_hiding.dayAssignments[0].verseNumber).toBe(1);
  });

  it("marks today's reading as done once a day", async () => {
    await openChallenge("david_hiding");
    buttonWith("Start Challenge").click();
    await until(() => expect(buttonWith("Mark today's reading as done")).toBeDefined());
    expect(buttonWith("Mark today's reading as done").disabled).toBe(false);

    buttonWith("Mark today's reading as done").click();
    await until(() => expect(text()).toContain("Already read today"));

    expect(carryOf().challenges.david_hiding).toMatchObject({
      completedDays: [0],
      lastCompletedDate: "2026-10-20",
      completed: false,
    });
    expect(text()).toContain("Already read today — come back tomorrow!");
    expect(text()).toContain("Day 2 of 7");
    expect(document.getElementById("statusBar").textContent).toContain("Day 1 Complete!");

    // The verse itself stays hidden until tomorrow, but Open verse still goes to the one just read.
    expect(document.querySelector(".progress-verse-text")).toBeNull();
    const { chapter, verseNumber } = carryOf().challenges.david_hiding.dayAssignments[0];
    buttonWith("Open verse").click();
    expect(navigate).toHaveBeenCalledWith({
      chapterIndex: chapter - 1,
      verseIndex: verseNumber - 1,
    });
  });

  it("allows the next reading the next day", async () => {
    await openChallenge("david_hiding");
    buttonWith("Start Challenge").click();
    await until(() => expect(buttonWith("Mark today's reading as done")).toBeDefined());
    buttonWith("Mark today's reading as done").click();
    await until(() => expect(text()).toContain("Already read today"));

    vi.setSystemTime(NEXT_MORNING);
    buttonWith("Back to challenges").click();
    await until(() => expect(card("david_hiding")).not.toBeNull());
    card("david_hiding").click();
    await until(() => expect(buttonWith("Mark today's reading as done")?.disabled).toBe(false));

    buttonWith("Mark today's reading as done").click();
    await until(() => expect(carryOf().challenges.david_hiding.completedDays).toEqual([0, 1]));
    expect(carryOf().challenges.david_hiding.lastCompletedDate).toBe("2026-10-21");
  });

  it("finishes on the last day and records the date", async () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ chapter: i + 1, verseNumber: 1 }));
    await openChallenge("david_hiding", {
      carry: {
        challenges: {
          david_hiding: {
            startDate: "2026-10-10",
            notifHour: 8,
            notifMinute: 0,
            dayAssignments: days,
            completedDays: [0, 1, 2, 3, 4, 5],
            lastCompletedDate: "2026-10-19",
            completed: false,
          },
        },
      },
    });
    buttonWith("Mark today's reading as done").click();
    await until(() => expect(carryOf().challenges.david_hiding.completed).toBe(true));
    expect(carryOf().challenges.david_hiding.completedDate).toBe("2026-10-20");
    await until(() => expect(text()).toContain("Challenge Complete!"));
    expect(buttonWith("Mark today's reading as done")).toBeUndefined();
    expect(document.getElementById("statusBar").textContent).toContain("Challenge Complete!");
  });

  it("lists the days, with the ones done and the next one marked", async () => {
    await openChallenge("david_hiding", {
      carry: {
        challenges: {
          david_hiding: {
            startDate: "2026-10-10",
            notifHour: 8,
            notifMinute: 0,
            dayAssignments: [57, 142, 54, 52, 34, 56, 63].map((chapter) => ({
              chapter,
              verseNumber: 1,
            })),
            completedDays: [0, 1],
            lastCompletedDate: "2026-10-19",
            completed: false,
          },
        },
      },
    });
    const rows = [...document.querySelectorAll(".progress-day-row")];
    expect(rows).toHaveLength(7);
    expect(rows.filter((r) => r.classList.contains("is-done"))).toHaveLength(2);
    expect(rows[2].classList.contains("is-next")).toBe(true);
    expect(rows[2].textContent).toContain("Day 3");
    expect(rows[2].textContent).toContain("Psalm 54");
  });

  it("asks before resetting, and resets when the reader agrees", async () => {
    await openChallenge("david_hiding");
    buttonWith("Start Challenge").click();
    await until(() => expect(buttonWith("Reset challenge")).toBeDefined());

    buttonWith("Reset challenge").click();
    await until(() => expect(document.querySelector(".dialog")).not.toBeNull());
    document.querySelector(".dialog .button-quiet").click(); // Cancel
    await until(() => expect(document.querySelector(".dialog")).toBeNull());
    expect(carryOf().challenges.david_hiding).toBeDefined();
    await until(() => expect(buttonWith("Reset challenge").disabled).toBe(false));

    buttonWith("Reset challenge").click();
    await until(() => expect(document.querySelector(".dialog")).not.toBeNull());
    document.querySelector(".dialog .button-danger").click(); // Reset
    await until(() => expect(buttonWith("Start Challenge")).toBeDefined());
    expect(carryOf().challenges).toEqual({});
  });

  it("goes back to the overview with the challenge's card in focus", async () => {
    await openChallenge("fasting");
    buttonWith("Back to challenges").click();
    await until(() => expect(document.querySelector(".progress-heading")).not.toBeNull());
    expect(document.activeElement).toBe(card("fasting"));
  });

  it("starts nothing, and says so, when the version's text cannot be loaded", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await openChallenge("david_hiding");
    catalogue.failLoad = true;
    buttonWith("Start Challenge").click();
    await until(() =>
      expect(document.getElementById("statusBar").textContent).toContain(
        "The text could not be loaded."
      )
    );
    expect(logged).toHaveBeenCalled();
    expect(carryOf()?.challenges).toBeUndefined();
    expect(buttonWith("Start Challenge").disabled).toBe(false);
  });

  it("still opens a started challenge when the version's text cannot be loaded", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const days = [57, 142, 54].map((chapter) => ({ chapter, verseNumber: 2 }));
    await openChallenge("david_hiding", {
      carry: {
        challenges: {
          david_hiding: {
            startDate: "2026-10-18",
            notifHour: 8,
            notifMinute: 0,
            dayAssignments: days,
            completedDays: [0],
            lastCompletedDate: "2026-10-19",
            completed: false,
          },
        },
      },
    });
    // openChallenge ran with the text available; open it again with the text failing.
    catalogue.failLoad = true;
    buttonWith("Back to challenges").click();
    await until(() => expect(card("david_hiding")).not.toBeNull());
    card("david_hiding").click();

    await until(() =>
      expect(document.getElementById("statusBar").textContent).toContain(
        "The text could not be loaded."
      )
    );
    expect(logged).toHaveBeenCalled();
    await until(() => expect(document.querySelector(".progress-detail-name")).not.toBeNull());
    expect(document.querySelector(".progress-verse-text")).toBeNull();
    expect(text()).toContain("This psalm is not available in the selected translation");
    expect(text()).toContain("Day 2 of 3");
    expect(document.querySelectorAll(".progress-day-row")).toHaveLength(3);
    expect(buttonWith("Mark today's reading as done").disabled).toBe(false);
    expect(buttonWith("Reset challenge")).toBeDefined();
  });

  it("turns a button off while its action runs", async () => {
    await openChallenge("david_hiding");
    let release;
    catalogue.gate = new Promise((resolve) => {
      release = resolve;
    });
    const start = buttonWith("Start Challenge");
    start.click();
    expect(start.disabled).toBe(true);
    expect(carryOf()?.challenges).toBeUndefined();

    release();
    await until(() => expect(buttonWith("Mark today's reading as done")).toBeDefined());
    expect(carryOf().challenges.david_hiding).toBeDefined();
  });
});

describe("keyboard focus", () => {
  async function openChallenge(id, parts = {}) {
    local = installChromeMock(savedStore(parts));
    store.resetStoreCache();
    await renderProgress({ navigate: vi.fn() });
    card(id).click();
    await until(() => expect(document.querySelector(".progress-detail")).not.toBeNull());
  }

  it("moves to the challenge's heading when a challenge opens", async () => {
    local = installChromeMock(savedStore({}));
    store.resetStoreCache();
    await renderProgress({ navigate: vi.fn() });
    card("fasting").focus();
    card("fasting").click();
    await until(() =>
      expect(document.activeElement).toBe(document.querySelector(".progress-detail-name"))
    );
  });

  it("stays on the Reset button when the reader cancels the confirmation", async () => {
    await openChallenge("david_hiding");
    buttonWith("Start Challenge").click();
    await until(() => expect(buttonWith("Reset challenge")).toBeDefined());

    const reset = buttonWith("Reset challenge");
    reset.focus();
    reset.click();
    await until(() => expect(document.querySelector(".dialog")).not.toBeNull());
    document.querySelector(".dialog .button-quiet").click(); // Cancel
    await until(() => expect(document.activeElement).toBe(reset));
    expect(reset.disabled).toBe(false);
  });

  it("stays on the button when its action fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await openChallenge("david_hiding");
    const start = buttonWith("Start Challenge");
    // A browser takes focus off a button that becomes disabled (jsdom does not, and its
    // blur() ignores a disabled button), so do the same by moving focus to the page.
    document.body.tabIndex = -1;
    new MutationObserver(() => {
      if (start.disabled) document.body.focus();
    }).observe(start, { attributes: true, attributeFilter: ["disabled"] });

    catalogue.failLoad = true;
    start.focus();
    start.click();
    await until(() =>
      expect(document.getElementById("statusBar").textContent).toContain(
        "The text could not be loaded."
      )
    );
    await until(() => expect(document.activeElement).toBe(start));
    expect(start.disabled).toBe(false);
  });

  it("leaves focus where the panel put it when the action redraws the panel", async () => {
    await openChallenge("david_hiding");
    buttonWith("Start Challenge").focus();
    buttonWith("Start Challenge").click();
    await until(() => expect(buttonWith("Mark today's reading as done")).toBeDefined());
    await until(() =>
      expect(document.activeElement).toBe(document.querySelector(".progress-detail-name"))
    );
  });
});
