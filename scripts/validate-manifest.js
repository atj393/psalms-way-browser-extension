#!/usr/bin/env node
// Manifest V3 checks, including a deliberate guard on the permission list.
//
// The permission footprint is the extension's main promise to its users, so a
// new permission has to be added here on purpose rather than slipped in.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifestPath = fileURLToPath(new URL("manifest.json", root));

/** Every permission this extension is allowed to request, with its reason. */
const ALLOWED_PERMISSIONS = {
  storage: "keeps favourites, notes, history and settings in chrome.storage.local",
};

const problems = [];
const note = (message) => problems.push(message);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`manifest.json could not be read: ${error.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  note(`manifest_version must be 3, found ${manifest.manifest_version}`);
}

if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
  note("name is missing");
} else if (manifest.name.length > 45) {
  note(`name is ${manifest.name.length} characters; the Chrome Web Store limit is 45`);
}

if (!/^\d+(\.\d+){0,3}$/.test(String(manifest.version ?? ""))) {
  note(`version "${manifest.version}" is not a valid extension version`);
}

if (typeof manifest.description !== "string" || manifest.description.trim() === "") {
  note("description is missing");
} else if (manifest.description.length > 132) {
  note(`description is ${manifest.description.length} characters; the limit is 132`);
}

// Permissions
const permissions = manifest.permissions ?? [];
if (!Array.isArray(permissions)) {
  note("permissions must be an array");
} else {
  for (const permission of permissions) {
    if (!(permission in ALLOWED_PERMISSIONS)) {
      note(
        `permission "${permission}" is not in the approved list. ` +
          `Add it to scripts/validate-manifest.js with a justification if it is genuinely needed.`
      );
    }
  }
}

for (const field of ["host_permissions", "optional_host_permissions", "content_scripts"]) {
  if (manifest[field]) {
    note(`${field} is set. This extension must not read or modify any web page.`);
  }
}

if (manifest.content_security_policy?.extension_pages?.includes("unsafe-eval")) {
  note("content_security_policy allows unsafe-eval");
}

if (manifest.background) {
  note("a background service worker is declared but the extension does not need one");
}

// Action and icons
if (!manifest.action?.default_popup) {
  note("action.default_popup is missing");
} else if (!existsSync(fileURLToPath(new URL(manifest.action.default_popup, root)))) {
  note(`action.default_popup points at a missing file: ${manifest.action.default_popup}`);
}

for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  if (!existsSync(fileURLToPath(new URL(path, root)))) {
    note(`icon ${size} is missing: ${path}`);
  }
}
if (!manifest.icons?.["16"] || !manifest.icons?.["48"] || !manifest.icons?.["128"]) {
  note("icons should include 16, 48 and 128 pixel sizes");
}

if (problems.length > 0) {
  console.error(`manifest.json failed validation (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("manifest.json OK");
console.log(`  name          ${manifest.name}`);
console.log(`  version       ${manifest.version}`);
console.log(`  permissions   ${permissions.length ? permissions.join(", ") : "(none)"}`);
console.log(`  host access   none`);
