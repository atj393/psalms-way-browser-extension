// ─── Constants ───────────────────────────────────────────────────────────────
const CHAPTER_RANGE = { min: 0, max: 149 };
const DATA_FILE_PATH = "psalms.json";
const STORAGE_KEY_FAVOURITES = "psalmsway_favourites";
const STORAGE_KEY_HISTORY = "psalmsway_history";
const STORAGE_KEY_SETTINGS = "psalmsway_settings";
const HISTORY_MAX = 20;
const SEARCH_MAX = 50;

// ─── State ────────────────────────────────────────────────────────────────────
let psalmsData = null;
let currentChapter = 0;
let currentVerseIndex = null; // null = chapter mode
let currentView = "main";     // "main" | "search" | "favourites" | "history" | "settings"

// ─── Data Loading ─────────────────────────────────────────────────────────────
async function getData() {
  if (psalmsData) return psalmsData;
  try {
    const response = await fetch(DATA_FILE_PATH);
    psalmsData = await response.json();
    return psalmsData;
  } catch (error) {
    console.error("Error loading psalms data:", error);
    return null;
  }
}

// ─── Storage Layer ────────────────────────────────────────────────────────────
async function loadFavourites() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_FAVOURITES);
    return result[STORAGE_KEY_FAVOURITES] || [];
  } catch { return []; }
}

async function saveFavourites(arr) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_FAVOURITES]: arr });
  } catch { /* fail silently */ }
}

async function loadHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_HISTORY);
    return result[STORAGE_KEY_HISTORY] || [];
  } catch { return []; }
}

async function saveHistory(arr) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: arr });
  } catch { /* fail silently */ }
}

async function isFavourite(chapterIndex, verseIndex) {
  const favs = await loadFavourites();
  return favs.some(f => f.chapterIndex === chapterIndex && f.verseIndex === verseIndex);
}

async function addFavourite(chapterIndex, verseIndex) {
  const favs = await loadFavourites();
  if (favs.some(f => f.chapterIndex === chapterIndex && f.verseIndex === verseIndex)) return;
  favs.push({ chapterIndex, verseIndex, addedAt: Date.now() });
  await saveFavourites(favs);
}

async function removeFavourite(chapterIndex, verseIndex) {
  const favs = await loadFavourites();
  await saveFavourites(favs.filter(f => !(f.chapterIndex === chapterIndex && f.verseIndex === verseIndex)));
}

async function addHistoryEntry(chapterIndex, verseIndex) {
  try {
    const history = await loadHistory();
    const filtered = history.filter(h => !(h.chapterIndex === chapterIndex && h.verseIndex === verseIndex));
    filtered.unshift({ chapterIndex, verseIndex, viewedAt: Date.now() });
    await saveHistory(filtered.slice(0, HISTORY_MAX));
  } catch { /* fail silently */ }
}

// ─── Settings ────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
    return result[STORAGE_KEY_SETTINGS] || { theme: "light", fontSize: "medium", lang: "en", toolbarCollapsed: false };
  } catch { return { theme: "light", fontSize: "medium", lang: "en", toolbarCollapsed: false }; }
}

async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
  } catch { /* fail silently */ }
}

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
}

function applyFontSize(size) {
  document.body.setAttribute("data-size", size);
}

function updateSettingsUI(settings) {
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === settings.theme);
  });
  document.querySelectorAll(".font-size-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.size === settings.fontSize);
  });
  const langSelect = document.getElementById("selectLang");
  if (langSelect) langSelect.value = settings.lang;
}

function applyToolbarCollapsed(collapsed) {
  const wrapper = document.getElementById("toolbarWrapper");
  const btn = document.getElementById("btnToggleToolbar");
  const icon = document.getElementById("iconToolbarToggle");
  wrapper.classList.toggle("collapsed", collapsed);
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  // Rotate chevron: down = expanded, up = collapsed
  icon.style.transform = !collapsed ? "rotate(180deg)" : "";
}

async function initSettings() {
  const settings = await loadSettings();
  applyTheme(settings.theme);
  applyFontSize(settings.fontSize);
  applyToolbarCollapsed(settings.toolbarCollapsed ?? false);
  updateSettingsUI(settings);
}

