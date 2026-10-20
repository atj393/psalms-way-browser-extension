// @vitest-environment jsdom
// The Sync panel's wording, in English and in another language, for each state the
// background worker can report. The sync itself is tested in cloudSync.test.js.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTablesForTests } from "../src/i18n.js";
import { renderCloud } from "../src/cloud.js";

const readJson = (path) => JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
const english = [readJson("locales/ext/en.json"), readJson("locales/app/en.json")];

/** What the background worker answers, by command; `status` is the state under test. */
let answers;

function mount() {
  const parsed = new DOMParser().parseFromString(
    `<button id="btnCloud" type="button"></button>
     <div id="cloudBody"></div>
     <div id="statusBar" hidden></div>
     <div id="dialogHost" hidden></div>`,
    "text/html"
  );
  document.body.replaceChildren(...parsed.body.childNodes);
}

const text = () => document.getElementById("cloudBody").textContent;
const buttons = () => [...document.querySelectorAll("#cloudBody button")].map((b) => b.textContent);
const status = () => document.getElementById("statusBar").textContent;
const buttonNamed = (label) =>
  [...document.querySelectorAll("#cloudBody button")].find((b) => b.textContent === label);

beforeEach(() => {
  mount();
  setTablesForTests("en", english);
  answers = { status: { configured: true, email: "", icon: "off" } };
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn(async ({ cmd }) => answers[cmd] ?? { ok: true }) },
    permissions: { request: vi.fn(async () => true) },
  };
});

afterEach(() => setTablesForTests("en", []));

const connected = (extra = {}) => ({
  configured: true,
  email: "reader@example.com",
  icon: "ok",
  lastSyncAt: new Date(2026, 9, 20, 9, 30).toISOString(),
  ...extra,
});

describe("before connecting", () => {
  it("offers to connect, and says what it does with the reader's data", async () => {
    await renderCloud();
    expect(text()).toContain("Your Psalms Way on every device");
    expect(text()).toContain("Optional: without it, everything stays on this browser.");
    expect(buttons()).toEqual(["Connect Google account"]);
  });

  it("says so when sync is not in this build", async () => {
    answers.status = { configured: false };
    await renderCloud();
    expect(text()).toBe("Sync with the phone app is not available in this version.");
  });

  it("is written in the reader's language", async () => {
    setTablesForTests("de", [
      { syncConnect: "Google-Konto verbinden", syncHeroTitle: "Dein Psalms Way auf jedem Gerät" },
      ...english,
    ]);
    await renderCloud();
    expect(text()).toContain("Dein Psalms Way auf jedem Gerät");
    expect(buttons()).toEqual(["Google-Konto verbinden"]);
  });
});

describe("when connected", () => {
  it("shows the account and the last sync, and offers Sync now and Disconnect", async () => {
    answers.status = connected();
    await renderCloud();
    expect(text()).toContain("reader@example.com");
    expect(text()).toMatch(/Synced · .+ at /);
    expect(buttons()).toEqual(["Sync now", "Disconnect"]);
    expect(text()).toContain("Syncs when you open Psalms Way and a few seconds after each change.");
  });

  it("says a sync that has not happened is not yet", async () => {
    answers.status = connected({ lastSyncAt: "" });
    await renderCloud();
    expect(text()).toContain("Synced · Not yet");
  });

  it("explains a temporary problem and says it will try again", async () => {
    answers.status = connected({ icon: "attention", lastError: "network" });
    await renderCloud();
    expect(text()).toContain("No internet connection. It will try again automatically.");
    expect(text()).toContain("Will try again · last synced");
  });

  it("explains a problem that needs the reader, without promising a retry, and offers Reconnect", async () => {
    answers.status = connected({ icon: "attention", lastError: "auth-expired" });
    await renderCloud();
    expect(text()).toContain("Google needs you to sign in again.");
    expect(text()).not.toContain("It will try again automatically.");
    expect(buttons()).toEqual(["Reconnect", "Disconnect"]);
  });

  it("falls back to the general sentence for a problem it has no wording for", async () => {
    answers.status = connected({ icon: "attention", lastError: "something-new" });
    await renderCloud();
    expect(text()).toContain("Something went wrong.");
  });

  it("explains an empty browser and offers both ways forward", async () => {
    answers.status = connected({ icon: "attention", attention: "empty-local" });
    await renderCloud();
    expect(text()).toContain("This browser has nothing saved, but your Google account does.");
    expect(text()).toContain("Needs your attention");
    // The usual Sync now and Disconnect stay below the two ways forward.
    expect(buttons()).toEqual(["Get my data back", "Sync anyway", "Sync now", "Disconnect"]);
  });

  it("mentions a backup that was kept aside", async () => {
    answers.status = connected({ unreadableKeptAsideAt: "2026-10-01T00:00:00Z" });
    await renderCloud();
    expect(text()).toContain(
      "A backup that could not be read was kept aside in your Google Drive."
    );
  });

  it("shows progress instead of the buttons while an action runs", async () => {
    answers.status = connected();
    await renderCloud({ working: "Syncing…" });
    expect(text()).toContain("Syncing…");
    expect(buttons()).toEqual([]);
  });
});

describe("the actions", () => {
  it("says how many items came from the phone, with the right plural", async () => {
    answers.connect = { ok: true, addedFromCloud: 1 };
    await renderCloud();
    buttonNamed("Connect Google account").click();
    await vi.waitFor(() => expect(status()).toContain("Connected. 1 item came from your phone."));

    answers.connect = { ok: true, addedFromCloud: 3 };
    buttonNamed("Connect Google account").click();
    await vi.waitFor(() => expect(status()).toContain("Connected. 3 items came from your phone."));
  });

  it("says Connected when nothing came from the phone", async () => {
    answers.connect = { ok: true, addedFromCloud: 0 };
    await renderCloud();
    buttonNamed("Connect Google account").click();
    await vi.waitFor(() => expect(status()).toBe("Connected."));
  });

  it("reports a refused permission", async () => {
    globalThis.chrome.permissions.request = vi.fn(async () => false);
    await renderCloud();
    buttonNamed("Connect Google account").click();
    await vi.waitFor(() =>
      expect(status()).toContain("Psalms Way needs your permission to open Google sign-in.")
    );
  });

  it("explains a failed sync in words, not as a code", async () => {
    answers.status = connected();
    answers.syncNow = { ok: false, code: "drive-full" };
    await renderCloud();
    buttonNamed("Sync now").click();
    await vi.waitFor(() => expect(status()).toContain("Your Google Drive is full."));
  });

  it("uses the general sentence for a failure it does not know", async () => {
    answers.status = connected();
    answers.syncNow = { ok: false, code: "something-new" };
    await renderCloud();
    buttonNamed("Sync now").click();
    await vi.waitFor(() => expect(status()).toBe("Sync could not finish."));
  });
});
