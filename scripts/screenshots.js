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
  const page = await new CDP(
    targets.find((t) => t.id === targetId).webSocketDebuggerUrl
  ).connect();

  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 440,
    height: 560,
    deviceScaleFactor: 2,
    mobile: false,
  });

  const run = (expression) =>
    page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });

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
    await sleep(800);
  };

  console.log("Writing screenshots to", OUT_DIR);

  // Seed a little personal data so the Library and History are not empty.
  await reload();
  await run(`(async () => {
    await chrome.storage.local.set({ psalmsway: {
      schemaVersion: 2,
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
      settings: { theme: 'light', fontSize: 'medium', lang: 'en', toolbarCollapsed: false }
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

  browser.close();
  page.close();
  console.log("\nDone.");
} catch (error) {
  console.error(`screenshots failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
