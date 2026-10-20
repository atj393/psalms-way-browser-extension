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
/** The tables to look in, highest priority first, each with the language its plural forms follow. */
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

/** Counts calls to initI18n, so a slow load that was overtaken by a newer choice can be dropped. */
let latestInit = 0;

/**
 * Loads the language for `setting` ("auto" or a code), sets the page's `lang` and
 * `dir`, and returns the language in use. If the language is chosen again before
 * this load finishes, the newer choice wins and this call changes nothing.
 */
export async function initI18n(setting = "auto") {
  const mine = ++latestInit;
  const chosen =
    setting !== "auto" && SUPPORTED_LANGUAGES.includes(setting)
      ? setting
      : resolveBrowserLanguage();
  const english = [loadTable("locales/ext/en.json"), loadTable("locales/app/en.json")];
  const own =
    chosen === "en"
      ? []
      : [loadTable(`locales/ext/${chosen}.json`), loadTable(`locales/app/${chosen}.json`)];
  const [ownTables, englishTables] = await Promise.all([Promise.all(own), Promise.all(english)]);
  if (mine !== latestInit) return language;
  language = chosen;
  // The English tables count in English, whatever language is chosen: "1 match" and "21 matches".
  tables = [
    ...ownTables.map((table) => ({ lang: chosen, table })),
    ...englishTables.map((table) => ({ lang: "en", table })),
  ];
  if (globalThis.document) {
    // The whole popup follows the language: its words, and which side it starts from.
    document.documentElement.lang = language;
    document.documentElement.dir = isRtl(language) ? "rtl" : "ltr";
  }
  return language;
}

export function currentLanguage() {
  return language;
}

/**
 * The locale for dates and times: the browser's own variant of the chosen language
 * ("en-GB" for an English reader in Britain), else the language itself, so a date
 * is written in the language the rest of the popup is in.
 */
export function dateLocale() {
  const tags = globalThis.navigator?.languages ?? [];
  return tags.find((tag) => String(tag).toLowerCase().split(/[-_]/)[0] === language) ?? language;
}

/**
 * For tests: use these tables (highest priority first) without fetching. Every table
 * counts in `code`'s plural rules unless `languages` names another for it, by position.
 */
export function setTablesForTests(code, ordered, languages = []) {
  language = code;
  tables = ordered.map((table, i) => ({ lang: languages[i] ?? code, table }));
}

const pluralRules = new Map();

/** The plural category ("one", "few", "other"...) of `count` in `lang`. */
function pluralCategory(lang, count) {
  if (!pluralRules.has(lang)) pluralRules.set(lang, new Intl.PluralRules(lang));
  return pluralRules.get(lang).select(count);
}

/**
 * The first table with wording for the key. With a `count`, each table is read by its
 * own language's plural rules: its form for that count, else its plain key (the
 * phone's files keep the singular there), else its `_other`.
 */
function find(key, count) {
  for (const { lang, table } of tables) {
    const candidates =
      typeof count === "number"
        ? [`${key}_${pluralCategory(lang, count)}`, key, `${key}_other`]
        : [key];
    for (const candidate of candidates) {
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
