// ─── Translations match the English ───────────────────────────────────────────
// Every `locales/ext/<code>.json` that has been translated must carry exactly
// the keys of `locales/ext/en.json`, with the same `{{placeholders}}`. Plural
// keys follow each language's own rules: where English has `x_one` and
// `x_other`, a language writes one key per category its Intl.PluralRules uses
// (Russian: one, few, many, other; Japanese: other only). A missing key would
// quietly fall back to English; a lost placeholder would show "{{count}}".
//
// Set LOCALES=de,fr to check only some languages.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { SUPPORTED_LANGUAGES } from "../src/i18n.js";

const dir = resolve(process.cwd(), "locales/ext");
const readJson = (code) => JSON.parse(readFileSync(resolve(dir, `${code}.json`), "utf8"));

const english = readJson("en");
const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Plural families (base key → English placeholder set) and plain keys. */
const families = new Map();
const plain = new Map();
for (const [key, text] of Object.entries(english)) {
  if (PLURAL.test(key)) {
    const base = key.replace(PLURAL, "");
    families.set(base, placeholders(english[`${base}_other`] ?? text));
  } else {
    plain.set(key, placeholders(text));
  }
}

function placeholders(text) {
  return [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();
}

const only = process.env.LOCALES?.split(",")
  .map((code) => code.trim())
  .filter(Boolean);
const codes = readdirSync(dir)
  .map((name) => name.replace(/\.json$/, ""))
  .filter((code) => code !== "en" && (!only || only.includes(code)));

describe.each(codes)("locales/ext/%s.json", (code) => {
  const table = readJson(code);
  const translated = Object.keys(table).length > 0;
  const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;

  it("is a supported language", () => {
    expect(SUPPORTED_LANGUAGES).toContain(code);
  });

  it.runIf(translated)("has every plain key, with the same placeholders", () => {
    const problems = [];
    for (const [key, expected] of plain) {
      if (typeof table[key] !== "string" || table[key].trim() === "") {
        problems.push(`missing ${key}`);
      } else if (placeholders(table[key]).join() !== expected.join()) {
        problems.push(`placeholders ${key}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.runIf(translated)(
    "has every plural form the language uses, with the same placeholders",
    () => {
      const problems = [];
      for (const [base, expected] of families) {
        for (const category of categories) {
          const text = table[`${base}_${category}`];
          if (typeof text !== "string" || text.trim() === "") {
            problems.push(`missing ${base}_${category}`);
          } else if (!placeholders(text).every((name) => expected.includes(name))) {
            // A form may leave out {{count}} ("one book"), never add or rename one.
            problems.push(`placeholders ${base}_${category}`);
          }
        }
      }
      expect(problems).toEqual([]);
    }
  );

  it.runIf(translated)("has no keys English does not have", () => {
    const allowed = new Set(plain.keys());
    for (const base of families.keys()) {
      for (const category of categories) allowed.add(`${base}_${category}`);
    }
    expect(Object.keys(table).filter((key) => !allowed.has(key))).toEqual([]);
  });

  it.runIf(translated)("keeps the names that are never translated", () => {
    const problems = [];
    for (const [key, text] of Object.entries(english)) {
      for (const name of ["Psalms Way", "Google Drive"]) {
        if (
          String(text).includes(name) &&
          typeof table[key] === "string" &&
          !table[key].includes(name)
        ) {
          problems.push(`${key}: ${name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
