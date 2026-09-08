// ─── Settings ─────────────────────────────────────────────────────────────────
// Appearance, plus export and restore of personal data.

import { el, byId, toast, reportError, confirmDialog } from "./dom.js";
import {
  getSettings,
  updateSettings,
  loadStore,
  replaceUserData,
  THEMES,
  FONT_SIZES,
} from "./storage.js";
import { createBackup, parseBackup, backupFileName, MAX_BACKUP_BYTES } from "./backup.js";

// ─── Appearance ───────────────────────────────────────────────────────────────

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", THEMES.includes(theme) ? theme : "light");
}

export function applyFontSize(size) {
  document.documentElement.setAttribute("data-size", FONT_SIZES.includes(size) ? size : "medium");
}

export function applyToolbarCollapsed(collapsed) {
  const wrapper = byId("toolbarWrapper");
  const button = byId("btnToggleToolbar");
  wrapper.classList.toggle("is-collapsed", collapsed);
  wrapper.hidden = collapsed;
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  button.title = collapsed ? "Show toolbar" : "Hide toolbar";
  button.setAttribute("aria-label", button.title);
  button.classList.toggle("is-collapsed", collapsed);
}

/** Reflect stored settings in the settings controls. */
export function paintSettingsControls(settings) {
  for (const button of document.querySelectorAll(".theme-btn")) {
    const active = button.dataset.theme === settings.theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  for (const button of document.querySelectorAll(".font-size-btn")) {
    const active = button.dataset.size === settings.fontSize;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

/** Apply stored settings to the document at startup. */
export async function initAppearance() {
  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    // Appearance is not worth blocking the popup for; fall back to defaults and
    // let the reading view report the underlying storage problem.
    console.error("Psalms Way: could not read settings", error);
    settings = { theme: "light", fontSize: "medium", toolbarCollapsed: false };
  }
  applyTheme(settings.theme);
  applyFontSize(settings.fontSize);
  applyToolbarCollapsed(Boolean(settings.toolbarCollapsed));
  paintSettingsControls(settings);
  return settings;
}

export async function changeSetting(patch, { apply } = {}) {
  // Apply immediately so the change feels instant, then persist. If the write
  // fails the user is told, rather than finding the setting reverted next time
  // with no explanation.
  apply?.();
  try {
    const settings = await updateSettings(patch);
    paintSettingsControls(settings);
    return settings;
  } catch (error) {
    reportError(error, "That setting could not be saved.");
    return null;
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

function extensionVersion() {
  try {
    return globalThis.chrome?.runtime?.getManifest?.().version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function exportBackup() {
  let store;
  try {
    store = await loadStore();
  } catch (error) {
    reportError(error, "Your data could not be read.");
    return;
  }

  const total = store.favourites.length + store.notes.length + store.history.length;
  if (total === 0) {
    toast("There is nothing to export yet.", "error");
    return;
  }

  const backup = createBackup(store, extensionVersion());
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = el("a", { href: url, download: backupFileName() });
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next turn so the download has taken the reference.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  toast(`Exported ${store.favourites.length} saved, ${store.notes.length} notes`, "success");
}

// ─── Restore ──────────────────────────────────────────────────────────────────

export async function importBackup(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) {
    toast("That file is too large to be a Psalms Way backup.", "error");
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (error) {
    reportError(error, "That file could not be read.");
    return;
  }

  let parsed;
  try {
    parsed = parseBackup(text);
  } catch (error) {
    // BackupError messages are written for readers, so show them directly.
    console.error("Psalms Way: rejected backup", error);
    toast(error.message ?? "That file is not a valid backup.", "error");
    return;
  }

  const { counts } = parsed;
  const confirmed = await confirmDialog({
    title: "Replace your data?",
    message:
      `This backup holds ${counts.favourites} saved verses, ${counts.notes} notes and ` +
      `${counts.history} history entries. Restoring replaces what is on this browser now.`,
    confirmLabel: "Restore",
    destructive: true,
  });
  if (!confirmed) return;

  try {
    const next = await replaceUserData(parsed.data);
    applyTheme(next.settings.theme);
    applyFontSize(next.settings.fontSize);
    applyToolbarCollapsed(next.settings.toolbarCollapsed);
    paintSettingsControls(next.settings);
    toast("Backup restored", "success");
    return next;
  } catch (error) {
    reportError(error, "Your backup could not be restored.");
    return null;
  }
}
