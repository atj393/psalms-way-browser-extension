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
  check(
    "the toolbar has six buttons: Today, Library, History, Compare, Prayers, Progress",
    (await evaluate(
      "[...document.querySelectorAll('.toolbar .btn-tool')].map((b) => b.id).join()"
    )) === "btnTodaysPsalm,btnLibrary,btnHistory,btnCompare,btnPrayers,btnProgress"
  );
  check(
    "Settings is a gear button at the end of the header, after New Chapter",
    await evaluate(`(() => {
      const settings = document.getElementById('btnSettings');
      return settings?.parentElement?.classList.contains('header-actions') &&
        settings.previousElementSibling?.id === 'btnChapter' &&
        settings.nextElementSibling === null &&
        settings.getAttribute('aria-label').length > 0;
    })()`)
  );
  check(
    "Search is an icon button in the chapter bar, just before the Psalm number, not in the toolbar",
    await evaluate(`(() => {
      const search = document.getElementById('btnSearch');
      const number = document.getElementById('txtChapter');
      return Boolean(search.closest('.chapter-bar')) && !search.closest('.toolbar') &&
        Boolean(search.querySelector('svg')) &&
        Boolean(search.compareDocumentPosition(number) & Node.DOCUMENT_POSITION_FOLLOWING);
    })()`)
  );
  check(
    "Go is an arrow button named Go",
    await evaluate(`(() => {
      const go = document.getElementById('btnGo');
      return Boolean(go.querySelector('svg')) && go.getAttribute('aria-label') === 'Go' && go.title === 'Go';
    })()`)
  );
  check(
    "the header runs Sync, the version chip, One Verse, New Chapter",
    await evaluate(`(() => {
      const ids = ['btnCloud', 'btnVersion', 'btnVerse', 'btnChapter'];
      const nodes = ids.map((id) => document.getElementById(id));
      return nodes.every((node, i) => i === 0 ||
        Boolean(nodes[i - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
    })()`)
  );

  // ── Today ────────────────────────────────────────────────────────────────
  section("Today");
  const expectedToday = await evaluate(`(() => {
    const now = new Date();
    const start = Date.UTC(now.getFullYear(), 0, 1);
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const day = Math.round((today - start) / 86400000) + 1;
    return 'Psalm ' + (((day - 1) % 150) + 1);
  })()`);
  // Read some other Psalm first, so that arriving at today's proves the button did it.
  await evaluate(
    `document.getElementById('txtChapter').value = '${expectedToday === "Psalm 1" ? 2 : 1}'; document.getElementById('btnGo').click()`
  );
  await sleep(300);
  // Opening the popup counts today's visit in the background; Today shows that count.
  await waitFor(
    "chrome.storage.local.get('psalmsway').then((r) => r.psalmsway?.carry?.streak?.count === 1)"
  );
  await evaluate("document.getElementById('btnTodaysPsalm').click()");
  await waitFor("!!document.querySelector('#todayBody .today-verse')");
  check("the Today panel opens", await evaluate("!document.getElementById('todayPanel').hidden"));
  const verseOfTheDay = await evaluate(
    "document.querySelector('#todayBody .today-reference')?.textContent ?? ''"
  );
  check(
    "Today shows a verse of the day with its reference",
    /^Psalm \d+:\d+$/.test(verseOfTheDay) &&
      (await evaluate("document.querySelector('#todayBody .today-verse').textContent.length")) > 10,
    verseOfTheDay
  );
  check(
    "Today names Today's Psalm by the date",
    (await evaluate("document.querySelector('#todayBody .today-psalm-title')?.textContent")) ===
      expectedToday
  );
  check(
    "Today shows the reading streak after the first open",
    (await evaluate("document.querySelector('#todayBody .today-streak')?.textContent")) ===
      "1-day streak"
  );
  await evaluate("document.querySelector('#todayBody .today-psalm .button').click()");
  await sleep(300);
  const todayTitle = await evaluate("document.getElementById('chapterTitle').textContent");
  check(
    "Today's Psalm matches the date",
    todayTitle === expectedToday,
    `${todayTitle} vs ${expectedToday}`
  );
  check(
    "opening a Psalm closes Today",
    await evaluate("document.getElementById('todayPanel').hidden")
  );
  await evaluate("document.getElementById('btnTodaysPsalm').click()");
  await waitFor("!!document.querySelector('#todayBody .today-verse')");
  await evaluate("document.querySelector('#todayBody .today-verse + .button-row .button').click()");
  await sleep(300);
  check(
    "Open takes the reader to the verse of the day",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === verseOfTheDay,
    verseOfTheDay
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
    "the chapter bar's Search button opens the Search panel and shows as pressed",
    (await evaluate("document.getElementById('searchPanel').hidden")) === false &&
      (await evaluate("document.getElementById('btnSearch').getAttribute('aria-pressed')")) ===
        "true"
  );
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

  const toggleIsUp =
    "document.getElementById('btnToggleToolbar').classList.contains('is-collapsed')";
  check("the toolbar's chevron points down while it is open", !(await evaluate(toggleIsUp)));
  await evaluate("document.getElementById('btnToggleToolbar').click()");
  await sleep(300);
  check("toolbar collapses", await evaluate("document.getElementById('toolbarWrapper').hidden"));
  check("the chevron turns up while the toolbar is collapsed", await evaluate(toggleIsUp));
  await reload();
  check(
    "toolbar stays collapsed after reopening",
    await evaluate("document.getElementById('toolbarWrapper').hidden")
  );
  check("the chevron is still up after reopening", await evaluate(toggleIsUp));
  await evaluate("document.getElementById('btnToggleToolbar').click()");
  await sleep(250);
  check("the chevron turns down again when the toolbar is shown", !(await evaluate(toggleIsUp)));

  await evaluate("document.getElementById('btnSettings').click()");
  await sleep(300);
  await evaluate("document.querySelector('#accentControls [data-accent=\"blue\"]').click()");
  await sleep(300);
  await reload();
  check(
    "the accent colour applies and persists across reopening",
    (await evaluate("document.documentElement.getAttribute('data-accent')")) === "blue"
  );
  await evaluate("document.getElementById('btnSettings').click()");
  await sleep(300);
  await evaluate("document.querySelector('#accentControls [data-accent=\"green\"]').click()");
  await sleep(250);
  check(
    "the accent colour can be put back",
    (await evaluate("document.documentElement.getAttribute('data-accent')")) === "green"
  );
  await evaluate("document.getElementById('btnCloseSettings').click()");
  await sleep(200);

  // ── Sync with the phone app ──────────────────────────────────────────────
  section("Sync");
  await evaluate("document.getElementById('btnCloud').click()");
  await sleep(600);
  check(
    "the Sync panel opens",
    (await evaluate("document.getElementById('cloudPanel').hidden")) === false
  );
  const syncText = await evaluate("document.getElementById('cloudBody').textContent");
  check(
    "it offers to connect, or says sync is unavailable in this build",
    /Connect Google account|not available/.test(syncText),
    syncText.slice(0, 120)
  );
  check(
    "the background worker answers the popup",
    (await evaluate(
      "chrome.runtime.sendMessage({ cmd: 'status' }).then(s => typeof s.configured)"
    )) === "boolean"
  );
  await evaluate("document.getElementById('btnCloseCloud').click()");
  await sleep(250);

  // ── Bible versions ───────────────────────────────────────────────────────
  section("Bible versions");
  const goToPsalm = async (number) => {
    await evaluate(
      `document.getElementById('txtChapter').value = '${number}'; document.getElementById('btnGo').click()`
    );
    await sleep(300);
  };
  const chipLabel = "document.getElementById('btnVersionLabel').textContent";
  const verseTwo = "document.querySelectorAll('.verse-text')[1]?.textContent ?? ''";
  const storedVersion =
    "chrome.storage.local.get('psalmsway').then((r) => r.psalmsway.settings.bibleVersion)";
  /** Opens the picker and chooses a version by its module, then waits for the page to repaint. */
  const chooseVersion = async (module) => {
    await evaluate("document.getElementById('btnVersion').click()");
    await waitFor("document.querySelectorAll('#versionBody .version-row').length > 0");
    await evaluate(`document.querySelector('.version-row[data-module="${module}"]').click()`);
    await waitFor("document.getElementById('versionPanel').hidden");
    await sleep(300);
  };

  await goToPsalm(23);
  check("the chip shows NIV to begin with", (await evaluate(chipLabel)) === "NIV");
  check("Psalm 23 is in the NIV", (await evaluate(verseTwo)).includes("He makes me lie down"));
  await evaluate("document.getElementById('btnVersion').click()");
  await waitFor("document.querySelectorAll('#versionBody .version-row').length > 0");
  check(
    "the picker lists all 80 versions and marks the NIV as the current one",
    (await evaluate("document.querySelectorAll('#versionBody .version-row').length")) === 80 &&
      (await evaluate(
        "document.querySelector('.version-row[aria-current=\"true\"]')?.dataset.module"
      )) === "modern"
  );
  await evaluate(
    "(() => { const f = document.querySelector('.version-filter'); f.value = 'king james'; f.dispatchEvent(new Event('input', { bubbles: true })); })()"
  );
  await sleep(150);
  check(
    "the filter box narrows the list by name",
    await evaluate(
      "(() => { const rows = document.querySelectorAll('#versionBody .version-row'); return rows.length > 0 && rows.length < 5 && !!document.querySelector('.version-row[data-module=\"kjv\"]'); })()"
    )
  );
  await evaluate("document.querySelector('.version-row[data-module=\"kjv\"]').click()");
  await waitFor("document.getElementById('versionPanel').hidden");
  await sleep(300);
  check(
    "choosing a version closes the picker and the chip says KJV",
    (await evaluate("document.getElementById('versionPanel').hidden")) &&
      (await evaluate(chipLabel)) === "KJV",
    await evaluate(chipLabel)
  );
  check(
    "the Psalm title is still Psalm 23",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 23"
  );
  check("the Psalm is now in the KJV", (await evaluate(verseTwo)).includes("He maketh me"));
  check("the choice is saved", (await evaluate(storedVersion)) === "kjv");

  await reload();
  check(
    "the KJV is still the version after reopening",
    (await evaluate(chipLabel)) === "KJV" &&
      (await evaluate("document.getElementById('versionSetting').textContent")) ===
        "Authorized King James Version"
  );

  // A single verse keeps its reference through a change of version.
  await evaluate("document.getElementById('btnLibrary').click()");
  await sleep(300);
  await evaluate("document.querySelector('#libraryTabs [data-tab=favourites]').click()");
  await sleep(300);
  await evaluate("document.querySelector('#libraryBody .row-body').click()");
  await sleep(350);
  check(
    "the KJV single verse reads 'I shall not want'",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 23:1" &&
      (await evaluate("document.querySelector('.single-verse-text').textContent")).includes(
        "I shall not want"
      )
  );
  await chooseVersion("modern");
  check("switching back to NIV puts NIV on the chip", (await evaluate(chipLabel)) === "NIV");
  check(
    "the single verse keeps its reference and is now the NIV's",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 23:1" &&
      (await evaluate("document.querySelector('.single-verse-text').textContent")).includes(
        "I shall not be in want"
      )
  );
  check("the NIV is saved again", (await evaluate(storedVersion)) === "modern");
  await reload();
  check("the NIV is still the version after reopening", (await evaluate(chipLabel)) === "NIV");

  // ── Highlights and favourite Psalms ──────────────────────────────────────
  section("Highlights and favourite Psalms");
  await goToPsalm(23);
  await evaluate("document.querySelectorAll('.verse .verse-body')[2].click()");
  await sleep(300);
  await evaluate("document.querySelector('.verse-actions .btn-highlight').click()");
  await sleep(200);
  check(
    "the Highlight button opens four colours and None",
    (await evaluate("document.querySelectorAll('.highlight-picker .hl-swatch').length")) === 4 &&
      (await evaluate("!document.querySelector('.highlight-picker').hidden"))
  );
  await evaluate("document.querySelector('.hl-swatch[data-highlight=\"yellow\"]').click()");
  await sleep(400);
  const verseTint = "document.querySelectorAll('.verse-body')[2].dataset.highlight";
  check("the verse shows its yellow tint", (await evaluate(verseTint)) === "yellow");
  // The phone's shape: 1-based chapter and verse. Compared as values, since the store sorts its keys.
  const storedHighlights = await evaluate(`chrome.storage.local.get('psalmsway').then((r) => {
    const rows = r.psalmsway.carry.highlights;
    return JSON.stringify(rows) +
      (rows.length === 1 && rows[0].chapter === 23 && rows[0].verse === 3 && rows[0].color === 'yellow'
        ? ' ok' : ' wrong');
  })`);
  check(
    "the highlight is stored in the phone's shape",
    storedHighlights.endsWith(" ok"),
    storedHighlights
  );
  await reload();
  await goToPsalm(23);
  check(
    "the highlight survives closing and reopening the popup",
    (await evaluate(verseTint)) === "yellow" &&
      (await evaluate("document.querySelectorAll('.verse-body[data-highlight]').length")) === 1
  );

  check(
    "the heart in the chapter bar starts empty",
    (await evaluate("document.getElementById('btnFavChapter').getAttribute('aria-pressed')")) ===
      "false" &&
      (await evaluate("document.querySelector('#btnFavChapter svg').getAttribute('fill')")) ===
        "none"
  );
  await evaluate("document.getElementById('btnFavChapter').click()");
  await waitFor("document.getElementById('btnFavChapter').getAttribute('aria-pressed') === 'true'");
  check(
    "clicking the heart fills it",
    (await evaluate("document.querySelector('#btnFavChapter svg').getAttribute('fill')")) ===
      "currentColor"
  );
  await reload();
  await goToPsalm(23);
  check(
    "the filled heart survives closing and reopening the popup",
    (await evaluate("document.getElementById('btnFavChapter').getAttribute('aria-pressed')")) ===
      "true"
  );

  await evaluate("document.getElementById('btnLibrary').click()");
  await sleep(300);
  await evaluate("document.querySelector('#libraryTabs [data-tab=highlights]').click()");
  await sleep(300);
  check(
    "Library > Highlights lists the highlighted verse with its colour",
    (await evaluate("document.querySelectorAll('#libraryBody .row').length")) === 1 &&
      (await evaluate("document.querySelector('#libraryBody .row-ref').textContent")).includes(
        "Psalm 23:3"
      ) &&
      (await evaluate("document.querySelector('#libraryBody .hl-dot')?.dataset.highlight")) ===
        "yellow"
  );
  await evaluate("document.querySelector('#libraryTabs [data-tab=chapters]').click()");
  await sleep(300);
  check(
    "Library > Favourites lists the favourite Psalm",
    (await evaluate("document.querySelectorAll('#libraryBody .row').length")) === 1 &&
      (await evaluate("document.querySelector('#libraryBody .row-ref').textContent")) === "Psalm 23"
  );
  await evaluate("document.querySelector('#libraryBody .row-body').click()");
  await sleep(350);
  check(
    "opening a favourite Psalm shows the whole Psalm",
    (await evaluate("document.getElementById('chapterTitle').textContent")) === "Psalm 23" &&
      (await evaluate("document.querySelectorAll('.verse').length")) === 6
  );
  await evaluate("document.getElementById('btnFavChapter').click()");
  await waitFor(
    "document.getElementById('btnFavChapter').getAttribute('aria-pressed') === 'false'"
  );
  check(
    "clicking the heart again empties it",
    (await evaluate("document.querySelector('#btnFavChapter svg').getAttribute('fill')")) === "none"
  );
  await evaluate("document.getElementById('btnFavChapter').click()");
  await waitFor("document.getElementById('btnFavChapter').getAttribute('aria-pressed') === 'true'");

  // ── Compare ──────────────────────────────────────────────────────────────
  section("Compare");
  await goToPsalm(23);
  await evaluate("document.getElementById('btnCompare').click()");
  await waitFor("document.querySelectorAll('#compareBody .compare-card').length > 0");
  check(
    "Compare shows three cards",
    (await evaluate("document.querySelectorAll('#compareBody .compare-card').length")) === 3
  );
  check(
    "the first card is the version being read, the other two have a select each",
    (await evaluate("document.querySelector('.compare-card-name')?.textContent")) ===
      "New International Version (1984)" &&
      (await evaluate("document.querySelectorAll('.compare-select').length")) === 2
  );
  check(
    "every card has its own text for the verse",
    await evaluate(
      "(() => { const t = [...document.querySelectorAll('.compare-text')].map((n) => n.textContent); return t.length === 3 && t.every((x) => x.length > 10) && new Set(t).size === 3; })()"
    )
  );
  check(
    "the selects do not offer the version already being read",
    await evaluate(
      "[...document.querySelectorAll('.compare-select')].every((s) => s.options.length === 79 && ![...s.options].some((o) => o.value === 'modern'))"
    )
  );
  await evaluate("document.getElementById('btnCloseCompare').click()");
  await sleep(250);
  await evaluate("document.querySelectorAll('.verse .verse-body')[2].click()");
  await waitFor("!!document.querySelector('.verse.is-selected .verse-actions')");
  await evaluate("document.getElementById('btnCompare').click()");
  await waitFor("document.querySelectorAll('#compareBody .compare-card').length > 0");
  check(
    "the toolbar's Compare shows the verse selected in the Psalm",
    (await evaluate("document.querySelector('.compare-reference')?.textContent")) === "Psalm 23:3",
    await evaluate("document.querySelector('.compare-reference')?.textContent")
  );
  await evaluate("document.getElementById('btnCloseCompare').click()");
  await sleep(250);

  // ── Prayers ──────────────────────────────────────────────────────────────
  section("Prayers");
  await evaluate("document.getElementById('btnPrayers').click()");
  await waitFor("document.querySelectorAll('#prayersBody .prayer-row').length > 0");
  check(
    "Prayers opens on its categories",
    (await evaluate("document.querySelectorAll('#prayersBody .prayer-row').length")) > 1
  );
  const prayerTotal = await evaluate(`(() => {
    const body = document.getElementById('prayersBody');
    const categories = body.querySelectorAll('.prayer-row').length;
    let total = 0;
    for (let i = 0; i < categories; i++) {
      body.querySelectorAll('.prayer-row')[i].click();
      total += body.querySelectorAll('.prayer-row').length;
      body.querySelector('.prayer-back').click();
    }
    return JSON.stringify({ categories, total });
  })()`);
  check(
    "the categories hold 50 prayers between them",
    JSON.parse(prayerTotal).total === 50 && JSON.parse(prayerTotal).categories > 1,
    prayerTotal
  );
  await evaluate("document.querySelectorAll('#prayersBody .prayer-row')[0].click()");
  const categoryHeading = await evaluate("document.querySelector('.prayer-heading').textContent");
  check(
    "a category opens its prayers",
    (await evaluate("document.querySelectorAll('#prayersBody .prayer-row').length")) > 0 &&
      categoryHeading.length > 0,
    categoryHeading
  );
  await evaluate("document.querySelectorAll('#prayersBody .prayer-row')[0].click()");
  check(
    "a prayer opens with its text and Psalm references",
    (await evaluate("document.querySelector('.prayer-text')?.textContent.length")) > 50 &&
      (await evaluate("document.querySelectorAll('.prayer-ref').length")) > 0
  );
  const reference = await evaluate(
    "document.querySelector('.prayer-ref:not(.is-plain)').textContent.trim()"
  );
  await evaluate("document.querySelector('.prayer-ref:not(.is-plain)').click()");
  await waitFor("document.getElementById('prayersPanel').hidden");
  const openedTitle = await evaluate("document.getElementById('chapterTitle').textContent");
  check(
    "a Psalm reference in a prayer opens that Psalm",
    (await evaluate("document.getElementById('prayersPanel').hidden")) && openedTitle === reference,
    `${reference} → ${openedTitle}`
  );

  // ── Progress ─────────────────────────────────────────────────────────────
  section("Progress");
  await evaluate("document.getElementById('btnProgress').click()");
  await waitFor("!!document.querySelector('#progressBody .progress-streak-number')");
  check(
    "Progress shows a streak of 1 after the first open",
    (await evaluate("document.querySelector('.progress-streak-number').textContent")) === "1"
  );
  check(
    "the last seven days are listed and today is marked read",
    (await evaluate("document.querySelectorAll('.progress-day').length")) === 7 &&
      (await evaluate(
        "document.querySelector('.progress-day.is-today').classList.contains('is-read')"
      ))
  );
  check(
    "nine badges are listed and one is earned: 1/9",
    (await evaluate("document.querySelectorAll('.progress-badge').length")) === 9 &&
      (await evaluate("document.querySelectorAll('.progress-badge.is-earned').length")) === 1 &&
      (await evaluate("document.querySelector('.progress-count')?.textContent")) === "1/9"
  );
  check(
    "six challenges are listed",
    (await evaluate("document.querySelectorAll('#progressBody .progress-challenge').length")) === 6
  );
  check(
    "the reading totals count the highlight and the favourite Psalm",
    await evaluate(`(() => {
      const rows = Object.fromEntries([...document.querySelectorAll('.progress-total-row')].map((r) => [r.firstChild.textContent, r.lastChild.textContent]));
      return rows['Highlights'] === '1' && rows['Favourites'] === '1';
    })()`)
  );
  // A change that arrives while a panel is open (as cloud sync writes it) is shown at once.
  const syncStreak = (count) =>
    evaluate(`chrome.storage.local.get('psalmsway').then((r) => {
      r.psalmsway.carry.streak = { ...r.psalmsway.carry.streak, count: ${count} };
      return chrome.storage.local.set(r);
    })`);
  await syncStreak(7);
  check(
    "an open Progress panel shows a synced streak at once",
    await waitFor(
      "document.querySelector('#progressBody .progress-streak-number')?.textContent === '7'"
    )
  );
  await evaluate("document.getElementById('btnCloseProgress').click()");
  await sleep(250);
  await evaluate("document.getElementById('btnTodaysPsalm').click()");
  await waitFor("!!document.querySelector('#todayBody .today-streak')");
  await syncStreak(8);
  check(
    "an open Today panel shows a synced streak at once",
    await waitFor(
      "document.querySelector('#todayBody .today-streak')?.textContent === '8-day streak'"
    )
  );
  await evaluate("document.getElementById('btnCloseToday').click()");
  await sleep(250);

  // ── Interface language ───────────────────────────────────────────────────
  section("Language");
  const chooseLanguage = async (code) => {
    await evaluate(
      `(() => { const s = document.getElementById('languageSelect'); s.value = '${code}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`
    );
    await waitFor(`document.documentElement.lang === '${code}'`);
    await sleep(300);
  };
  await evaluate("document.getElementById('btnSettings').click()");
  await sleep(300);
  check(
    "the Language select offers Automatic and the 47 languages by their own names",
    (await evaluate("document.getElementById('languageSelect').options.length")) === 48 &&
      (await evaluate(
        "[...document.getElementById('languageSelect').options].some((o) => o.value === 'de' && o.textContent === 'Deutsch')"
      ))
  );
  await chooseLanguage("ar");
  check(
    "choosing Arabic makes the page right to left",
    (await evaluate("document.documentElement.dir")) === "rtl"
  );
  check(
    "the fixed text is in Arabic at once, and so is the Psalm on screen",
    await evaluate(`(async () => {
      const phone = await (await fetch('locales/app/ar.json')).json();
      const reader = await import('./src/reader.js');
      const chapter = String(reader.getCurrentChapter() + 1);
      const verse = reader.getCurrentVerse();
      const expected = (verse === null ? phone.psalmTitle : phone.psalmSubtitle)
        .replace('{{chapter}}', chapter)
        .replace('{{verse}}', String((verse ?? 0) + 1));
      return document.getElementById('settingsHeading').textContent === phone.settings &&
        document.getElementById('chapterTitle').textContent === expected;
    })()`)
  );
  check(
    "the Bible's own language and direction are on the verse text, not on the reading view",
    (await evaluate("document.getElementById('readingView').hasAttribute('dir')")) === false &&
      (await evaluate(
        "document.querySelector('.verse-text, .single-verse-text').hasAttribute('dir')"
      ))
  );
  check(
    "the popup still fits its width in a right-to-left language",
    await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
  );
  await reload();
  check(
    "the language persists across reopening",
    (await evaluate("document.documentElement.lang")) === "ar" &&
      (await evaluate("document.documentElement.dir")) === "rtl"
  );
  // German: the toolbar says what the phone's German files say, not English.
  await evaluate("document.getElementById('btnSettings').click()");
  await sleep(300);
  await chooseLanguage("de");
  check(
    "German shows German labels in the toolbar",
    await evaluate(`(async () => {
      const [ext, app] = await Promise.all(
        ['locales/ext/de.json', 'locales/app/de.json'].map((path) => fetch(path).then((r) => r.json()))
      );
      const labels = [...document.querySelectorAll('.toolbar .btn-tool-label')];
      return labels.length === 6 &&
        labels.every((label) => label.textContent === (ext[label.dataset.i18n] ?? app[label.dataset.i18n]));
    })()`)
  );
  check(
    "the German toolbar no longer says Library, History, Compare, Prayers or Progress",
    await evaluate(`(() => {
      const labels = [...document.querySelectorAll('.toolbar .btn-tool-label')].map((l) => l.textContent);
      return ['Library', 'History', 'Compare', 'Prayers', 'Progress'].every((word) => !labels.includes(word));
    })()`)
  );
  check(
    "German names the Search button and stays left to right",
    (await evaluate(`(async () => {
      const ext = await (await fetch('locales/ext/de.json')).json();
      const app = await (await fetch('locales/app/de.json')).json();
      return document.getElementById('btnSearch').getAttribute('aria-label') === (ext.search ?? app.search);
    })()`)) && (await evaluate("document.documentElement.dir")) === "ltr"
  );
  // Long words in some languages must not push a control out of its row or past the edge.
  const fitsWithinItsRow = `(() => {
    const inside = (selector) => {
      const box = document.querySelector(selector);
      const style = getComputedStyle(box);
      const rect = box.getBoundingClientRect();
      const left = rect.left + parseFloat(style.paddingLeft);
      const right = rect.right - parseFloat(style.paddingRight);
      return [...box.children].every((child) => {
        const r = child.getBoundingClientRect();
        if (child.classList.contains('sr-only')) return true;
        return r.width === 0 || (r.left >= left - 1 && r.right <= right + 1);
      });
    };
    return ['.header', '.header-actions', '.chapter-bar', '.chapter-nav', '.toolbar'].every(inside);
  })()`;
  // German has the long words; Tamil and Malayalam the wide letters; Arabic and Hebrew run right to left.
  const LONG_LANGUAGES = {
    de: "German",
    ta: "Tamil",
    ml: "Malayalam",
    ar: "Arabic",
    he: "Hebrew",
  };
  for (const [code, name] of Object.entries(LONG_LANGUAGES)) {
    await evaluate("document.getElementById('btnSettings').click()");
    await sleep(300);
    await chooseLanguage(code);
    await evaluate("document.getElementById('btnLibrary').click()");
    await sleep(300);
    check(
      `the Library tabs do not scroll sideways in ${name}`,
      await evaluate(
        "(() => { const t = document.getElementById('libraryTabs'); return t.scrollWidth <= t.clientWidth; })()"
      )
    );
    check(
      `the popup does not scroll sideways in ${name}`,
      await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    );
    check(
      `the header, chapter bar and toolbar keep every control inside their row in ${name}`,
      await evaluate(fitsWithinItsRow)
    );
    await evaluate("document.getElementById('btnCloseLibrary').click()");
    await sleep(200);
  }
  await evaluate("document.getElementById('btnSettings').click()");
  await sleep(300);
  await chooseLanguage("en");
  check(
    "going back to English makes it left to right again",
    (await evaluate("document.documentElement.dir")) === "ltr"
  );
  await evaluate(
    "(async () => { const s = await import('./src/storage.js'); await s.updateSettings({ uiLanguage: 'auto' }); })()"
  );
  await reload();

  // ── The header after the version chip is painted ─────────────────────────
  section("Header");
  const headerState = `(() => {
    const buttons = [...document.querySelectorAll('.header-actions .button')];
    const tops = [...document.querySelectorAll('.header .title, .header-actions > *')].map(
      (node) => Math.round(node.getBoundingClientRect().top)
    );
    return {
      fits: buttons.length === 2 && buttons.every((b) => b.scrollWidth <= b.clientWidth),
      oneRow: Math.max(...tops) - Math.min(...tops) < 10,
      chip: document.getElementById('btnVersion').getAttribute('aria-label') ?? '',
      chipTitle: document.getElementById('btnVersion').title,
      detail: buttons.map((b) => getComputedStyle(b).fontSize + ' ' + b.scrollWidth + '/' + b.clientWidth).join(', ') +
        ', title ' + getComputedStyle(document.querySelector('.header .title')).fontSize,
    };
  })()`;
  /** Opens the popup on `store` (written whole) and waits for the chip to say `label`. */
  const openOn = async (store, language, label) => {
    await evaluate(`(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ psalmsway: ${JSON.stringify(store)} });
    })()`);
    await reload();
    await waitFor(`document.documentElement.lang === '${language}'`);
    await waitFor(`document.getElementById('btnVersionLabel').textContent === '${label}'`);
    await sleep(300);
    return evaluate(headerState);
  };
  const german = await openOn(
    { schemaVersion: 3, settings: { uiLanguage: "de", bibleVersion: "elberfelder_1871" } },
    "de",
    "Elberfelder"
  );
  check(
    "German with the Elberfelder: One Verse and New Chapter fit, and the header is one row",
    german.fits && german.oneRow,
    german.detail
  );
  check(
    "the chip's tooltip names the whole version, and its accessible name stays its visible label",
    german.chip === "" && german.chipTitle.includes("Elberfelder (1871)"),
    `${german.chip} / ${german.chipTitle}`
  );
  // A first-time Spanish reader: no version saved and nothing read, so the Spanish first choice.
  const spanish = await openOn({ schemaVersion: 3, settings: { uiLanguage: "es" } }, "es", "Reina");
  check(
    "Spanish with its first-choice version: the header buttons fit, and the header is one row",
    spanish.fits && spanish.oneRow,
    spanish.detail
  );
  await evaluate(`(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ psalmsway: { schemaVersion: 3, settings: { bibleVersion: 'modern' } } });
  })()`);
  await reload();

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
  // Restoring through Settings, as a reader does: the backup's Bible version applies at once.
  await evaluate("document.getElementById('btnSettings').click()");
  await sleep(300);
  await evaluate(`(async () => {
    const backup = await import('./src/backup.js');
    const storage = await import('./src/storage.js');
    const store = await storage.loadStore();
    const doc = backup.createBackup({ ...store, settings: { ...store.settings, bibleVersion: 'kjv' } }, '3.0');
    const files = new DataTransfer();
    files.items.add(new File([JSON.stringify(doc)], 'backup.json', { type: 'application/json' }));
    const input = document.getElementById('fileImport');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("!document.getElementById('dialogHost').hidden");
  await evaluate("document.querySelector('.dialog-actions .button-danger').click()");
  await waitFor("document.getElementById('statusBar').textContent.includes('Backup restored')");
  await waitFor(`${chipLabel} === 'KJV'`);
  await sleep(300);
  check(
    "a restored backup's Bible version applies at once, on the chip and the Psalm",
    (await evaluate(chipLabel)) === "KJV" &&
      (await evaluate("document.querySelector('.verse-text')?.textContent ?? ''")).includes(
        "a very present help"
      ),
    await evaluate(chipLabel)
  );
  await evaluate("document.getElementById('btnCloseSettings').click()");
  await sleep(200);

  // ── Every panel ──────────────────────────────────────────────────────────
  // Last of all, on the migrated store, so the console and network checks below
  // cover each panel having been opened, not only the ones the sections above used.
  section("Every panel");
  for (const [button, panel] of [
    ["btnTodaysPsalm", "todayPanel"],
    ["btnSearch", "searchPanel"],
    ["btnLibrary", "libraryPanel"],
    ["btnHistory", "historyPanel"],
    ["btnVersion", "versionPanel"],
    ["btnCompare", "comparePanel"],
    ["btnPrayers", "prayersPanel"],
    ["btnProgress", "progressPanel"],
    ["btnCloud", "cloudPanel"],
    ["btnSettings", "settingsPanel"],
  ]) {
    await evaluate(`document.getElementById('${button}').click()`);
    await sleep(500);
    const opened = await evaluate(`!document.getElementById('${panel}').hidden`);
    const name = panel.replace("Panel", "");
    await evaluate(
      `document.getElementById('btnClose${name[0].toUpperCase()}${name.slice(1)}').click()`
    );
    await sleep(150);
    check(
      `the ${name} panel opens and closes`,
      opened && (await evaluate(`document.getElementById('${panel}').hidden`)),
      `${button} → ${panel}`
    );
  }

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