// ─── View Management ──────────────────────────────────────────────────────────
function showView(viewName) {
  currentView = viewName;
  const panels = {
    main: document.getElementById("contentElement"),
    search: document.getElementById("searchPanel"),
    favourites: document.getElementById("favPanel"),
    history: document.getElementById("historyPanel"),
    settings: document.getElementById("settingsPanel"),
  };
  Object.entries(panels).forEach(([name, el]) => {
    if (el) el.hidden = name !== viewName;
  });
  // Update aria-pressed on toolbar buttons
  const btnMap = { search: "btnSearch", favourites: "btnFavourites", history: "btnHistory", settings: "btnSettings" };
  Object.entries(btnMap).forEach(([view, id]) => {
    const btn = document.getElementById(id);
    if (btn) btn.setAttribute("aria-pressed", view === viewName ? "true" : "false");
  });
}

// ─── Daily Psalm ──────────────────────────────────────────────────────────────
function getDailyChapterIndex() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return dayOfYear % 150;
}

// ─── Copy to Clipboard ────────────────────────────────────────────────────────
function showCopyFeedback(btn) {
  btn.classList.add("copied");
  setTimeout(() => btn.classList.remove("copied"), 1500);
}

async function copyVerse(chapterIndex, verseIndex, text, btn) {
  try {
    await navigator.clipboard.writeText(`Psalms ${chapterIndex + 1}:${verseIndex + 1} — ${text}`);
    showCopyFeedback(btn);
  } catch { btn.title = "Copy failed"; }
}


// ─── Favourites State ─────────────────────────────────────────────────────────
async function applyFavouriteState(chapterIndex, verseIndex) {
  const fav = await isFavourite(chapterIndex, verseIndex);
  const btn = document.querySelector(".btn-fav");
  if (!btn) return;
  btn.classList.toggle("is-fav", fav);
  btn.title = fav ? "Remove from Favourites" : "Add to Favourites";
  // Swap to filled heart when saved — Lucide style
  const filledHeart = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const outlineHeart = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  btn.innerHTML = fav ? filledHeart : outlineHeart;
}

// ─── Search ───────────────────────────────────────────────────────────────────
async function performSearch(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "i");
  const results = [];
  const data = await getData();
  if (!data) return results;
  outer: for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < data[i].length; j++) {
      if (re.test(data[i][j])) {
        results.push({ chapterIndex: i, verseIndex: j, text: data[i][j] });
        if (results.length >= SEARCH_MAX) break outer;
      }
    }
  }
  return results;
}

function highlightKeyword(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(re);
  const frag = document.createDocumentFragment();
  parts.forEach(part => {
    if (re.test(part)) {
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = part;
      frag.appendChild(mark);
    } else {
      frag.appendChild(document.createTextNode(part));
    }
  });
  return frag;
}

function renderSearchResults(keyword, results) {
  const container = document.getElementById("searchResults");
  container.replaceChildren();
  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "No results found.";
    container.appendChild(empty);
    return;
  }
  results.forEach(({ chapterIndex, verseIndex, text }) => {
    const item = document.createElement("div");
    item.className = "panel-item";

    const ref = document.createElement("span");
    ref.className = "panel-item-ref";
    ref.textContent = `Psalms ${chapterIndex + 1}:${verseIndex + 1}`;

    const textEl = document.createElement("span");
    textEl.className = "panel-item-text";
    textEl.appendChild(highlightKeyword(text, keyword));

    item.appendChild(ref);
    item.appendChild(textEl);
    item.addEventListener("click", () => {
      updateContent(false, chapterIndex);
      showView("main");
    });
    container.appendChild(item);
  });
}

