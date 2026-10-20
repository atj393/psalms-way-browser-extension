// ─── Application wiring ───────────────────────────────────────────────────────
// Bootstrap, view switching, focus management and event binding.
//
// The popup is destroyed every time it closes, so nothing here may treat a
// module-level variable as durable state. Anything worth keeping is written
// through storage.js and read back on the next open.

import { byId, toast, reportError, focusFirst, hydrateIcons } from "./dom.js";
import { getData, parseChapterInput, wrapChapter, CHAPTER_COUNT } from "./data.js";
import { getDailyChapterIndex } from "./dates.js";
import {
  STORE_KEY,
  getHistory,
  getSettings,
  isStorageAvailable,
  loadStore,
  matchesCache,
  resetStoreCache,
} from "./storage.js";
import {
  showPassage,
  showRandomChapter,
  showRandomVerse,
  getCurrentChapter,
  getCurrentVerse,
  refreshFavChapter,
  refreshPassage,
  setCompareOpener,
  setNoteEditorOpener,
} from "./reader.js";
import {
  renderHistory,
  renderLibrary,
  runSearch,
  setNavigator,
  showLibraryTab,
  confirmClearHistory,
} from "./panels.js";
import { openNoteEditor, cancelNoteEditor, setEditorCloser } from "./notes.js";
import {
  applyFontSize,
  applyTheme,
  applyToolbarCollapsed,
  changeSetting,
  exportBackup,
  importBackup,
  initAppearance,
  paintSettingsControls,
} from "./settings.js";
import {
  CLOUD_STATE_KEY,
  paintCloudButton,
  refreshCloud,
  renderCloud,
  sendCloud,
} from "./cloud.js";
import { applyTranslations, currentLanguage, initI18n, t } from "./i18n.js";
import { currentVersion, initVersions, loadCatalogue, versionLabel } from "./versions.js";
import { renderVersionPicker } from "./versionPicker.js";
import { openToday, renderToday } from "./today.js";
import { renderCompare } from "./compare.js";
import { renderPrayers } from "./prayers.js";
import { recordVisit, renderProgress } from "./progress.js";
import { toggleFavoriteChapter } from "./phoneData.js";

/** Panel id and the toolbar button that opens it, per view. */
const VIEWS = {
  reading: { panel: "readingPanel", trigger: null },
  search: { panel: "searchPanel", trigger: "btnSearch" },
  library: { panel: "libraryPanel", trigger: "btnLibrary" },
  history: { panel: "historyPanel", trigger: "btnHistory" },
  today: { panel: "todayPanel", trigger: "btnTodaysPsalm" },
  version: { panel: "versionPanel", trigger: "btnVersion" },
  compare: { panel: "comparePanel", trigger: "btnCompare" },
  prayers: { panel: "prayersPanel", trigger: "btnPrayers" },
  progress: { panel: "progressPanel", trigger: "btnProgress" },
  cloud: { panel: "cloudPanel", trigger: "btnCloud" },
  settings: { panel: "settingsPanel", trigger: "btnSettings" },
  note: { panel: "notePanel", trigger: null },
};

let currentView = "reading";

function showView(view) {
  currentView = view;
  for (const [name, { panel }] of Object.entries(VIEWS)) {
    const node = byId(panel);
    if (node) node.hidden = name !== view;
  }
  for (const { trigger } of Object.values(VIEWS)) {
    if (!trigger) continue;
    const button = byId(trigger);
    if (button) button.setAttribute("aria-pressed", "false");
  }
  const active = VIEWS[view]?.trigger;
  if (active) byId(active)?.setAttribute("aria-pressed", "true");
}

/**
 * Return to reading and put focus back on whatever opened the panel we left.
 * Without this, closing a panel drops focus onto <body> and a keyboard user has
 * to tab from the start of the popup again.
 */
function closePanel() {
  const trigger = VIEWS[currentView]?.trigger;
  showView("reading");
  const button = trigger ? byId(trigger) : null;
  if (button) button.focus();
  else byId("readingView")?.focus?.();
}

async function openPanel(view, render) {
  showView(view);
  try {
    await render?.();
  } catch (error) {
    reportError(error, "That could not be opened.");
  }
  focusFirst(byId(VIEWS[view].panel));
}

// ─── Navigation ───────────────────────────────────────────────────────────────

async function goToPassage({ chapterIndex, verseIndex = null }) {
  showView("reading");
  await showPassage({ chapterIndex, verseIndex });
}

async function stepChapter(delta) {
  showView("reading");
  await showPassage({ chapterIndex: wrapChapter(getCurrentChapter() + delta) });
}

function goToTypedChapter() {
  const input = byId("txtChapter");
  const chapterIndex = parseChapterInput(input.value);
  if (chapterIndex === null) {
    input.setAttribute("aria-invalid", "true");
    toast(`Enter a Psalm number between 1 and ${CHAPTER_COUNT}.`, "error");
    input.select();
    return;
  }
  input.removeAttribute("aria-invalid");
  showView("reading");
  showPassage({ chapterIndex });
}

