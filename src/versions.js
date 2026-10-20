// ─── Bible versions ───────────────────────────────────────────────────────────
// Which versions exist, which one is chosen, and their text. The list is
// `bibles/index.json`; each version is one file, fetched only when it is read,
// so the popup never loads all 80 Bibles to show one. The bundled NIV (`modern`)
// is the root `psalms.json`. Every version has 150 chapters, chapter N being
// Psalm N; a version that could not be laid out that way is not shipped.
//
// Three modules import each other in a circle: versions.js imports DataError
// from data.js and updateSettings from storage.js, data.js imports versions.js
// (getData() asks for the current version), and storage.js imports
// CHAPTER_COUNT from data.js. That is safe because none of them uses another's
// exports while its module is loading, only inside functions. Keep it that way:
// in particular, storage.js must never use CHAPTER_COUNT at its top level.

import { DataError } from "./data.js";
import { updateSettings } from "./storage.js";

const CATALOGUE_PATH = "bibles/index.json";
const MODERN = "modern";

let current = MODERN;
/** The catalogue once loaded: versionLabel() is synchronous and reads it. */
let loaded = null;
let cataloguePromise = null;
const versionPromises = new Map();

/**
 * Fetch and parse a JSON file of the extension.
 * @param {string} path
 * @param {string} what names the file in the error message
 */
async function fetchJson(path, what) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new DataError(`${path} responded ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof DataError) throw error;
    throw new DataError(`${what} could not be loaded.`, error);
  }
}

function isCatalogueEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    ["module", "name", "lang", "lang_short", "year", "copyright", "file"].every(
      (key) => typeof entry[key] === "string"
    ) &&
    Number.isInteger(entry.chapters) &&
    entry.chapters > 0 &&
    typeof entry.rtl === "boolean"
  );
}

async function readCatalogue() {
  const parsed = await fetchJson(CATALOGUE_PATH, "The list of Bible versions");
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isCatalogueEntry)) {
    throw new DataError("The list of Bible versions is not in the expected format.");
  }
  // Everyone shares this list, so nobody may change it.
  parsed.forEach((entry) => Object.freeze(entry));
  loaded = Object.freeze(parsed);
  return loaded;
}

/**
 * Every Bible version, the NIV first and then sorted by language and name.
 * Read once and kept. The list and its entries are frozen, so copy before sorting or changing.
 *
 * @returns {Promise<{module: string, name: string, lang: string, lang_short: string,
 *   year: string, chapters: number, rtl: boolean, copyright: string, file: string}[]>}
 */
export function loadCatalogue() {
  if (!cataloguePromise) {
    cataloguePromise = readCatalogue();
    // A failure is not kept, so the next call tries again.
    cataloguePromise.catch(() => {
      cataloguePromise = null;
    });
  }
  return cataloguePromise;
}

async function findEntry(module) {
  const entry = (await loadCatalogue()).find((v) => v.module === module);
  if (!entry) throw new DataError(`The Bible version "${module}" is not available.`);
  return entry;
}

async function readVersion(module) {
  const entry = await findEntry(module);
  const parsed = await fetchJson(entry.file, "The Psalms text");
  if (
    !Array.isArray(parsed) ||
    parsed.length !== entry.chapters ||
    !parsed.every((chapter) => Array.isArray(chapter))
  ) {
    throw new DataError("The Psalms text is not in the expected format.");
  }
  return parsed;
}

/**
 * The chapters of a version, each an array of verse strings, as many as the
 * catalogue says (150 for every shipped version). Read once per version and
 * kept.
 *
 * @param {string} module
 * @returns {Promise<string[][]>}
 */
export function getVersionData(module) {
  if (!versionPromises.has(module)) {
    const loading = readVersion(module);
    versionPromises.set(module, loading);
    // A failure is not kept, so the next call tries again.
    loading.catch(() => versionPromises.delete(module));
  }
  return versionPromises.get(module);
}

/** The module of the version being read. */
export function currentVersion() {
  return current;
}

/** Sets the reading view's text direction and language to the version's. */
function applyReadingDirection(entry) {
  // No document in the background worker, and no reading view in some tests.
  const view = globalThis.document?.getElementById("readingView");
  if (!view) return;
  view.setAttribute("dir", entry.rtl ? "rtl" : "ltr");
  view.setAttribute("lang", entry.lang_short);
}

/**
 * The first version for a reader who has not chosen: the NIV for English, else
 * the first version in their language as the phone app lists them, else the NIV.
 */
function firstChoice(catalogue, uiLanguage) {
  if (uiLanguage === "en") return MODERN;
  const match = catalogue.find((v) => v.lang_short === uiLanguage && v.module !== MODERN);
  return match?.module ?? MODERN;
}

/**
 * Chooses the version to read: the saved one, or, when there is none (or it is
 * no longer in the list), a first choice for the app's language. The first
 * choice is saved, so it stays until the reader picks another.
 *
 * @param {{bibleVersion?: string|null}} [settings]
 * @param {string} [uiLanguage] the app language, such as "de"
 * @returns {Promise<string>} the module in use
 */
export async function initVersions(settings, uiLanguage) {
  const catalogue = await loadCatalogue();
  let module = settings?.bibleVersion;
  if (!catalogue.some((v) => v.module === module)) {
    module = firstChoice(catalogue, uiLanguage);
    // A failed save rejects before anything changes, so the app keeps the NIV.
    await updateSettings({ bibleVersion: module });
  }
  current = module;
  applyReadingDirection(catalogue.find((v) => v.module === module));
  return module;
}

/**
 * Makes `module` the version being read and saves the choice. Rejects, and
 * changes nothing, for an unknown module or a failed save.
 */
export async function setCurrentVersion(module) {
  const entry = await findEntry(module);
  await updateSettings({ bibleVersion: module });
  current = module;
  applyReadingDirection(entry);
}

/**
 * Short text for the header chip: "NIV" for the bundled version, the module in
 * capitals when it is six characters or fewer, otherwise the first word of the
 * version's name. Synchronous, so it needs the catalogue loaded; until then a
 * long module shows in capitals.
 */
export function versionLabel(module) {
  if (module === MODERN) return "NIV";
  if (module.length <= 6) return module.toUpperCase();
  const name = loaded?.find((v) => v.module === module)?.name ?? "";
  return name.trim().split(/\s+/)[0] || module.toUpperCase();
}

/** Test seam: forget what was loaded and go back to the NIV. */
export function resetVersions() {
  current = MODERN;
  loaded = null;
  cataloguePromise = null;
  versionPromises.clear();
}
