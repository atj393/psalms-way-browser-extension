// The exact contents of a shipped extension package.
//
// Kept in one place so the packaging script and the validation script cannot
// disagree about what ships. Anything not listed here is development-only:
// tests, tooling, documentation, screenshots and audit notes stay in the
// repository and out of the zip.

import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Top-level files that ship, in the order they are added. */
const TOP_LEVEL_FILES = [
  "manifest.json",
  "popup.html",
  "style.css",
  "psalms.json",
  "icon16.png",
  "icon48.png",
  "icon128.png",
];

/**
 * Folders whose files all ship: the code, the per-feature stylesheets, the
 * Bible versions, the translations and the prayers. Listing folders rather
 * than files keeps a new module or version from being forgotten.
 */
export const PACKAGE_DIRS = ["src", "styles", "bibles", "locales", "data"];

/** File types a shipped folder may hold; anything else stays out. */
const SHIPPED_EXTENSIONS = /\.(js|css|json|png|svg)$/;

const root = fileURLToPath(new URL("../", import.meta.url));

function filesUnder(dir) {
  const absolute = `${root}${dir}`;
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .sort()
    .flatMap((name) => {
      const relative = `${dir}/${name}`;
      if (statSync(`${root}${relative}`).isDirectory()) return filesUnder(relative);
      return SHIPPED_EXTENSIONS.test(name) ? [relative] : [];
    });
}

/** Every file in the package, in the order it is added. */
export const PACKAGE_FILES = [...TOP_LEVEL_FILES, ...PACKAGE_DIRS.flatMap(filesUnder)];

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