// ─── Startup passage ──────────────────────────────────────────────────────────

/**
 * What to show when the popup opens.
 *
 * The previous version opened a random chapter every time, so a reader who
 * closed the popup mid-Psalm lost their place. Resuming the most recent passage
 * makes the popup feel continuous; a first-time reader gets Today's Psalm, and
 * both random buttons are still one click away.
 */
async function resolveOpeningPassage() {
  try {
    const history = await getHistory();
    if (history.length > 0) {
      const { chapterIndex, verseIndex } = history[0];
      return { chapterIndex, verseIndex };
    }
  } catch (error) {
    console.error("Psalms Way: could not read history", error);
  }
  return { chapterIndex: getDailyChapterIndex(), verseIndex: null };
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────

function onGlobalKeyDown(event) {
  if (event.key !== "Escape") return;
  // The confirmation dialog handles its own Escape and stops propagation.
  if (currentView === "reading") return;
  event.preventDefault();
  if (currentView === "note") {
    cancelNoteEditor();
    return;
  }
  closePanel();
}

function wireLibraryTabs() {
  const tabs = Array.from(document.querySelectorAll("#libraryTabs [role='tab']"));
  for (const tab of tabs) {
    tab.addEventListener("click", () => showLibraryTab(tab.dataset.tab));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let next = null;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      else if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
      else return;
      event.preventDefault();
      next.focus();
      showLibraryTab(next.dataset.tab);
    });
  }
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function wire() {
  byId("btnVerse").addEventListener("click", () => {
    showView("reading");
    showRandomVerse();
  });
  byId("btnChapter").addEventListener("click", () => {
    showView("reading");
    showRandomChapter();
  });
  byId("btnPrev").addEventListener("click", () => stepChapter(-1));
  byId("btnNext").addEventListener("click", () => stepChapter(1));
  byId("btnGo").addEventListener("click", goToTypedChapter);
  byId("txtChapter").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToTypedChapter();
    }
  });
  byId("txtChapter").addEventListener("input", (event) => {
    event.target.removeAttribute("aria-invalid");
  });

  byId("btnToggleToolbar").addEventListener("click", async () => {
    const wrapper = byId("toolbarWrapper");
    const collapsed = !wrapper.classList.contains("is-collapsed");
    await changeSetting(
      { toolbarCollapsed: collapsed },
      { apply: () => applyToolbarCollapsed(collapsed) }
    );
  });

  byId("btnTodaysPsalm").addEventListener("click", () =>
    openToday({
      navigate: goToPassage,
      showPanel: () => openPanel("today", () => renderToday({ navigate: goToPassage })),
    })
  );
  byId("btnCloseToday").addEventListener("click", closePanel);

  // Bible version
  const openVersions = () =>
    openPanel("version", () => renderVersionPicker({ onChosen: afterVersionChosen }));
  byId("btnVersion").addEventListener("click", openVersions);
  byId("versionSetting").addEventListener("click", openVersions);
  byId("btnCloseVersion").addEventListener("click", closePanel);

  // Chapter favourite
  byId("btnFavChapter").addEventListener("click", async () => {
    try {
      await toggleFavoriteChapter(getCurrentChapter());
      refreshFavChapter(await loadStore());
    } catch (error) {
      reportError(error, "That Psalm could not be saved to Favourites.");
    }
  });

  // Compare, Prayers, Progress
  byId("btnCompare").addEventListener("click", () =>
    openPanel("compare", () =>
      renderCompare({ chapterIndex: getCurrentChapter(), verseIndex: getCurrentVerse() })
    )
  );
  byId("btnCloseCompare").addEventListener("click", closePanel);
  byId("btnPrayers").addEventListener("click", () =>
    openPanel("prayers", () => renderPrayers({ navigate: goToPassage }))
  );
  byId("btnClosePrayers").addEventListener("click", closePanel);
  byId("btnProgress").addEventListener("click", () =>
    openPanel("progress", () => renderProgress({ navigate: goToPassage }))
  );
  byId("btnCloseProgress").addEventListener("click", closePanel);

  // Search
  byId("btnSearch").addEventListener("click", () =>
    openPanel("search", () => runSearch(byId("txtSearch").value))
  );
  byId("btnCloseSearch").addEventListener("click", closePanel);
  byId("btnDoSearch").addEventListener("click", () => runSearch(byId("txtSearch").value));
  byId("txtSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch(event.target.value);
    }
  });
  byId("btnClearSearch").addEventListener("click", () => {
    const input = byId("txtSearch");
    input.value = "";
    input.focus();
    runSearch("");
  });

  // Library
  byId("btnLibrary").addEventListener("click", () => openPanel("library", renderLibrary));
  byId("btnCloseLibrary").addEventListener("click", closePanel);
  wireLibraryTabs();

  // History
  byId("btnHistory").addEventListener("click", () => openPanel("history", renderHistory));
  byId("btnCloseHistory").addEventListener("click", closePanel);
  byId("btnClearHistory").addEventListener("click", confirmClearHistory);

  // Sync with the phone app
  byId("btnCloud").addEventListener("click", () => openPanel("cloud", () => renderCloud()));
  byId("btnCloseCloud").addEventListener("click", closePanel);

  // Settings
  byId("btnSettings").addEventListener("click", () =>
    openPanel("settings", async () => paintSettingsControls(await getSettings()))
  );
  byId("btnCloseSettings").addEventListener("click", closePanel);

  for (const button of document.querySelectorAll(".theme-btn")) {
    button.addEventListener("click", () =>
      changeSetting(
        { theme: button.dataset.theme },
        { apply: () => applyTheme(button.dataset.theme) }
      )
    );
  }
  for (const button of document.querySelectorAll(".font-size-btn")) {
    button.addEventListener("click", () =>
      changeSetting(
        { fontSize: button.dataset.size },
        { apply: () => applyFontSize(button.dataset.size) }
      )
    );
  }

  // Backup
  byId("btnExport").addEventListener("click", exportBackup);
  byId("btnImport").addEventListener("click", () => byId("fileImport").click());
  byId("fileImport").addEventListener("change", async (event) => {
    const [file] = event.target.files ?? [];
    // Reset so choosing the same file twice fires another change event.
    event.target.value = "";
    const restored = await importBackup(file);
    if (restored) {
      const { chapterIndex, verseIndex } = await resolveOpeningPassage();
      await showPassage({ chapterIndex, verseIndex, record: false });
    }
  });

  document.addEventListener("keydown", onGlobalKeyDown);
}

