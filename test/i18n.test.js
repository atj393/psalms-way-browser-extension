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

describe("plural forms", () => {
  const english = { match_one: "{{count}} match", match_other: "{{count}} matches" };

  it("reads each table by its own language's plural rules", () => {
    // Japanese has one form for every count; the English table behind it still has two.
    setTablesForTests("ja", [{}, {}, english, {}], ["ja", "ja", "en", "en"]);
    expect(t("match", { count: 1 })).toBe("1 match");
    expect(t("match", { count: 2 })).toBe("2 matches");
  });

  it("uses the language's own form when it has one, and English rules for the English behind it", () => {
    const russian = { match_one: "{{count}} совпадение", match_other: "{{count}} совпадений" };
    setTablesForTests("ru", [russian, english], ["ru", "en"]);
    // 21 is "one" in Russian and "other" in English.
    expect(t("match", { count: 21 })).toBe("21 совпадение");

    setTablesForTests("ru", [{}, english], ["ru", "en"]);
    expect(t("match", { count: 21 })).toBe("21 matches");
    expect(t("match", { count: 31 })).toBe("31 matches");
    expect(t("match", { count: 1 })).toBe("1 match");
  });

  it("counts in the chosen language when every table is given without languages", () => {
    setTablesForTests("ru", [{ match_one: "один", match_few: "несколько", match_other: "много" }]);
    expect(t("match", { count: 21 })).toBe("один");
    expect(t("match", { count: 22 })).toBe("несколько");
    expect(t("match", { count: 25 })).toBe("много");
  });

  it("prefers a table's plain key to its _other form, as the phone's files keep the singular there", () => {
    setTablesForTests("en", [{ result: "{{count}} result", result_other: "{{count}} results" }]);
    expect(t("result", { count: 1 })).toBe("1 result");
    expect(t("result", { count: 0 })).toBe("0 results");
    expect(t("result", { count: 2 })).toBe("2 results");
  });

  it("falls back to _other when a category has no form and no plain key", () => {
    setTablesForTests("ar", [{ item_other: "{{count}} عناصر" }]);
    expect(t("item", { count: 3 })).toBe("3 عناصر");
  });

  it("counts the English files in English once they are loaded for another language", async () => {
    const files = {
      "locales/ext/en.json": english,
      "locales/app/en.json": {},
      "locales/ext/ru.json": {},
      "locales/app/ru.json": {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => ({ ok: path in files, status: 404, json: async () => files[path] }))
    );
    await initI18n("ru");
    expect(t("match", { count: 21 })).toBe("21 matches");
    expect(t("match", { count: 1 })).toBe("1 match");
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
