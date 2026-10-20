// ─── Bible versions ───────────────────────────────────────────────────────────
// Which versions exist, which one is chosen, and their text. Wave 0 stub: only
// the bundled NIV (`modern`, psalms.json). Task 1 adds the other versions
// behind these same names.

import { getData } from "./data.js";

let current = "modern";

/** [{module, name, lang, lang_short, year, chapters, rtl, copyright, file}] */
export async function loadCatalogue() {
  return [
    {
      module: "modern",
      name: "New International Version (1984)",
      lang: "English",
      lang_short: "en",
      year: "1984",
      chapters: 150,
      rtl: false,
      copyright: "",
      file: "psalms.json",
    },
  ];
}

/** The chapters of a version, as arrays of verse strings. */
export async function getVersionData(module) {
  if (module !== "modern") throw new Error(`Unknown version: ${module}`);
  return getData();
}

export function currentVersion() {
  return current;
}

/** Chooses the version from settings, or from the language when none is set. */
export async function initVersions(settings, _uiLanguage) {
  current = settings?.bibleVersion ?? "modern";
  if (current !== "modern") current = "modern";
  return current;
}

export async function setCurrentVersion(module) {
  current = module;
}

/** Short text for the header chip. */
export function versionLabel(module) {
  return module === "modern" ? "NIV" : module.toUpperCase();
}
