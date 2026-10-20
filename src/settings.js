// ─── Settings ─────────────────────────────────────────────────────────────────
// Appearance, the interface language, and export and restore of personal data.

import { el, byId, toast, reportError, confirmDialog } from "./dom.js";
import { repaintCloudButton } from "./cloud.js";
import { SUPPORTED_LANGUAGES, applyTranslations, initI18n, languageName, t } from "./i18n.js";
import { refreshPassage } from "./reader.js";
import {
  getSettings,
  updateSettings,
  loadStore,
  replaceUserData,
  THEMES,
  FONT_SIZES,
  ACCENTS,
} from "./storage.js";
import { createBackup, parseBackup, backupFileName, MAX_BACKUP_BYTES } from "./backup.js";

// ─── Appearance ───────────────────────────────────────────────────────────────

/** The system-scheme query and listener while "auto" is chosen, otherwise null. */
let systemWatch = null;

function stopFollowingSystem() {
  if (!systemWatch) return;
  systemWatch.query.removeEventListener("change", systemWatch.listener);
  systemWatch = null;
}

/**
 * Set the theme on <html>. The stylesheet only knows light, sepia and dark, so
 * "auto" is resolved here from the system's colour scheme and kept up to date
 * until another theme is chosen.
 */
export function applyTheme(theme) {
  stopFollowingSystem();
  const root = document.documentElement;
  if (theme === "auto") {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => root.setAttribute("data-theme", query.matches ? "dark" : "light");
    query.addEventListener("change", listener);
    systemWatch = { query, listener };
    listener();
    return;
  }
  root.setAttribute("data-theme", THEMES.includes(theme) ? theme : "light");
}

/** Set the accent colour on <html>; styles/appearance.css does the rest. */
export function applyAccent(accent) {
  document.documentElement.setAttribute("data-accent", ACCENTS.includes(accent) ? accent : "green");
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
  button.title = collapsed
    ? t("toolbarShow", {}, "Show toolbar")
    : t("toolbarHide", {}, "Hide toolbar");
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
  for (const button of document.querySelectorAll(".accent-btn")) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.accent === settings.accent ? "true" : "false"
    );
  }
  const language = byId("languageSelect");
  if (language) {
    // A saved language the extension does not have is shown as Automatic, which is what it does.
    const known = [...language.options].some((option) => option.value === settings.uiLanguage);
    language.value = known ? settings.uiLanguage : "auto";
  }
}

/**
 * Puts the current language on what the popup draws without being asked: the marked-up
 * text, and the buttons whose names follow their state, which are set from code.
 */
export function paintLanguage() {
  applyTranslations();
  applyToolbarCollapsed(byId("toolbarWrapper").classList.contains("is-collapsed"));
  repaintCloudButton();
}

/**
 * Shows a newly chosen interface language: load it, then redraw the text and the Psalm
 * behind Settings. A panel that is closed is drawn again when it is next opened.
 */
export async function applyLanguage(setting) {
  await initI18n(setting);
  paintLanguage();
  await refreshPassage();
}

/**
 * Fills the Language select, once: "Automatic" (already in the markup) and then every
 * language under its own name, so a reader who cannot read the current language can
 * still find theirs. Choosing one saves it and calls `onChanged(setting)`, which loads
 * the language and redraws the page. A save that fails is reported (by changeSetting)
 * and the language still applies for this visit, as with the other settings.
 *
 * @param {{onChanged: (setting: string) => (void|Promise<void>)}} options
 */
export function initLanguageSelect({ onChanged }) {
  const select = byId("languageSelect");
  if (!select) return;
  // Alphabetical by English name, so the order does not depend on the script of the names.
  const english = new Intl.DisplayNames(["en"], { type: "language" });
  const codes = [...SUPPORTED_LANGUAGES].sort((a, b) =>
    (english.of(a) ?? a).localeCompare(english.of(b) ?? b, "en")
  );
  for (const code of codes) {
    // lang, so a screen reader pronounces each name in its own language.
    select.append(el("option", { value: code, lang: code, text: languageName(code) }));
  }
  select.addEventListener("change", async () => {
    const uiLanguage = select.value;
    await changeSetting({ uiLanguage });
    try {
      await onChanged(uiLanguage);
    } catch (error) {
      reportError(error, t("languageChangeError", {}, "The language could not be changed."));
    }
  });
}

