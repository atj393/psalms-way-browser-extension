#!/usr/bin/env node
// Copies the phone app's Bible versions into bibles/ and writes the catalogue.
//   node scripts/sync-bibles.js [path to psalms-way-app]
// Reads psalms_extracted/psalms-*.json ({metadata, psalms}) and writes:
//   bibles/<module>.json   the `psalms` array alone, compact, text unchanged
//   bibles/index.json      every version (the bundled NIV first, then sorted by
//                          language name and version name), one entry per line
// Files are written to a temporary name and renamed, and any other file left in
// bibles/ (a version dropped since the last run) is deleted.
// Run it again after the phone's Bibles change; the extension reads these files.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const phone = resolve(process.argv[2] ?? join(root, "..", "psalms-way-app"));
const source = join(phone, "psalms_extracted");

if (!existsSync(source)) {
  console.error(`Phone Bibles not found at ${source}`);
  process.exit(1);
}

// From the phone's services/psalmsModules.ts. Many files leave `lang` empty,
// so the language name comes from the ISO code; a file's own `lang` is used
// only for a code missing here.
const LANGUAGE_NAMES = {
  af: "Afrikaans",
  ar: "Arabic",
  bn: "Bengali",
  bo: "Tibetan",
  cs: "Czech",
  de: "German",
  en: "English",
  es: "Spanish",
  fa: "Persian",
  fi: "Finnish",
  fr: "French",
  gu: "Gujarati",
  ha: "Hausa",
  he: "Hebrew",
  hi: "Hindi",
  ht: "Haitian Creole",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  kn: "Kannada",
  ko: "Korean",
  lt: "Lithuanian",
  lv: "Latvian",
  mi: "Maori",
  ml: "Malayalam",
  mr: "Marathi",
  my: "Burmese",
  ne: "Nepali",
  nl: "Dutch",
  pa: "Punjabi",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  so: "Somali",
  sq: "Albanian",
  ta: "Tamil",
  te: "Telugu",
  th: "Thai",
  tl: "Tagalog",
  tr: "Turkish",
  ug: "Uyghur",
  ur: "Urdu",
  vi: "Vietnamese",
  wo: "Wolof",
  zh: "Chinese",
};

const RTL_CODES = ["he", "ar", "fa", "ur", "ug"];
const CREDIT_LENGTH = 160;
const CHAPTERS = 150;
const MODULE_PATTERN = /^[a-z0-9_]+$/;

// Versions left out of the extension, with the reason. Every version that ships
// has exactly 150 chapters, chapter N being Psalm N, and the text is never
// edited; a version that cannot meet that is left out rather than patched.
const EXCLUDED = {
  lt_heritage:
    "a partial translation (selected verses only, with no verse numbers), so neither its psalms nor its verses can be placed",
  ta_oitce:
    "has 148 chapters, lacking Psalms 115 and 116, and the chapter for Psalm 11 holds the verses of Psalms 11, 115 and 116 mixed together, which cannot be separated reliably",
};

/** The language label the phone shows: its table first, then the file's own, then "Other". */
function resolveLanguageName(metadata) {
  const known = LANGUAGE_NAMES[metadata.lang_short];
  if (known) return known;
  const supplied = metadata.lang;
  return typeof supplied === "string" && supplied.trim().length > 0 ? supplied : "Other";
}

/** The copyright text on one line, cut to 160 characters (the last being "…") when longer. */
function creditLine(metadata) {
  const text =
    typeof metadata.copyright_statement === "string" && metadata.copyright_statement.trim()
      ? metadata.copyright_statement
      : typeof metadata.copyright === "string"
        ? metadata.copyright
        : "";
  // Cut by character, not by UTF-16 unit, so an emoji or a rare letter is never split.
  const characters = [...text.replace(/\s+/g, " ").trim()];
  if (characters.length <= CREDIT_LENGTH) return characters.join("");
  return `${characters
    .slice(0, CREDIT_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

/** Writes the whole file or none of it: to a temporary name first, then renamed over the old one. */
function writeFileAtomically(path, text) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const bibles = join(root, "bibles");
mkdirSync(bibles, { recursive: true });

const entries = [];
const kept = new Set(["index.json"]);
const files = readdirSync(source)
  .filter((name) => /^psalms-.+\.json$/.test(name))
  .sort();

for (const name of files) {
  const { metadata, psalms } = JSON.parse(readFileSync(join(source, name), "utf8"));
  if (!metadata || typeof metadata.module !== "string" || !MODULE_PATTERN.test(metadata.module)) {
    fail(`${name}: metadata.module is missing or not lowercase letters, digits and underscores`);
  }
  if (typeof metadata.lang_short !== "string" || !/^[a-z]{2}$/.test(metadata.lang_short)) {
    fail(`${name}: metadata.lang_short is missing or not a two-letter code`);
  }
  if (typeof metadata.name !== "string" || !metadata.name.trim()) {
    fail(`${name}: metadata.name is missing`);
  }
  if (!Array.isArray(psalms) || psalms.length === 0 || !psalms.every(Array.isArray)) {
    fail(`${name}: psalms must be a list of chapters, each a list of verses`);
  }
  if (entries.some((entry) => entry.module === metadata.module)) {
    fail(`${name}: the module ${metadata.module} appears twice`);
  }

  if (Object.hasOwn(EXCLUDED, metadata.module)) {
    console.log(`Left out ${metadata.module}: ${EXCLUDED[metadata.module]}.`);
    continue;
  }

  if (psalms.length !== CHAPTERS) {
    fail(
      `${name}: ${psalms.length} chapters, expected ${CHAPTERS} (add the module to EXCLUDED if it cannot be fixed)`
    );
  }
  writeFileAtomically(join(bibles, `${metadata.module}.json`), JSON.stringify(psalms));
  kept.add(`${metadata.module}.json`);
  entries.push({
    module: metadata.module,
    name: metadata.name.trim(),
    lang: resolveLanguageName(metadata),
    lang_short: metadata.lang_short,
    year: String(metadata.year ?? ""),
    chapters: psalms.length,
    rtl: RTL_CODES.includes(metadata.lang_short),
    copyright: creditLine(metadata),
    file: `bibles/${metadata.module}.json`,
  });
}

// "en" keeps the order the same on every machine; the phone sorts the same way.
entries.sort((a, b) => a.lang.localeCompare(b.lang, "en") || a.name.localeCompare(b.name, "en"));

const modern = {
  module: "modern",
  name: "New International Version (1984)",
  lang: "English",
  lang_short: "en",
  year: "1984",
  chapters: JSON.parse(readFileSync(join(root, "psalms.json"), "utf8")).length,
  rtl: false,
  copyright: "",
  file: "psalms.json",
};

const catalogue = [modern, ...entries];
writeFileAtomically(
  join(bibles, "index.json"),
  `[\n${catalogue.map((entry) => JSON.stringify(entry)).join(",\n")}\n]\n`
);

// Only now that everything is written: remove what an earlier run left behind.
for (const name of readdirSync(bibles)) {
  if (kept.has(name)) continue;
  rmSync(join(bibles, name), { force: true });
  console.log(`Removed bibles/${name}, which is no longer in the catalogue.`);
}
console.log(
  `Wrote ${entries.length} Bible files and bibles/index.json (${catalogue.length} versions).`
);
