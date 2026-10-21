#!/usr/bin/env node
/**
 * Capture popup screenshots from the real extension.
 *
 *   node scripts/screenshots.js [outputDir]
 *
 * Loads the extension into Chrome, walks through each view, and writes PNGs at
 * the popup's real size. Used for the README and for Chrome Web Store listing
 * images; nothing is uploaded.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_PATH = fileURLToPath(new URL("../", import.meta.url)).replace(/[/\\]$/, "");
const OUT_DIR = process.argv[2]
  ? process.argv[2]
  : fileURLToPath(new URL("../docs/screenshots/", import.meta.url));
const PORT = 9900 + Math.floor(Math.random() * 90);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  console.error("Chrome was not found. Set CHROME_PATH.");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error("connect failed"));
    });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      }
    };
    return this;
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.ws?.close();
  }
}

const profileDir = mkdtempSync(join(tmpdir(), "psalms-shots-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

function cleanup() {
  chrome.kill();
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* temp dir */
  }
}
process.on("exit", cleanup);

try {
  let version = null;
  for (let attempt = 0; attempt < 60 && !version; attempt++) {
    await sleep(250);
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      /* not up yet */
    }
  }
  if (!version) throw new Error("Chrome did not start");

  const browser = await new CDP(version.webSocketDebuggerUrl).connect();
  const { id: extensionId } = await browser.send("Extensions.loadUnpacked", {
    path: EXTENSION_PATH,
  });

  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = await new CDP(targets.find((t) => t.id === targetId).webSocketDebuggerUrl).connect();

  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 440,
    height: 600,
    deviceScaleFactor: 2,
    mobile: false,
  });

  const run = (expression) =>
    page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });

  /** Poll until an expression is truthy, so a slow cold start does not photograph a half-built popup. */
  const waitFor = async (expression, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const { result } = await run(expression);
        if (result?.value) return;
      } catch {
        /* the page can be mid-navigation */
      }
      await sleep(50);
    }
    throw new Error(`timed out waiting for: ${expression}`);
  };

  mkdirSync(OUT_DIR, { recursive: true });

  const shoot = async (name) => {
    const { data } = await page.send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`  ${name}.png`);
  };

  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const reload = async () => {
    await page.send("Page.navigate", { url: popupUrl });
    await waitFor("!!document.querySelector('.verse, .single-verse, .panel-empty')");
    await sleep(300);
  };

  const goToPsalm = async (number) => {
    await run(
      `document.getElementById('txtChapter').value='${number}';document.getElementById('btnGo').click()`
    );
    await sleep(600);
  };

  /** Takes the focus ring off whatever the popup focused on opening a panel, so it does not show in the picture. */
  const unfocus = () => run("document.activeElement?.blur()");

  /** Changes saved settings the way the popup does, then reopens it so every view starts from them. */
  const setSettings = async (patch) => {
    await run(
      `import('./src/storage.js').then((storage) => storage.updateSettings(${JSON.stringify(patch)}))`
    );
    await reload();
  };

  console.log("Writing screenshots to", OUT_DIR);

  // Seed a little personal data so the Library, History and Progress are not empty. It is
  // the phone's own shape where the phone owns the data (carry): highlights, favourite
  // Psalms, a five-day streak with its first two badges, and a challenge under way.
  await reload();
  await run(`(async () => {
    const { toDateKey, addDays } = await import('./src/dateKeys.js');
    const today = toDateKey(new Date());
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
    await chrome.storage.local.set({ psalmsway: {
      schemaVersion: 3,
      favourites: [
        { chapterIndex: 22, verseIndex: 0, addedAt: Date.now() - 86400000 },
        { chapterIndex: 90, verseIndex: 1, addedAt: Date.now() - 172800000 }
      ],
      notes: [{
        id: 'n_22_3', chapterIndex: 22, verseIndex: 3,
        text: 'Read this the week my father was in hospital.',
        createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000
      }],
      history: [
        { chapterIndex: 22, verseIndex: null, viewedAt: Date.now() - 3600000 },
        { chapterIndex: 90, verseIndex: 1, viewedAt: Date.now() - 90000000 },
        { chapterIndex: 1, verseIndex: null, viewedAt: Date.now() - 200000000 }
      ],
      settings: {
        theme: 'light', fontSize: 'medium', toolbarCollapsed: false, accent: 'green',
        bibleVersion: 'modern', uiLanguage: 'en'
      },
      carry: {
        highlights: [
          { chapter: 23, verse: 2, color: 'yellow' },
          { chapter: 46, verse: 1, color: 'blue' },
          { chapter: 91, verse: 1, color: 'green' },
          { chapter: 121, verse: 1, color: 'pink' }
        ],
        favorites: [23, 121, 46],
        streak: { lastDate: today, count: 5, longestStreak: 12 },
        badges: { day1: daysAgo(4), day3: daysAgo(2) },
        challenges: {
          david_hiding: {
            startDate: addDays(today, -2),
            notifHour: 8, notifMinute: 0,
            dayAssignments: [57, 142, 54, 52, 34, 56, 63].map((chapter) => ({ chapter, verseNumber: 1 })),
            completedDays: [0, 1],
            lastCompletedDate: addDays(today, -1),
            completed: false
          }
        }
      }
    }});
  })()`);

  // Reading, light
  await reload();
  await run(
    "document.getElementById('txtChapter').value='23';document.getElementById('btnGo').click()"
  );
  await sleep(600);
  await shoot("01-reading-light");

  // A selected verse with its actions
  await run("document.querySelectorAll('.verse .verse-body')[3].click()");
  await sleep(500);
  await shoot("02-verse-actions");

  // Library, notes tab
  await run("document.getElementById('btnLibrary').click()");
  await sleep(500);
  await run("document.querySelector('#libraryTabs [data-tab=notes]').click()");
  await sleep(500);
  await unfocus();
  await shoot("03-library-notes");

  // Search
  await run("document.getElementById('btnSearch').click()");
  await sleep(400);
  await run(
    "document.getElementById('txtSearch').value='shepherd';document.getElementById('btnDoSearch').click()"
  );
  await sleep(600);
  await shoot("04-search");

  // Note editor
  await reload();
  await run(
    "document.getElementById('txtChapter').value='23';document.getElementById('btnGo').click()"
  );
  await sleep(600);
  await run("document.querySelectorAll('.verse .verse-body')[3].click()");
  await sleep(400);
  await run("document.querySelector('.verse-actions .btn-note').click()");
  await sleep(600);
  await shoot("05-note-editor");

  // History
  await reload();
  await run("document.getElementById('btnHistory').click()");
  await sleep(600);
  await shoot("06-history");

  // Settings
  await run("document.getElementById('btnSettings').click()");
  await sleep(500);
  await shoot("07-settings");

  // Dark theme reading
  await run("document.querySelector('.theme-btn[data-theme=\"dark\"]').click()");
  await sleep(400);
  await reload();
  await run(
    "document.getElementById('txtChapter').value='23';document.getElementById('btnGo').click()"
  );
  await sleep(600);
  await shoot("08-reading-dark");

  // Sepia theme reading
  await run("document.getElementById('btnSettings').click()");
  await sleep(300);
  await run("document.querySelector('.theme-btn[data-theme=\"sepia\"]').click()");
  await sleep(300);
  await reload();
  await run(
    "document.getElementById('txtChapter').value='121';document.getElementById('btnGo').click()"
  );
  await sleep(600);
  await shoot("09-reading-sepia");

  // Dark Library, to check the dark palette on lists
  await run("document.getElementById('btnSettings').click()");
  await sleep(300);
  await run("document.querySelector('.theme-btn[data-theme=\"dark\"]').click()");
  await sleep(300);
  await run("document.getElementById('btnLibrary').click()");
  await sleep(600);
  await shoot("10-library-dark");

  // The newer screens, in the light theme, from the same seed.
  await setSettings({ theme: "light" });
  await goToPsalm(23);

  // Bible versions
  await run("document.getElementById('btnVersion').click()");
  await waitFor("document.querySelectorAll('#versionBody .version-row').length > 0");
  await sleep(300);
  await shoot("11-versions");

  // Today
  await run("document.getElementById('btnTodaysPsalm').click()");
  await waitFor("!!document.querySelector('#todayBody .today-verse')");
  await sleep(300);
  await shoot("12-today");

  // Compare: Psalm 23:1 in the NIV and the two saved comparison versions
  await goToPsalm(23);
  await run("document.getElementById('btnCompare').click()");
  await waitFor("document.querySelectorAll('#compareBody .compare-card').length === 3");
  await sleep(300);
  await shoot("13-compare");

  // Prayers: the first prayer of the first category
  await run("document.getElementById('btnPrayers').click()");
  await waitFor("document.querySelectorAll('#prayersBody .prayer-row').length > 0");
  await run("document.querySelector('#prayersBody .prayer-row').click()");
  await run("document.querySelector('#prayersBody .prayer-row').click()");
  await waitFor("!!document.querySelector('#prayersBody .prayer-text')");
  await sleep(300);
  await unfocus();
  await shoot("14-prayers");

  // Progress
  await run("document.getElementById('btnProgress').click()");
  await waitFor("!!document.querySelector('#progressBody .progress-streak-number')");
  await sleep(300);
  await shoot("15-progress");

  // Library, Highlights tab
  await run("document.getElementById('btnLibrary').click()");
  await sleep(300);
  await run("document.querySelector('#libraryTabs [data-tab=highlights]').click()");
  await waitFor("document.querySelectorAll('#libraryBody .row').length > 0");
  await sleep(300);
  await unfocus();
  await shoot("16-library-highlights");

  // Settings: the accent colour and the language (German, so the translated screens show too)
  await setSettings({ accent: "purple", uiLanguage: "de" });
  await run("document.getElementById('btnSettings').click()");
  await sleep(500);
  await shoot("17-settings-appearance");

  // Right to left: the whole popup in Arabic, reading an Arabic Bible
  await setSettings({ accent: "green", uiLanguage: "ar", bibleVersion: "svd" });
  await goToPsalm(23);
  await shoot("18-reading-arabic");

  browser.close();
  page.close();
  console.log("\nDone.");
} catch (error) {
  console.error(`screenshots failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
