// ─── App languages ────────────────────────────────────────────────────────────
// The extension speaks the phone app's 47 languages. `locales/app/<code>.json`
// are the phone's own translation files, copied unchanged by
// scripts/sync-locales.js; `locales/ext/<code>.json` hold the wording only the
// extension needs. A key is looked up in the chosen language's extension file,
// then its app file, then English (extension, app), then the caller's fallback.
// Files use the phone's i18next format: `{{name}}` placeholders and plural
// keys ending in _one, _other (and _zero, _two, _few, _many where a language
// needs them).

export const SUPPORTED_LANGUAGES = [
  "en",
  "de",
  "fr",
  "es",
  "hi",
  "ta",
  "te",
  "kn",
  "ml",
  "zh",
  "pt",
  "pl",
  "ja",
  "ro",
  "he",
  "id",
  "af",
  "sq",
  "cs",
  "bn",
  "bo",
  "vi",
  "it",
  "fi",
  "gu",
  "ha",
  "ht",
  "hu",
  "ko",
  "lt",
  "lv",
  "mi",
  "mr",
  "my",
  "ne",
  "fa",
  "pa",
  "so",
  "nl",
  "ar",
  "ru",
  "tl",
  "th",
  "tr",
  "ug",
  "ur",
  "wo",
];

export const RTL_LANGUAGES = ["ar", "fa", "he", "ur", "ug"];

let language = "en";
let tables = [];

async function loadTable(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Psalms Way: could not load ${path}`, error);
    return {};
  }
}

/** The best supported language for the browser's preferences, or English. */
export function resolveBrowserLanguage(tags = globalThis.navigator?.languages ?? []) {
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    if (SUPPORTED_LANGUAGES.includes(base)) return base;
  }
  return "en";
}

export function isRtl(code) {
  return RTL_LANGUAGES.includes(code);
}

/** Loads the language for `setting` ("auto" or a code). Returns the language in use. */
export async function initI18n(setting = "auto") {
  language =
    setting !== "auto" && SUPPORTED_LANGUAGES.includes(setting)
      ? setting
      : resolveBrowserLanguage();
  const english = [loadTable("locales/ext/en.json"), loadTable("locales/app/en.json")];
  const own =
    language === "en"
      ? []
      : [loadTable(`locales/ext/${language}.json`), loadTable(`locales/app/${language}.json`)];
  tables = await Promise.all([...own, ...english]);
  if (globalThis.document) document.documentElement.lang = language;
  return language;
}

export function currentLanguage() {
  return language;
}

/** For tests: use these tables (highest priority first) without fetching. */
export function setTablesForTests(code, ordered) {
  language = code;
  tables = ordered;
}

function find(key, count) {
  const plural =
    typeof count === "number" ? `${key}_${new Intl.PluralRules(language).select(count)}` : null;
  for (const table of tables) {
    for (const candidate of plural ? [plural, `${key}_other`, key] : [key]) {
      if (typeof table?.[candidate] === "string") return table[candidate];
    }
  }
  return undefined;
}

/** The text for `key` in the current language, with `{{name}}` filled from `vars`. */
export function t(key, vars = {}, fallback) {
  const template = find(key, vars.count) ?? fallback ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match
  );
}

/**
 * Fills marked elements: data-i18n (text), data-i18n-title, data-i18n-aria-label,
 * data-i18n-placeholder. The English already in the markup is the fallback.
 */
export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n, {}, node.textContent.trim());
  }
  for (const [data, attribute] of [
    ["i18nTitle", "title"],
    ["i18nAriaLabel", "aria-label"],
    ["i18nPlaceholder", "placeholder"],
  ]) {
    const selector = `[data-${data.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    for (const node of root.querySelectorAll(selector)) {
      node.setAttribute(attribute, t(node.dataset[data], {}, node.getAttribute(attribute) ?? ""));
    }
  }
}

/** A language's own name for itself ("Deutsch" for de). */
export function languageName(code) {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
