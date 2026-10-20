// @vitest-environment jsdom
// The Language select in Settings: what it offers, what choosing one does to
// the saved settings, and that the page follows (text, language, direction).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installChromeMock } from "./chrome-mock.js";
import * as store from "../src/storage.js";
import {
  SUPPORTED_LANGUAGES,
  applyTranslations,
  initI18n,
  languageName,
  setTablesForTests,
} from "../src/i18n.js";
import { initLanguageSelect, paintSettingsControls } from "../src/settings.js";

/** The real popup markup, so the test also proves the select and the headings exist. */
function loadPopupMarkup() {
  const html = readFileSync(resolve(process.cwd(), "popup.html"), "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
}

const select = () => document.getElementById("languageSelect");
const options = () => [...select().options];
const status = () => document.getElementById("statusBar").textContent;

/** Picks a language in the select the way a reader does. */
function choose(code) {
  select().value = code;
  select().dispatchEvent(new Event("change", { bubbles: true }));
}

/** Waits for the work a change starts (saving, then the callback). */
const settled = (check) => vi.waitFor(check, { timeout: 2000, interval: 5 });

let local;

beforeEach(() => {
  store.resetStoreCache();
  local = installChromeMock({});
  setTablesForTests("en", []);
  loadPopupMarkup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the options", () => {
  it("offer Automatic first, then every language by its own name", () => {
    initLanguageSelect({ onChanged: vi.fn() });

    const all = options();
    expect(all).toHaveLength(48);
    expect(all[0].value).toBe("auto");
    expect(all[0].textContent).toBe("Automatic (browser language)");
    const codes = all.slice(1).map((option) => option.value);
    expect([...codes].sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    for (const option of all.slice(1)) {
      expect(option.textContent).toBe(languageName(option.value));
    }
    expect(options().find((o) => o.value === "de").textContent).toBe("Deutsch");
    expect(options().find((o) => o.value === "ar").textContent).toBe("العربية");
  });

  it("tags each language's name with its own language, for screen readers", () => {
    initLanguageSelect({ onChanged: vi.fn() });
    for (const option of options().slice(1)) {
      expect(option.getAttribute("lang")).toBe(option.value);
    }
  });

  it("show the saved language, and Automatic when it is not one the extension has", () => {
    initLanguageSelect({ onChanged: vi.fn() });
    paintSettingsControls({ ...store.defaultSettings(), uiLanguage: "fr" });
    expect(select().value).toBe("fr");
    paintSettingsControls({ ...store.defaultSettings(), uiLanguage: "xx" });
    expect(select().value).toBe("auto");
    paintSettingsControls({ ...store.defaultSettings(), uiLanguage: "auto" });
    expect(select().value).toBe("auto");
  });
});

describe("choosing a language", () => {
  it("saves it and tells the app", async () => {
    const onChanged = vi.fn(async () => {});
    initLanguageSelect({ onChanged });

    choose("de");
    await settled(() => expect(onChanged).toHaveBeenCalledWith("de"));

    expect((await store.getSettings()).uiLanguage).toBe("de");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("can go back to Automatic", async () => {
    const onChanged = vi.fn(async () => {});
    initLanguageSelect({ onChanged });

    choose("de");
    await settled(() => expect(onChanged).toHaveBeenCalledWith("de"));
    choose("auto");
    await settled(() => expect(onChanged).toHaveBeenCalledWith("auto"));

    expect((await store.getSettings()).uiLanguage).toBe("auto");
  });

  it("re-reads the language files and re-marks the page: new text, language and direction", async () => {
    const files = {
      "locales/ext/en.json": {
        settings: "Settings",
        languageAutomatic: "Automatic (browser language)",
      },
      "locales/app/en.json": {},
      "locales/ext/ar.json": {},
      "locales/app/ar.json": { settings: "الإعدادات" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => ({ ok: path in files, status: 404, json: async () => files[path] }))
    );
    await initI18n("en");
    applyTranslations();
    expect(document.getElementById("settingsHeading").textContent).toBe("Settings");

    initLanguageSelect({
      onChanged: async (setting) => {
        await initI18n(setting);
        applyTranslations();
      },
    });
    choose("ar");

    await settled(() =>
      expect(document.getElementById("settingsHeading").textContent).toBe("الإعدادات")
    );
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
    // The language names stay in their own languages.
    expect(options().find((o) => o.value === "de").textContent).toBe("Deutsch");

    choose("en");
    await settled(() =>
      expect(document.getElementById("settingsHeading").textContent).toBe("Settings")
    );
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });

  it("still applies the language for this visit when it could not be saved, and says so", async () => {
    const onChanged = vi.fn(async () => {});
    initLanguageSelect({ onChanged });
    await store.loadStore();
    local.rejectNextSet();
    vi.spyOn(console, "error").mockImplementation(() => {});

    choose("fr");
    await settled(() => expect(onChanged).toHaveBeenCalledWith("fr"));

    expect(status()).not.toBe("");
    expect(document.getElementById("statusBar").hidden).toBe(false);
    expect((await store.getSettings()).uiLanguage).toBe("auto");
  });

  it("reports it when showing the new language fails", async () => {
    initLanguageSelect({
      onChanged: async () => {
        throw new Error("Could not repaint");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    choose("es");

    await settled(() => expect(status()).toContain("Could not repaint"));
  });
});
