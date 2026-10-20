#!/usr/bin/env node
// Copies the phone app's translation files into locales/app/, unchanged, so
// both apps use the same words. Run after the phone's translations change:
//   node scripts/sync-locales.js [path to psalms-way-app]
// Also makes sure every language has a locales/ext/<code>.json (the
// extension's own wording), creating an empty one where it is missing.

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const phone = resolve(process.argv[2] ?? join(root, "..", "psalms-way-app"));
const source = join(phone, "i18n", "locales");

if (!existsSync(source)) {
  console.error(`Phone translations not found at ${source}`);
  process.exit(1);
}

const appDir = join(root, "locales", "app");
const extDir = join(root, "locales", "ext");
mkdirSync(appDir, { recursive: true });
mkdirSync(extDir, { recursive: true });

const codes = readdirSync(source)
  .filter((name) => /^[a-z]{2}\.json$/.test(name))
  .map((name) => name.slice(0, 2));
for (const code of codes) {
  copyFileSync(join(source, `${code}.json`), join(appDir, `${code}.json`));
  const ext = join(extDir, `${code}.json`);
  if (!existsSync(ext)) writeFileSync(ext, "{}\n");
}
console.log(`Copied ${codes.length} phone translation files into locales/app/.`);