// ─── Favourites Panel ─────────────────────────────────────────────────────────
async function renderFavouritesPanel() {
  const container = document.getElementById("favList");
  container.replaceChildren();
  const favs = await loadFavourites();
  if (favs.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "No favourites saved yet. Browse a verse and tap ♡ to save it.";
    container.appendChild(empty);
    return;
  }
  const data = await getData();
  favs.forEach(({ chapterIndex, verseIndex }) => {
    const item = document.createElement("div");
    item.className = "panel-item";

    const ref = document.createElement("span");
    ref.className = "panel-item-ref";
    ref.textContent = `Psalms ${chapterIndex + 1}:${verseIndex + 1}`;

    const textEl = document.createElement("span");
    textEl.className = "panel-item-text";
    const verseText = data?.[chapterIndex]?.[verseIndex] ?? "";
    textEl.textContent = verseText.length > 80 ? verseText.slice(0, 80) + "…" : verseText;

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-close panel-item-remove";
    removeBtn.title = "Remove";
    removeBtn.setAttribute("aria-label", "Remove from favourites");
    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeFavourite(chapterIndex, verseIndex);
      renderFavouritesPanel();
    });

    item.appendChild(ref);
    item.appendChild(textEl);
    item.appendChild(removeBtn);
    item.addEventListener("click", () => {
      updateContent(true, chapterIndex, verseIndex);
      showView("main");
    });
    container.appendChild(item);
  });
}

// ─── History Panel ────────────────────────────────────────────────────────────
function formatTimestamp(ts) {
  const date = new Date(ts);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

async function renderHistoryPanel() {
  const container = document.getElementById("historyList");
  container.replaceChildren();
  const history = await loadHistory();
  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "panel-empty";
    empty.textContent = "No history yet. Start reading to track your passages.";
    container.appendChild(empty);
    return;
  }
  const data = await getData();
  history.forEach(({ chapterIndex, verseIndex, viewedAt }) => {
    const item = document.createElement("div");
    item.className = "panel-item panel-item--stacked";

    const topRow = document.createElement("div");
    topRow.className = "panel-item-top";

    const ref = document.createElement("span");
    ref.className = "panel-item-ref";
    ref.textContent = verseIndex !== null
      ? `Psalms ${chapterIndex + 1}:${verseIndex + 1}`
      : `Psalms ${chapterIndex + 1}`;

    const timeEl = document.createElement("span");
    timeEl.className = "panel-item-time";
    timeEl.textContent = formatTimestamp(viewedAt);

    topRow.appendChild(ref);
    topRow.appendChild(timeEl);

    const textEl = document.createElement("span");
    textEl.className = "panel-item-text";
    const snippet = verseIndex !== null
      ? data?.[chapterIndex]?.[verseIndex]
      : data?.[chapterIndex]?.[0];
    const preview = snippet ?? "";
    textEl.textContent = preview.length > 80 ? preview.slice(0, 80) + "…" : preview;

    item.appendChild(topRow);
    item.appendChild(textEl);
    item.addEventListener("click", () => {
      updateContent(verseIndex !== null, chapterIndex, verseIndex ?? undefined);
      showView("main");
    });
    container.appendChild(item);
  });
}

// ─── Core Content Renderer ────────────────────────────────────────────────────
function getRandomChapterIndex() {
  return Math.floor(Math.random() * (CHAPTER_RANGE.max - CHAPTER_RANGE.min + 1)) + CHAPTER_RANGE.min;
}

function getRandomVerseIndex(chapterContent) {
  return Math.floor(Math.random() * chapterContent.length);
}

