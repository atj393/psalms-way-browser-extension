#!/usr/bin/env node
// Confirms the package list is complete, accurate and free of anything that
// should not be distributed, and that no shipped file references a missing one.

import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUPPORTED_LANGUAGES } from "../src/i18n.js";
import { PACKAGE_DIRS, PACKAGE_FILES, FORBIDDEN_PATTERNS, filesUnder } from "./package-manifest.js";

// The only file types a browser extension package ships from the shipped folders.
const ALLOWED_EXTENSIONS = /\.(js|css|json|png|svg)$/;

// A dotfile or a file inside a dot-folder (.DS_Store, .notes.json, .cache/x.js) is litter.
const HIDDEN_PATH = /(^|\/)\./;

// The phone app's languages; the extension carries all of them.
const EXPECTED_LANGUAGE_COUNT = 47;

const root = new URL("../", import.meta.url);
const resolve = (relative) => fileURLToPath(new URL(relative, root));

const problems = [];
const note = (message) => problems.push(message);

// 1. Every listed file exists.
let totalBytes = 0;
for (const file of PACKAGE_FILES) {
  const path = resolve(file);
  if (!existsSync(path)) {
    note(`listed in the package but missing from the repository: ${file}`);
    continue;
  }
  totalBytes += statSync(path).size;
}

// 2. Nothing forbidden slipped into the list.
for (const file of PACKAGE_FILES) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(file)) note(`${file} must not be shipped (matches ${pattern})`);
  }
}

// 3. Shipped folders exist, are not empty, and hold only the file types an
// extension package should ship. The package list takes every file in them, so
// a stray .txt, font, .html or dotfile would otherwise travel in the zip
// unnoticed, and a renamed or deleted folder would otherwise ship nothing.
for (const dir of PACKAGE_DIRS) {
  if (!existsSync(resolve(dir))) {
    note(`shipped folder is missing: ${dir}/`);
    continue;
  }
  const files = filesUnder(dir);
  if (files.length === 0) note(`shipped folder is empty: ${dir}/`);
  for (const file of files) {
    if (!ALLOWED_EXTENSIONS.test(file) || HIDDEN_PATH.test(file)) {
      note(
        `${file} is in a shipped folder but is not a visible .js, .css, .json, .png or .svg file`
      );
    }
  }
}

// 4. Every language has both translation files; a missing one would silently
// fall back to English. A shortened language list would hide that, so its
// length is checked too.
if (SUPPORTED_LANGUAGES.length !== EXPECTED_LANGUAGE_COUNT) {
  note(
    `SUPPORTED_LANGUAGES has ${SUPPORTED_LANGUAGES.length} entries, expected ${EXPECTED_LANGUAGE_COUNT}`
  );
}
for (const code of SUPPORTED_LANGUAGES) {
  for (const kind of ["app", "ext"]) {
    const file = `locales/${kind}/${code}.json`;
    if (!existsSync(resolve(file))) note(`missing translation file: ${file}`);
  }
}

// 5. Local references inside shipped files resolve to shipped files.
const referencePattern = /(?:src|href)="\.\/([^"]+)"|from\s+"\.\/([^"]+)"|fetch\("([^"]+)"\)/g;
for (const file of PACKAGE_FILES) {
  if (!/\.(html|js)$/.test(file)) continue;
  const path = resolve(file);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf8");
  const baseDir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  for (const match of source.matchAll(referencePattern)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (!target || /^(https?:|data:|chrome:|#)/.test(target)) continue;
    const resolved = target.startsWith("./")
      ? `${baseDir}${target.slice(2)}`
      : `${baseDir}${target}`;
    const normalised = resolved.replace(/^\.\//, "");
    // psalms.json is fetched from the extension root, not relative to src/.
    const candidates = [normalised, target.replace(/^\.\//, "")];
    if (!candidates.some((candidate) => PACKAGE_FILES.includes(candidate))) {
      note(`${file} references "${target}", which is not in the package`);
    }
  }
}

// 6. No remote code, and no dynamic evaluation.
const REMOTE_PATTERNS = [
  [/<script[^>]+src=["']https?:/i, "remote script tag"],
  [/<link[^>]+href=["']https?:[^"']*\.css/i, "remote stylesheet"],
  [/\beval\s*\(/, "eval()"],
  [/new\s+Function\s*\(/, "new Function()"],
  [/\.innerHTML\s*=/, "innerHTML assignment"],
  [/\.outerHTML\s*=/, "outerHTML assignment"],
  [/document\.write\s*\(/, "document.write()"],
  [/insertAdjacentHTML\s*\(/, "insertAdjacentHTML()"],
];
for (const file of PACKAGE_FILES) {
  if (!/\.(html|js)$/.test(file)) continue;
  const path = resolve(file);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, "utf8");
  for (const [pattern, label] of REMOTE_PATTERNS) {
    if (pattern.test(source)) note(`${file} contains ${label}`);
  }
}

if (problems.length > 0) {
  console.error(`package validation failed (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("package contents OK");
console.log(`  files         ${PACKAGE_FILES.length}`);
console.log(`  unpacked size ${(totalBytes / 1024).toFixed(0)} KB`);
console.log(`  remote code   none`);
