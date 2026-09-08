#!/usr/bin/env node
/**
 * Browser smoke test.
 *
 * Loads the real extension into Chrome and drives the real popup over the
 * DevTools Protocol. This is deliberately not a jsdom test: it is the only
 * check that exercises chrome.storage, the extension origin, module loading
 * and the Manifest V3 content security policy together.
 *
 *   node scripts/smoke-test.js [--headful] [--keep-open]
 *
 * Exits non-zero on the first failed assertion, and always fails if the popup
 * logged an uncaught error or made a network request.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Defaults to the repository root. Point it at an unpacked dist/ build to
// prove the packaged files are the ones that work.
const EXTENSION_PATH = (
  process.env.PSALMS_EXTENSION_PATH ?? fileURLToPath(new URL("../", import.meta.url))
).replace(/[/\\]$/, "");
const HEADFUL = process.argv.includes("--headful");
const KEEP_OPEN = process.argv.includes("--keep-open");
const PORT = 9222 + Math.floor(Math.random() * 700);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ─── Minimal CDP client ───────────────────────────────────────────────────────

class CDP {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`could not connect to ${this.url}`));
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
        return;
      }
      for (const handler of this.listeners.get(message.method) ?? []) handler(message.params);
    };
    return this;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  close() {
    this.ws?.close();
  }
}

// ─── Assertions ───────────────────────────────────────────────────────────────

const results = [];
let failed = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failed++;
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

function section(title) {
  console.log(`\n${title}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Main ─────────────────────────────────────────────────────────────────────

const chromePath = findChrome();
if (!chromePath) {
  console.error("Chrome was not found. Set CHROME_PATH to run the browser smoke test.");
  console.error("Tried:\n  " + CHROME_CANDIDATES.join("\n  "));
  process.exit(2);
}

const profileDir = mkdtempSync(join(tmpdir(), "psalms-smoke-"));
const args = [
  HEADFUL ? "--no-sandbox" : "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${PORT}`,
  "about:blank",
];

console.log(`Chrome      ${chromePath}`);
console.log(`Extension   ${EXTENSION_PATH}`);
console.log(`Mode        ${HEADFUL ? "headful" : "headless"}`);

const chrome = spawn(chromePath, args, { stdio: "ignore" });
let browser;
let page;

function cleanup() {
  browser?.close();
  page?.close();
  if (!KEEP_OPEN) {
    chrome.kill();
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* the profile is in the OS temp directory; leaving it is harmless */
    }
  }
}

process.on("exit", cleanup);