async function updateContent(isVerse = false, chapterIndex = getRandomChapterIndex(), fixedVerseIndex = undefined) {
  const data = await getData();
  if (!data) return;

  currentChapter = chapterIndex;
  const chapterContent = data[chapterIndex];
  const baseTitle = `Psalms ${chapterIndex + 1}`;
  const contentDiv = document.createElement("div");

  if (isVerse) {
    const verseIndex = fixedVerseIndex !== undefined ? fixedVerseIndex : getRandomVerseIndex(chapterContent);
    currentVerseIndex = verseIndex;

    const verseWrapper = document.createElement("div");
    verseWrapper.className = "verse-wrapper";

    const verse = document.createElement("p");
    verse.textContent = chapterContent[verseIndex];

    const verseActions = document.createElement("div");
    verseActions.className = "verse-actions";

    const favBtn = document.createElement("button");
    favBtn.className = "btn-action btn-fav";
    favBtn.title = "Add to Favourites";
    favBtn.setAttribute("aria-label", "Save verse");
    // Heart outline — Lucide style
    favBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    favBtn.addEventListener("click", async () => {
      if (await isFavourite(chapterIndex, verseIndex)) {
        await removeFavourite(chapterIndex, verseIndex);
      } else {
        await addFavourite(chapterIndex, verseIndex);
      }
      applyFavouriteState(chapterIndex, verseIndex);
    });

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-action btn-copy";
    copyBtn.title = "Copy verse";
    copyBtn.setAttribute("aria-label", "Copy verse");
    // Copy — Lucide style
    copyBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener("click", () => copyVerse(chapterIndex, verseIndex, chapterContent[verseIndex], copyBtn));

    const chapterBtn = document.createElement("button");
    chapterBtn.className = "btn-action btn-go-chapter";
    chapterBtn.title = "Read full chapter";
    chapterBtn.setAttribute("aria-label", "Read full chapter");
    chapterBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';
    chapterBtn.addEventListener("click", () => {
      showView("main");
      updateContent(false, chapterIndex);
    });

    verseActions.appendChild(favBtn);
    verseActions.appendChild(copyBtn);
    verseActions.appendChild(chapterBtn);
    verseWrapper.appendChild(verse);
    verseWrapper.appendChild(verseActions);
    contentDiv.appendChild(verseWrapper);

    document.getElementById("chapterTitle").textContent = `${baseTitle}:${verseIndex + 1}`;
    applyFavouriteState(chapterIndex, verseIndex);
  } else {
    currentVerseIndex = null;

    const ul = document.createElement("ul");
    chapterContent.forEach((verseText, vIdx) => {
      const li = document.createElement("li");
      li.className = "chapter-verse";
      li.textContent = verseText;

      li.addEventListener("click", async () => {
        // Dismiss any previously open inline actions
        ul.querySelectorAll(".verse-inline-actions").forEach(el => el.remove());
        ul.querySelectorAll(".chapter-verse.selected").forEach(el => el.classList.remove("selected"));

        // If clicking the already-selected verse, just deselect
        if (li.dataset.selected === "true") {
          li.dataset.selected = "false";
          return;
        }
        li.dataset.selected = "true";
        li.classList.add("selected");

        const actions = document.createElement("div");
        actions.className = "verse-inline-actions";

        const favBtn = document.createElement("button");
        favBtn.className = "btn-action btn-fav";
        favBtn.setAttribute("aria-label", "Save verse");
        const isFav = await isFavourite(chapterIndex, vIdx);
        favBtn.classList.toggle("is-fav", isFav);
        favBtn.title = isFav ? "Remove from Favourites" : "Add to Favourites";
        favBtn.innerHTML = isFav
          ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
          : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
        favBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          if (await isFavourite(chapterIndex, vIdx)) {
            await removeFavourite(chapterIndex, vIdx);
            favBtn.classList.remove("is-fav");
            favBtn.title = "Add to Favourites";
            favBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
          } else {
            await addFavourite(chapterIndex, vIdx);
            favBtn.classList.add("is-fav");
            favBtn.title = "Remove from Favourites";
            favBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
          }
        });

        const copyBtn = document.createElement("button");
        copyBtn.className = "btn-action btn-copy";
        copyBtn.title = "Copy verse";
        copyBtn.setAttribute("aria-label", "Copy verse");
        copyBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        copyBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          copyVerse(chapterIndex, vIdx, verseText, copyBtn);
        });

        actions.appendChild(favBtn);
        actions.appendChild(copyBtn);
        li.appendChild(actions);
      });

      ul.appendChild(li);
    });

    contentDiv.appendChild(ul);
    document.getElementById("chapterTitle").textContent = baseTitle;
  }

  document.getElementById("txtChapter").value = "";
  document.getElementById("contentElement").replaceChildren(contentDiv);

  // Fire-and-forget history tracking
  addHistoryEntry(chapterIndex, isVerse ? currentVerseIndex : null).catch(() => {});
}

