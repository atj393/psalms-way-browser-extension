// ─── Background worker ────────────────────────────────────────────────────────
// Exists only for optional cloud sync with the phone app. It reads and writes
// nothing on any web page; it talks to Google only for a reader who connected
// their Google account, and does nothing at all for anyone else.
//
// The popup is destroyed as soon as it closes, so syncing lives here: a sync
// started from the popup (or by a change made in it) still finishes.

import {
  autoSync,
  connect,
  disconnect,
  getStatus,
  recover,
  syncAnyway,
  syncNow,
} from "./cloudSync.js";
import { STORE_KEY } from "./storage.js";

/** How long after a change to sync, so a burst of edits makes one upload. */
const CHANGE_DELAY_MS = 5000;

const COMMANDS = {
  status: getStatus,
  autoSync: () => autoSync(),
  syncNow,
  connect,
  recover,
  syncAnyway,
  disconnect,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const command = COMMANDS[message?.cmd];
  if (!command) return false;
  command().then(sendResponse, (error) => {
    console.error("Psalms Way: cloud sync failed", error);
    sendResponse({ ok: false, code: "unknown", detail: String(error?.message ?? error) });
  });
  return true; // answer asynchronously
});

let changeTimer = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORE_KEY]) return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    autoSync({ onlyIfLocalChanged: true }).catch((error) =>
      console.warn("Psalms Way: sync after a change failed", error)
    );
  }, CHANGE_DELAY_MS);
});

chrome.runtime.onStartup.addListener(() => {
  autoSync().catch((error) => console.warn("Psalms Way: sync at startup failed", error));
});
