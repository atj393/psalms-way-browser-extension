import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  currentLanguage,
  initI18n,
  isRtl,
  languageName,
  resolveBrowserLanguage,
  setTablesForTests,
  t,
} from "../src/i18n.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("looking up text", () => {
  it("prefers the language's extension wording, then its app wording, then English", () => {
    setTablesForTests("de", [
      { sync: "Synchronisieren" },
      { notes: "Notizen", sync: "unused" },
      { sync: "Sync", extOnly: "Only in English" },
      { notes: "Notes" },
    ]);
    expect(t("sync")).toBe("Synchronisieren");
    expect(t("notes")).toBe("Notizen");
    expect(t("extOnly")).toBe("Only in English");
  });

  it("falls back to the caller's English, then the key itself, never failing", () => {
    setTablesForTests("fr", [{}, {}, {}, {}]);
    expect(t("missing", {}, "Missing text")).toBe("Missing text");
    expect(t("missingTotally")).toBe("missingTotally");
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    setTablesForTests("en", [{ psalm: "Psalm {{number}} of {{total}}" }]);
    expect(t("psalm", { number: 23 })).toBe("Psalm 23 of {{total}}");
  });

  it("chooses the plural form for the language", () => {
    setTablesForTests("en", [
      { results_one: "{{count}} result", results_other: "{{count}} results" },
    ]);
    expect(t("results", { count: 1 })).toBe("1 result");
    expect(t("results", { count: 5 })).toBe("5 results");
  });

  it("uses _other when a language's own plural form is missing", () => {
    setTablesForTests("ar", [{ results_other: "{{count}} نتائج" }]);
    expect(t("results", { count: 3 })).toBe("3 نتائج");
  });
});

describe("choosing the language", () => {
  it("picks the browser's best supported language", () => {
    expect(resolveBrowserLanguage(["pt-BR", "en"])).toBe("pt");
    expect(resolveBrowserLanguage(["xx-YY", "de_DE"])).toBe("de");
    expect(resolveBrowserLanguage(["xx"])).toBe("en");
    expect(resolveBrowserLanguage([])).toBe("en");
  });

  it("supports the phone's 47 languages and knows which read right to left", () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(47);
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("de")).toBe(false);
  });

  it("names a language in itself", () => {
    expect(languageName("de")).toBe("Deutsch");
    expect(languageName("not-a-code!")).toBe("not-a-code!");
  });

  it("loads the chosen language's files and English behind them", async () => {
    const files = {
      "locales/ext/en.json": { a: "A" },
      "locales/app/en.json": { b: "B" },
      "locales/ext/de.json": {},
      "locales/app/de.json": { b: "Be" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => ({ ok: path in files, status: 404, json: async () => files[path] }))
    );
    expect(await initI18n("de")).toBe("de");
    expect(currentLanguage()).toBe("de");
    expect(t("a")).toBe("A");
    expect(t("b")).toBe("Be");
  });

  it("follows the browser for 'auto', and keeps working when a file cannot load", async () => {
    vi.stubGlobal("navigator", { languages: ["fr-FR"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await initI18n("auto")).toBe("fr");
    expect(t("anything", {}, "Fallback")).toBe("Fallback");
  });
});