// ─── Bible version ────────────────────────────────────────────────────────────

/** Shows the current version on the header chip and in Settings. */
async function paintVersion() {
  const module = currentVersion();
  const label = byId("btnVersionLabel");
  if (label) label.textContent = versionLabel(module);
  const entry = (await loadCatalogue()).find((v) => v.module === module);
  const setting = byId("versionSetting");
  if (setting && entry) setting.textContent = entry.name;
}

/** After the reader picks a version: repaint, and show the same passage in it. */
async function afterVersionChosen() {
  await paintVersion();
  closePanel();
  await showPassage({
    chapterIndex: getCurrentChapter(),
    verseIndex: getCurrentVerse(),
    record: false,
  });
}

// ─── Cloud sync ───────────────────────────────────────────────────────────────

/** Saved data changed outside this page (cloud sync): show the new state. */
async function refreshViews() {
  if (currentView === "reading") await refreshPassage();
  else if (currentView === "library") await renderLibrary();
  else if (currentView === "history") await renderHistory();
}

function onStorageChanged(changes, area) {
  if (area !== "local") return;
  const store = changes[STORE_KEY];
  // This page's own saves arrive here too; only someone else's change needs a redraw.
  if (store && !matchesCache(store.newValue)) {
    resetStoreCache();
    refreshViews().catch((error) => console.error("Psalms Way: could not show synced data", error));
  }
  if (changes[CLOUD_STATE_KEY]) {
    refreshCloud({ panelOpen: currentView === "cloud" }).catch((error) =>
      console.error("Psalms Way: could not show the sync state", error)
    );
  }
}

/**
 * Brings in what the phone saved since the last open. Does nothing, and sends
 * nothing anywhere, unless the reader connected a Google account.
 */
async function startCloudSync() {
  if (!globalThis.chrome?.runtime?.sendMessage) return;
  chrome.storage?.onChanged?.addListener(onStorageChanged);
  paintCloudButton(await sendCloud("status"));
  await sendCloud("autoSync");
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

export async function start() {
  setNavigator(goToPassage);
  setNoteEditorOpener(async (options) => {
    showView("note");
    await openNoteEditor(options);
    byId("noteText")?.focus();
  });
  setEditorCloser(() => {
    showView("reading");
  });
  setCompareOpener((chapterIndex, verseIndex) =>
    openPanel("compare", () => renderCompare({ chapterIndex, verseIndex }))
  );

  hydrateIcons();
  wire();

  if (!isStorageAvailable()) {
    toast("Saving is unavailable, so bookmarks and notes will not be kept.", "error");
  }

  await initAppearance();

  try {
    const settings = await getSettings();
    await initI18n(settings.uiLanguage);
    applyTranslations();
    await initVersions(settings, currentLanguage());
    await paintVersion();
  } catch (error) {
    reportError(error, t("versionPrepareError", {}, "Your Bible version could not be loaded."));
  }
  recordVisit()
    .then((newly) => {
      // A visit earns at most the next badge, unless the phone's streak just arrived.
      const badge = newly.at(-1);
      if (badge) {
        toast(
          `${t("achievementUnlocked", {}, "Achievement Unlocked!")} ${badge.icon} ${t(badge.i18nKey)}`
        );
      }
    })
    .catch((error) => console.error("Psalms Way: could not record today's visit", error));

  try {
    await getData();
  } catch (error) {
    // showPassage renders its own failure state; this just avoids a second one.
    console.error("Psalms Way:", error);
  }

  const opening = await resolveOpeningPassage();
  await showPassage({ ...opening, record: false });

  startCloudSync().catch((error) => console.error("Psalms Way: cloud sync could not start", error));
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
