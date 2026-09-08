// The exact contents of a shipped extension package.
//
// Kept in one place so the packaging script and the validation script cannot
// disagree about what ships. Anything not listed here is development-only:
// tests, tooling, documentation, screenshots and audit notes stay in the
// repository and out of the zip.

/** Files that must be present in the package, in the order they are added. */
export const PACKAGE_FILES = [
  "manifest.json",
  "popup.html",
  "style.css",
  "psalms.json",
  "icon16.png",
  "icon48.png",
  "icon128.png",
  "src/app.js",
  "src/backup.js",
  "src/data.js",
  "src/dates.js",
  "src/dom.js",
  "src/icons.js",
  "src/notes.js",
  "src/panels.js",
  "src/reader.js",
  "src/search.js",
  "src/settings.js",
  "src/storage.js",
];

/** Paths that must never appear in a package. */
export const FORBIDDEN_PATTERNS = [
  /^node_modules\//,
  /^test\//,
  /^scripts\//,
  /^docs\//,
  /^coverage\//,
  /^\.github\//,
  /^\.git\//,
  /^brag-output\//,
  /package(-lock)?\.json$/,
  /vitest\.config\.js$/,
  /eslint\.config\.js$/,
  /\.test\.js$/,
  /^CLAUDE\.md$/,
];