/** Make each accent swatch save and apply its colour. Called once, from initAppearance. */
function wireAccentButtons() {
  for (const button of document.querySelectorAll("#accentControls .accent-btn[data-accent]")) {
    button.addEventListener("click", () =>
      changeSetting(
        { accent: button.dataset.accent },
        { apply: () => applyAccent(button.dataset.accent) }
      )
    );
  }
}

/** Apply stored settings to the document at startup, and wire the accent swatches. */
export async function initAppearance() {
  wireAccentButtons();
  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    // Appearance is not worth blocking the popup for; fall back to defaults and
    // let the reading view report the underlying storage problem.
    console.error("Psalms Way: could not read settings", error);
    settings = { theme: "light", fontSize: "medium", toolbarCollapsed: false, accent: "green" };
  }
  applyTheme(settings.theme);
  applyAccent(settings.accent);
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
    reportError(error, t("settingSaveError", {}, "That setting could not be saved."));
    return null;
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

// Each count has its own noun in its own plural form, so "1 bookmark, 2 notes" agrees.
const bookmarkCount = (count) => t("countBookmarks", { count }, "{{count}} bookmarks");
const noteCount = (count) => t("countNotes", { count }, "{{count}} notes");
const historyCount = (count) => t("countHistoryEntries", { count }, "{{count}} history entries");

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
    reportError(error, t("dataReadError", {}, "Your data could not be read."));
    return;
  }

  const total = store.favourites.length + store.notes.length + store.history.length;
  if (total === 0) {
    toast(t("exportNothing", {}, "There is nothing to export yet."), "error");
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

  toast(
    t(
      "exportDone",
      { bookmarks: bookmarkCount(store.favourites.length), notes: noteCount(store.notes.length) },
      "Exported {{bookmarks}}, {{notes}}"
    ),
    "success"
  );
}

// ─── Restore ──────────────────────────────────────────────────────────────────

export async function importBackup(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) {
    toast(t("backupTooLarge", {}, "That file is too large to be a Psalms Way backup."), "error");
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (error) {
    reportError(error, t("fileReadError", {}, "That file could not be read."));
    return;
  }

  let parsed;
  try {
    parsed = parseBackup(text);
  } catch (error) {
    // BackupError messages are written for readers, so show them directly.
    console.error("Psalms Way: rejected backup", error);
    toast(error.message ?? t("backupInvalid", {}, "That file is not a valid backup."), "error");
    return;
  }

  const { counts } = parsed;
  const confirmed = await confirmDialog({
    title: t("restoreTitle", {}, "Replace your data?"),
    message: t(
      "restoreMessage",
      {
        bookmarks: bookmarkCount(counts.favourites),
        notes: noteCount(counts.notes),
        history: historyCount(counts.history),
      },
      "This backup holds {{bookmarks}}, {{notes}} and {{history}}. Restoring replaces what is on this browser now."
    ),
    confirmLabel: t("restoreConfirm", {}, "Restore"),
    destructive: true,
  });
  if (!confirmed) return;

  try {
    const next = await replaceUserData(parsed.data);
    applyTheme(next.settings.theme);
    applyAccent(next.settings.accent);
    applyFontSize(next.settings.fontSize);
    applyToolbarCollapsed(next.settings.toolbarCollapsed);
    paintSettingsControls(next.settings);
    toast(t("restoreDone", {}, "Backup restored"), "success");
    return next;
  } catch (error) {
    reportError(error, t("restoreError", {}, "Your backup could not be restored."));
    return null;
  }
}

/**
 * Restores a backup file the reader chose, and shows the result: the backup brings its
 * own language, as it brings its own theme, so that is loaded and drawn, and then
 * `onRestored(next)` redraws what depends on the saved data. A failure after the
 * restore is reported, never lost in a rejected promise.
 *
 * @param {File | undefined} file
 * @param {{onRestored: (next: object) => (void|Promise<void>)}} options
 */
export async function restoreBackup(file, { onRestored }) {
  const restored = await importBackup(file);
  if (!restored) return;
  try {
    await initI18n(restored.settings.uiLanguage);
    paintLanguage();
    await onRestored(restored);
  } catch (error) {
    reportError(
      error,
      t(
        "restoreShowError",
        {},
        "Your backup was restored, but the page could not be updated. Close and reopen the popup."
      )
    );
  }
}
