// @vitest-environment jsdom
// ─── Every string is translatable ─────────────────────────────────────────────
// A script-free scan: the source is read as text and never run. It proves that
// each key the markup and the code ask for has English wording to fall back on
// (the extension's own `locales/ext/en.json`, or the phone's `locales/app/en.json`),
// that the English written beside a call agrees with that wording, and that no
// extension key is left behind unused. A typo in a key would otherwise show the
// reader the key itself in their language.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Vitest runs from the project root.
const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));

const ext = readJson("locales/ext/en.json");
const app = readJson("locales/app/en.json");

const sourceFiles = readdirSync(resolve(root, "src"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => ({ name, text: read(join("src", name)) }));
const popup = read("popup.html");

const PLURAL_SUFFIXES = ["_one", "_other"];

/** A key exists when English wording is on file for it, as a plain key or as plural forms. */
function isKnown(key) {
  return [ext, app].some((table) =>
    [key, ...PLURAL_SUFFIXES.map((suffix) => key + suffix)].some((name) => name in table)
  );
}

/** The English wording for a key: the extension's wins, as it does at run time. */
function english(key) {
  for (const table of [ext, app]) {
    for (const name of [key, `${key}_other`]) {
      if (typeof table[name] === "string") return table[name];
    }
  }
  return undefined;
}

/** Every `t("key", …)` call in src/, with the English literal when the call has a plain one. */
function translationCalls() {
  const calls = [];
  const call =
    /\bt\(\s*"([A-Za-z0-9_]+)"(?:\s*,\s*(\{[^{}]*\}|\w+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*\))?/g;
  for (const { name, text } of sourceFiles) {
    for (const match of text.matchAll(call)) {
      calls.push({ file: name, key: match[1], vars: match[2], fallback: match[3] });
    }
  }
  return calls;
}

/** Keys named in data tables instead of calls: the badges' and challenges' `i18nKey`s. */
function tableKeys() {
  const keys = [];
  for (const { name, text } of sourceFiles) {
    for (const match of text.matchAll(/\bi18n(?:Desc)?Key:\s*"([A-Za-z0-9_]+)"/g)) {
      keys.push({ file: name, key: match[1] });
    }
  }
  return keys;
}

const markupKeys = [...popup.matchAll(/\sdata-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);

describe("the extension's English wording", () => {
  it("is a flat list of non-empty strings", () => {
    for (const [key, value] of Object.entries(ext)) {
      expect(typeof value, key).toBe("string");
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("has every key popup.html asks for", () => {
    expect(markupKeys.length).toBeGreaterThan(40);
    expect(markupKeys.filter((key) => !isKnown(key))).toEqual([]);
  });

  it("has every key a t() call in src/ asks for", () => {
    const calls = translationCalls();
    expect(calls.length).toBeGreaterThan(150);
    expect(
      calls.filter(({ key }) => !isKnown(key)).map(({ file, key }) => `${file}: ${key}`)
    ).toEqual([]);
  });

  it("has the badge and challenge keys named in src/", () => {
    const keys = tableKeys();
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter(({ key }) => !isKnown(key))).toEqual([]);
  });

  it("has the prayer category keys named in the prayers file", () => {
    const { categories } = readJson("data/prayers-en.json");
    expect(categories.filter(({ i18nKey }) => !isKnown(i18nKey))).toEqual([]);
  });

  it("agrees with the English written beside each call", () => {
    const mismatches = translationCalls()
      .filter(({ key, fallback }) => fallback !== undefined && english(key) !== undefined)
      .filter(({ key, fallback }) => english(key) !== JSON.parse(`"${fallback}"`))
      .map(({ file, key, fallback }) => `${file}: ${key}: "${fallback}" vs "${english(key)}"`);
    expect(mismatches).toEqual([]);
  });

  it("is given every value its wording asks for", () => {
    // Only calls that write their English beside them can be checked: the rest pass vars by name.
    const missing = [];
    for (const { file, key, vars, fallback } of translationCalls()) {
      if (fallback === undefined) continue;
      const wording = [ext, app]
        .flatMap((table) => [key, `${key}_one`, `${key}_other`].map((name) => table[name]))
        .filter((text) => typeof text === "string");
      const asked = wording.flatMap((text) =>
        [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1])
      );
      for (const name of new Set(asked)) {
        // A name given as `name` or `name: value`, not merely mentioned as someone else's value.
        const given = new RegExp(`[{,]\\s*${name}\\s*[:,}]`).test(vars);
        if (!given) missing.push(`${file}: ${key} lacks ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no key that nothing uses", () => {
    // Used by a call, by the markup, or by name in the prayers file (the categories the phone has no key for).
    const used = new Set([
      ...translationCalls().map(({ key }) => key),
      ...markupKeys,
      ...readJson("data/prayers-en.json").categories.map(({ i18nKey }) => i18nKey),
    ]);
    const unused = Object.keys(ext).filter(
      (key) => !used.has(key) && !used.has(key.replace(/_(one|other)$/, ""))
    );
    expect(unused).toEqual([]);
  });

  it("gives every plural key both the singular and the plural form", () => {
    const bases = new Set(
      Object.keys(ext)
        .filter((key) => /_(one|other)$/.test(key))
        .map((key) => key.replace(/_(one|other)$/, ""))
    );
    expect(bases.size).toBeGreaterThan(3);
    for (const base of bases) {
      expect(ext, base).toHaveProperty(`${base}_one`);
      expect(ext, base).toHaveProperty(`${base}_other`);
    }
  });
});

describe("popup.html", () => {
  const page = new DOMParser().parseFromString(popup, "text/html");

  it("puts each translated text on an element with nothing inside it, so no icon is wiped", () => {
    const labels = [...page.querySelectorAll("[data-i18n]")];
    expect(labels.length).toBeGreaterThan(30);
    for (const node of labels) {
      expect(node.children.length, node.outerHTML).toBe(0);
      expect(node.hasAttribute("data-icon"), node.outerHTML).toBe(false);
    }
  });
});