// ─── Chapter Navigation ───────────────────────────────────────────────────────
function goToChapter() {
  const chapterNum = parseInt(document.getElementById("txtChapter").value, 10) - 1;
  if (!isNaN(chapterNum) && chapterNum >= CHAPTER_RANGE.min && chapterNum <= CHAPTER_RANGE.max) {
    showView("main");
    updateContent(false, chapterNum);
  } else {
    alert("Please enter a valid chapter number between 1 and 150.");
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function initializeEventListeners() {
  // Existing navigation
  document.getElementById("btnChapter").addEventListener("click", () => {
    showView("main");
    updateContent();
  });
  document.getElementById("btnVerse").addEventListener("click", () => {
    showView("main");
    updateContent(true);
  });
  document.getElementById("btnPrev").addEventListener("click", () => {
    showView("main");
    currentChapter = currentChapter === CHAPTER_RANGE.min ? CHAPTER_RANGE.max : currentChapter - 1;
    updateContent(false, currentChapter);
  });
  document.getElementById("btnNext").addEventListener("click", () => {
    showView("main");
    currentChapter = currentChapter === CHAPTER_RANGE.max ? CHAPTER_RANGE.min : currentChapter + 1;
    updateContent(false, currentChapter);
  });
  document.getElementById("btnGo").addEventListener("click", goToChapter);
  document.getElementById("txtChapter").addEventListener("keydown", (e) => {
    if (e.key === "Enter") goToChapter();
  });

  // Toolbar collapse toggle
  document.getElementById("btnToggleToolbar").addEventListener("click", async () => {
    const settings = await loadSettings();
    const collapsed = !(settings.toolbarCollapsed ?? false);
    applyToolbarCollapsed(collapsed);
    await saveSettings({ ...settings, toolbarCollapsed: collapsed });
  });

  // Toolbar — Today's Psalm
  document.getElementById("btnTodaysPsalm").addEventListener("click", () => {
    showView("main");
    updateContent(false, getDailyChapterIndex());
  });

  // Toolbar — Search
  document.getElementById("btnSearch").addEventListener("click", () => {
    showView("search");
    document.getElementById("txtSearch").focus();
  });
  document.getElementById("btnDoSearch").addEventListener("click", async () => {
    const kw = document.getElementById("txtSearch").value.trim();
    if (kw.length < 2) {
      const container = document.getElementById("searchResults");
      container.replaceChildren();
      const hint = document.createElement("p");
      hint.className = "panel-empty";
      hint.textContent = "Enter at least 2 characters to search.";
      container.appendChild(hint);
      return;
    }
    const results = await performSearch(kw);
    renderSearchResults(kw, results);
  });
  document.getElementById("txtSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btnDoSearch").click();
  });
  document.getElementById("btnCloseSearch").addEventListener("click", () => showView("main"));

  // Toolbar — Favourites
  document.getElementById("btnFavourites").addEventListener("click", async () => {
    await renderFavouritesPanel();
    showView("favourites");
  });
  document.getElementById("btnCloseFav").addEventListener("click", () => showView("main"));

  // Toolbar — History
  document.getElementById("btnHistory").addEventListener("click", async () => {
    await renderHistoryPanel();
    showView("history");
  });
  document.getElementById("btnCloseHistory").addEventListener("click", () => showView("main"));
  document.getElementById("btnClearHistory").addEventListener("click", async () => {
    if (!confirm("Clear all reading history?")) return;
    await saveHistory([]);
    renderHistoryPanel();
  });

  // Toolbar — Settings
  document.getElementById("btnSettings").addEventListener("click", async () => {
    const settings = await loadSettings();
    updateSettingsUI(settings);
    showView("settings");
  });
  document.getElementById("btnCloseSettings").addEventListener("click", () => showView("main"));

  // Theme buttons
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
      document.querySelectorAll(".theme-btn").forEach(b => b.classList.toggle("active", b === btn));
      const settings = await loadSettings();
      await saveSettings({ ...settings, theme });
    });
  });

  // Font size buttons
  document.querySelectorAll(".font-size-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const size = btn.dataset.size;
      applyFontSize(size);
      document.querySelectorAll(".font-size-btn").forEach(b => b.classList.toggle("active", b === btn));
      const settings = await loadSettings();
      await saveSettings({ ...settings, fontSize: size });
    });
  });

  // Language select
  document.getElementById("selectLang").addEventListener("change", async (e) => {
    const settings = await loadSettings();
    await saveSettings({ ...settings, lang: e.target.value });
  });
}

// ─── Initialisation ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  currentChapter = getRandomChapterIndex();
  initSettings();
  updateContent(false, currentChapter);
  initializeEventListeners();
});