try {
  // Wait for the DevTools endpoint.
  let version = null;
  for (let attempt = 0; attempt < 60 && !version; attempt++) {
    await sleep(250);
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      /* not up yet */
    }
  }
  if (!version) throw new Error("Chrome did not expose a DevTools endpoint");
  console.log(`Browser     ${version.Browser}\n`);

  browser = await new CDP(version.webSocketDebuggerUrl).connect();

  section("Loading the extension");
  const { id: extensionId } = await browser.send("Extensions.loadUnpacked", {
    path: EXTENSION_PATH,
  });
  check("extension loads unpacked with no manifest error", Boolean(extensionId), extensionId);
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;

  // Open the popup as a page.
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((t) => t.id === targetId);
  page = await new CDP(target.webSocketDebuggerUrl).connect();

  const consoleErrors = [];
  const networkRequests = [];
  page.on("Runtime.exceptionThrown", (params) => {
    consoleErrors.push(params.exceptionDetails?.exception?.description ?? "uncaught exception");
  });
  page.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") {
      consoleErrors.push(params.args.map((a) => a.value ?? a.description ?? "?").join(" "));
    }
  });
  page.on("Network.requestWillBeSent", (params) => {
    // Extension-origin loads are the bundled files; anything else is a real
    // network request and the privacy claim depends on there being none.
    if (!params.request.url.startsWith("chrome-extension://")) {
      networkRequests.push(params.request.url);
    }
  });

  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Network.enable");

  const evaluate = async (expression) => {
    const result = await page.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `${result.exceptionDetails.text}: ${result.exceptionDetails.exception?.description ?? ""}`
      );
    }
    return result.result.value;
  };

  /**
   * Poll until an expression is truthy.
   *
   * Fixed sleeps made this suite flaky: a cold profile occasionally needed
   * longer than the allowance to fetch 224 KB of JSON and paint, so the
   * startup assertions could run against a half-built page.
   */
  const waitFor = async (expression, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        // The page can be mid-navigation; try again.
      }
      await sleep(50);
    }
    return false;
  };

  const reload = async () => {
    await page.send("Page.navigate", { url: popupUrl });
    // Wait for the first render to finish rather than guessing at a duration.
    await waitFor("!!document.querySelector('.verse, .single-verse, .panel-empty')");
  };

  // ── Startup ──────────────────────────────────────────────────────────────
  section("Startup");
  await reload();
  check(
    "popup document loads at the extension origin",
    (await evaluate("location.href")) === popupUrl
  );
  check(
    "reading view rendered verses",
    (await evaluate("document.querySelectorAll('.verse').length")) > 0,
    `verses: ${await evaluate("document.querySelectorAll('.verse').length")}`
  );
  check(
    "chapter title is populated",
    /^Psalm \d+/.test(await evaluate("document.getElementById('chapterTitle').textContent"))
  );
  check(
    "reference uses the singular 'Psalm'",
    !(await evaluate("document.getElementById('chapterTitle').textContent")).startsWith("Psalms ")
  );
  check(
    "icons hydrated from icons.js",
    (await evaluate("document.querySelectorAll('svg').length")) > 5
  );
  check(
    "no element still carries a data-icon placeholder",
    (await evaluate("document.querySelectorAll('[data-icon]').length")) === 0
  );

  // ── Today's Psalm ────────────────────────────────────────────────────────
  section("Today's Psalm");
  await evaluate("document.getElementById('btnTodaysPsalm').click()");
  await sleep(300);
  const todayTitle = await evaluate("document.getElementById('chapterTitle').textContent");
  const expectedToday = await evaluate(`(() => {
    const now = new Date();
    const start = Date.UTC(now.getFullYear(), 0, 1);
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const day = Math.round((today - start) / 86400000) + 1;
    return 'Psalm ' + (((day - 1) % 150) + 1);
  })()`);
  check(
    "Today's Psalm matches the date",
    todayTitle === expectedToday,
    `${todayTitle} vs ${expectedToday}`
  );

  // ── Navigation ───────────────────────────────────────────────────────────
  section("Chapter navigation");
  await evaluate(
    "document.getElementById('txtChapter').value = '1'; document.getElementById('btnGo').click()"
  );
  await sleep(250);
  check(
    "Psalm 1 reachable",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 1"
  );

  await evaluate("document.getElementById('btnPrev').click()");
  await sleep(250);
  check(
    "previous from Psalm 1 wraps to Psalm 150",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 150"
  );
  check(
    "Psalm 150 renders its 6 verses",
    (await evaluate("document.querySelectorAll('.verse').length")) === 6
  );

  await evaluate("document.getElementById('btnNext').click()");
  await sleep(250);
  check(
    "next from Psalm 150 wraps to Psalm 1",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 1"
  );

  await evaluate(
    "document.getElementById('txtChapter').value = '119'; document.getElementById('btnGo').click()"
  );
  await sleep(400);
  check(
    "Psalm 119 renders all 176 verses",
    (await evaluate("document.querySelectorAll('.verse').length")) === 176
  );

  await evaluate(
    "document.getElementById('txtChapter').value = '999'; document.getElementById('btnGo').click()"
  );
  await sleep(250);
  check(
    "an out-of-range chapter is refused without navigating",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 119"
  );
  check(
    "the invalid input is marked for assistive technology",
    (await evaluate("document.getElementById('txtChapter').getAttribute('aria-invalid')")) ===
      "true"
  );

  // ── Random ───────────────────────────────────────────────────────────────
  section("Random passages");
  await evaluate("document.getElementById('btnChapter').click()");
  await sleep(300);
  check(
    "random chapter renders",
    (await evaluate("document.querySelectorAll('.verse').length")) > 0
  );
  await evaluate("document.getElementById('btnVerse').click()");
  await sleep(300);
  check(
    "random verse renders a single verse",
    (await evaluate("document.querySelectorAll('.single-verse-text').length")) === 1
  );
  check(
    "single verse shows a chapter:verse reference",
    /^Psalm \d+:\d+$/.test(await evaluate("document.getElementById('chapterTitle').textContent"))
  );

  // ── Favourites ───────────────────────────────────────────────────────────
  section("Favourites");
  await evaluate(
    "document.getElementById('txtChapter').value = '23'; document.getElementById('btnGo').click()"
  );
  await sleep(300);
  await evaluate("document.querySelectorAll('.verse .verse-body')[0].click()");
  await sleep(250);
  check(
    "selecting a verse reveals its actions",
    (await evaluate("document.querySelectorAll('.verse-actions').length")) === 1
  );
  check(
    "the selected verse is marked expanded",
    (await evaluate(
      "document.querySelector('.verse.is-selected .verse-body').getAttribute('aria-expanded')"
    )) === "true"
  );
  await evaluate("document.querySelector('.verse-actions .btn-fav').click()");
  await sleep(400);
  check(
    "saving marks the button pressed",
    (await evaluate(
      "document.querySelector('.verse-actions .btn-fav').getAttribute('aria-pressed')"
    )) === "true"
  );
  const storedFav = await evaluate(
    "chrome.storage.local.get('psalmsway').then(r => JSON.stringify(r.psalmsway.favourites))"
  );
  check(
    "the favourite reached chrome.storage.local",
    storedFav.includes('"chapterIndex":22') && storedFav.includes('"verseIndex":0'),
    storedFav
  );

  await reload();
  check(
    "the favourite survives closing and reopening the popup",
    (await evaluate(
      "chrome.storage.local.get('psalmsway').then(r => r.psalmsway.favourites.length)"
    )) === 1
  );

  // ── Notes ────────────────────────────────────────────────────────────────
  section("Notes");
  await evaluate(
    "document.getElementById('txtChapter').value = '23'; document.getElementById('btnGo').click()"
  );
  await sleep(300);
  await evaluate("document.querySelectorAll('.verse .verse-body')[0].click()");
  await sleep(250);
  await evaluate("document.querySelector('.verse-actions .btn-note').click()");
  await sleep(300);
  check("the note editor opens", await evaluate("!document.getElementById('notePanel').hidden"));
  check(
    "focus moves into the note textarea",
    (await evaluate("document.activeElement.id")) === "noteText"
  );
  check(
    "the editor quotes the verse being annotated",
    (await evaluate("document.getElementById('noteVerse').textContent")).includes("shepherd")
  );
  await evaluate(
    "document.getElementById('noteText').value = 'Read this on a hard morning.'; document.getElementById('btnSaveNote').click()"
  );
  await sleep(400);
  const storedNote = await evaluate(
    "chrome.storage.local.get('psalmsway').then(r => JSON.stringify(r.psalmsway.notes))"
  );
  check("the note is stored", storedNote.includes("hard morning"), storedNote.slice(0, 160));
  check(
    "the verse now shows a note marker",
    (await evaluate("document.querySelectorAll('.verse-marker-note').length")) >= 1
  );

  // Script-like note text must stay inert.
  await evaluate(`(async () => {
    const raw = await chrome.storage.local.get('psalmsway');
    raw.psalmsway.notes[0].text = '<img src=x onerror="window.__pwned=1">';
    await chrome.storage.local.set(raw);
  })()`);
  await reload();
  await evaluate(
    "document.getElementById('txtChapter').value = '23'; document.getElementById('btnGo').click()"
  );
  await sleep(300);
  await evaluate("document.getElementById('btnLibrary').click()");
  await sleep(300);
  await evaluate("document.querySelector('#libraryTabs [data-tab=notes]').click()");
  await sleep(300);
  check(
    "note markup is rendered as text, not parsed as HTML",
    (await evaluate("window.__pwned === undefined")) &&
      (await evaluate("document.querySelectorAll('#libraryBody img').length")) === 0
  );
  check(
    "the note text is shown verbatim",
    (await evaluate("document.querySelector('.row-note').textContent")).includes("<img")
  );

  // ── Library ──────────────────────────────────────────────────────────────
  section("Library");
  await evaluate("document.querySelector('#libraryTabs [data-tab=favourites]').click()");
  await sleep(300);
  check(
    "the Favourites tab lists the saved verse",
    (await evaluate("document.querySelectorAll('#libraryBody .row').length")) === 1
  );
  check(
    "the selected tab is announced",
    (await evaluate(
      "document.querySelector('#libraryTabs [data-tab=favourites]').getAttribute('aria-selected')"
    )) === "true"
  );
  await evaluate("document.querySelector('#libraryBody .row-body').click()");
  await sleep(350);
  check(
    "opening a favourite navigates to that exact verse",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 23:1"
  );

  // ── Search ───────────────────────────────────────────────────────────────
  section("Search");
  await evaluate("document.getElementById('btnSearch').click()");
  await sleep(300);
  check(
    "focus moves into the search field",
    (await evaluate("document.activeElement.id")) === "txtSearch"
  );
  await evaluate(
    "document.getElementById('txtSearch').value = 'shepherd'; document.getElementById('btnDoSearch').click()"
  );
  await sleep(400);
  const matchCount = await evaluate("document.querySelectorAll('#searchResults .row').length");
  check("search returns results", matchCount > 0, `${matchCount} rows`);
  check(
    "matches are highlighted",
    (await evaluate("document.querySelectorAll('#searchResults .row-match').length")) > 0
  );
  check(
    "the match count is reported",
    /\d/.test(await evaluate("document.getElementById('searchCount').textContent"))
  );

  for (const hostile of [".*", "[a-z]", "(((", "\\", "$^"]) {
    await evaluate(
      `document.getElementById('txtSearch').value = ${JSON.stringify(
        hostile
      )}; document.getElementById('btnDoSearch').click()`
    );
    await sleep(200);
    check(
      `regex metacharacter query ${JSON.stringify(hostile)} does not break search`,
      (await evaluate("document.getElementById('searchPanel').hidden")) === false
    );
  }

  await evaluate(
    "document.getElementById('txtSearch').value = 'the'; document.getElementById('btnDoSearch').click()"
  );
  await sleep(400);
  check(
    "a truncated result set says so",
    (await evaluate("document.getElementById('searchCount').textContent")).includes("of")
  );

  await evaluate(
    "document.getElementById('txtSearch').value = 'shepherd'; document.getElementById('btnDoSearch').click()"
  );
  await sleep(300);
  await evaluate("document.querySelector('#searchResults .row-body').click()");
  await sleep(350);
  check(
    "a search result opens the exact verse that matched",
    /^Psalm \d+:\d+$/.test(await evaluate("document.getElementById('chapterTitle').textContent"))
  );

  // ── Keyboard ─────────────────────────────────────────────────────────────
  section("Keyboard and focus");
  await evaluate("document.getElementById('btnHistory').click()");
  await sleep(300);
  check("history panel opens", await evaluate("!document.getElementById('historyPanel').hidden"));
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await sleep(300);
  check(
    "Escape closes the panel",
    await evaluate("document.getElementById('historyPanel').hidden")
  );
  check(
    "focus returns to the button that opened it",
    (await evaluate("document.activeElement.id")) === "btnHistory"
  );

  await evaluate(
    "document.getElementById('txtChapter').value = '3'; document.getElementById('btnGo').click()"
  );
  await sleep(300);
  check(
    "only the first verse is in the tab order",
    (await evaluate("document.querySelectorAll('.verse[tabindex=\"0\"]').length")) === 1
  );
  await evaluate("document.querySelector('.verse').focus()");
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowDown",
    code: "ArrowDown",
    windowsVirtualKeyCode: 40,
  });
  await sleep(200);
  check(
    "ArrowDown moves between verses",
    await evaluate(
      "document.activeElement.classList.contains('verse') && document.activeElement === document.querySelectorAll('.verse')[1]"
    )
  );

  // ── History ──────────────────────────────────────────────────────────────
  section("History");
  await evaluate("document.getElementById('btnHistory').click()");
  await sleep(350);
  const historyRows = await evaluate("document.querySelectorAll('#historyBody .row').length");
  check("history records what was read", historyRows > 0, `${historyRows} rows`);
  await evaluate("document.getElementById('btnClearHistory').click()");
  await sleep(300);
  check(
    "clearing history asks first",
    await evaluate("!document.getElementById('dialogHost').hidden")
  );
  check(
    "the dialog focuses its confirm button",
    (await evaluate("document.activeElement.textContent")) === "Clear history"
  );
  check(
    "the dialog sees both of its buttons as focusable",
    (await evaluate(
      "(async () => { const m = await import('./src/dom.js'); return m.focusableWithin(document.querySelector('.dialog')).length; })()"
    )) === 2,
    "a collapsed list here means the focus trap is not trapping"
  );
  await evaluate("document.querySelector('.dialog-actions .button-danger').click()");
  await sleep(350);
  check(
    "history is empty after confirming",
    (await evaluate("document.querySelectorAll('#historyBody .row').length")) === 0
  );
  check(
    "favourites are untouched by clearing history",
    (await evaluate(
      "chrome.storage.local.get('psalmsway').then(r => r.psalmsway.favourites.length)"
    )) === 1
  );

  // ── Settings ─────────────────────────────────────────────────────────────
  section("Settings");
  await evaluate("document.getElementById('btnSettings').click()");
  await sleep(300);
  for (const theme of ["dark", "sepia", "light"]) {
    await evaluate(`document.querySelector('.theme-btn[data-theme="${theme}"]').click()`);
    await sleep(250);
    check(
      `${theme} theme applies`,
      (await evaluate("document.documentElement.getAttribute('data-theme')")) === theme
    );
  }
  await evaluate("document.querySelector('.theme-btn[data-theme=\"dark\"]').click()");
  await sleep(250);
  await evaluate("document.querySelector('.font-size-btn[data-size=\"large\"]').click()");
  await sleep(300);
  await reload();
  check(
    "theme persists across reopening",
    (await evaluate("document.documentElement.getAttribute('data-theme')")) === "dark"
  );
  check(
    "text size persists across reopening",
    (await evaluate("document.documentElement.getAttribute('data-size')")) === "large"
  );

  await evaluate("document.getElementById('btnToggleToolbar').click()");
  await sleep(300);
  check("toolbar collapses", await evaluate("document.getElementById('toolbarWrapper').hidden"));
  await reload();
  check(
    "toolbar stays collapsed after reopening",
    await evaluate("document.getElementById('toolbarWrapper').hidden")
  );
  await evaluate("document.getElementById('btnToggleToolbar').click()");
  await sleep(250);

  // ── Layout ───────────────────────────────────────────────────────────────
  section("Layout");
  await evaluate(
    "document.getElementById('txtChapter').value = '119'; document.getElementById('btnGo').click()"
  );
  await sleep(400);
  check(
    "the popup never scrolls horizontally",
    await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
  );
  check(
    "a long chapter scrolls inside the reading pane, not the page",
    await evaluate(
      "document.getElementById('readingView').scrollHeight > document.getElementById('readingView').clientHeight"
    )
  );

  // ── Corrupt storage ──────────────────────────────────────────────────────
  section("Damaged storage");
  await evaluate("chrome.storage.local.set({ psalmsway: 'this is not an object' })");
  await reload();
  check(
    "the popup still renders when the store is nonsense",
    (await evaluate("document.querySelectorAll('.verse').length")) > 0
  );

  await evaluate(`chrome.storage.local.set({ psalmsway: {
    schemaVersion: 2,
    favourites: [{ chapterIndex: 9999, verseIndex: 0 }, { chapterIndex: 22, verseIndex: 0, addedAt: 1 }],
    notes: [{ chapterIndex: 1, verseIndex: 99999, text: 'orphan' }],
    history: [null, 'rubbish'],
    settings: { theme: 'neon' }
  } })`);
  await reload();
  await evaluate("document.getElementById('btnLibrary').click()");
  await sleep(400);
  check(
    "out-of-range favourites are dropped and the valid one kept",
    (await evaluate("document.querySelectorAll('#libraryBody .row').length")) === 1
  );
  check(
    "an invalid theme falls back to light",
    (await evaluate("document.documentElement.getAttribute('data-theme')")) === "light"
  );

  // ── Migration from 1.1 ───────────────────────────────────────────────────
  section("Migration from version 1.1");
  await evaluate(`(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      psalmsway_favourites: [
        { chapterIndex: 22, verseIndex: 0, addedAt: 1730000000000 },
        { chapterIndex: 90, verseIndex: 3, addedAt: 1730000100000 }
      ],
      psalmsway_history: [{ chapterIndex: 45, verseIndex: null, viewedAt: 1730000200000 }],
      psalmsway_settings: { theme: 'dark', fontSize: 'large', lang: 'en', toolbarCollapsed: false }
    });
  })()`);
  await reload();
  const migrated = await evaluate(
    "chrome.storage.local.get('psalmsway').then(r => JSON.stringify({f: r.psalmsway.favourites.length, h: r.psalmsway.history.length, t: r.psalmsway.settings.theme, s: r.psalmsway.settings.fontSize}))"
  );
  check(
    "1.1 favourites, history and settings migrate",
    migrated === '{"f":2,"h":1,"t":"dark","s":"large"}',
    migrated
  );
  check(
    "the migrated theme is actually applied",
    (await evaluate("document.documentElement.getAttribute('data-theme')")) === "dark"
  );
  const legacyIntact = await evaluate(
    "chrome.storage.local.get('psalmsway_favourites').then(r => r.psalmsway_favourites?.length ?? 0)"
  );
  check(
    "the 1.1 keys are left in place for a rollback",
    legacyIntact === 2,
    `legacy length ${legacyIntact}`
  );

  // ── Backup round trip ────────────────────────────────────────────────────
  section("Backup");
  const roundTrip = await evaluate(`(async () => {
    const backup = await import('./src/backup.js');
    const storage = await import('./src/storage.js');
    storage.resetStoreCache();
    const store = await storage.loadStore();
    const doc = backup.createBackup(store, '1.2');
    const parsed = backup.parseBackup(JSON.stringify(doc));
    let rejected = 0;
    for (const bad of ['', 'not json', '{}', JSON.stringify({type:'other',schemaVersion:1,data:{}})]) {
      try { backup.parseBackup(bad); } catch { rejected++; }
    }
    return JSON.stringify({ favourites: parsed.counts.favourites, rejected });
  })()`);
  check(
    "a backup round-trips and bad files are rejected",
    roundTrip === '{"favourites":2,"rejected":4}',
    roundTrip
  );

  // ── Console and network ──────────────────────────────────────────────────
  section("Console and network");
  check(
    "the popup logged no errors",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 5).join("\n        ")
  );
  check(
    "the popup made no network request",
    networkRequests.length === 0,
    networkRequests.slice(0, 5).join("\n        ")
  );
} catch (error) {
  console.error(`\nsmoke test aborted: ${error.message}`);
  console.error(error.stack);
  failed++;
} finally {
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Browser smoke test: ${passed}/${total} checks passed`);
  if (failed > 0) {
    console.log("\nFailed:");
    for (const result of results.filter((r) => !r.ok)) console.log(`  - ${result.name}`);
  }
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}
