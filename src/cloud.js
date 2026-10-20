// ─── Sync panel ───────────────────────────────────────────────────────────────
// The popup's view of cloud sync with the phone app. Every sync itself runs in
// the background worker (cloudSync.js); this module only asks it to act and
// shows what happened. Optional: nothing here runs for a reader who never
// connects, and no request leaves the browser for them.

import { byId, confirmDialog, el, reportError, toast } from "./dom.js";
import { icon } from "./icons.js";
import { formatTimestamp } from "./dates.js";

const ERROR_TEXT = {
  network: "No internet connection.",
  quota: "Google Drive is busy.",
  server: "Google Drive is busy.",
  unknown: "Something went wrong.",
  "auth-expired": "Google needs you to sign in again.",
  "drive-full":
    "Your Google Drive is full. Free up space in your Google account and sync will continue.",
  "incompatible-backup":
    "Your backup was made by a newer version of Psalms Way. Update this extension.",
  "empty-local": "This browser has nothing saved, but your Google account does.",
};
const TRANSIENT = ["network", "quota", "server", "unknown"];

/** chrome.storage.local key of the sync state (cloudSync.js); read here only to notice changes. */
export const CLOUD_STATE_KEY = "cloudSync";

/** Asks the background worker to run a cloud command. */
export async function sendCloud(cmd) {
  try {
    return await chrome.runtime.sendMessage({ cmd });
  } catch (error) {
    return { ok: false, code: "unknown", detail: String(error?.message ?? error) };
  }
}

function lastSyncedText(iso) {
  const ms = Date.parse(iso ?? "");
  if (Number.isNaN(ms)) return "Not yet";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    ms
  );
  return `${formatTimestamp(ms)} at ${time}`;
}

/** Paints the toolbar button: off, synced, or needs attention. */
export function paintCloudButton(status) {
  const button = byId("btnCloud");
  if (!button) return;
  const name = { ok: "cloudCheck", attention: "cloudAlert" }[status?.icon] ?? "cloudOff";
  const label = byId("btnCloudLabel");
  button.replaceChildren(
    icon(name),
    label ?? el("span", { class: "btn-tool-label", text: "Sync" })
  );
  button.classList.toggle("needs-attention", status?.icon === "attention");
  button.title =
    status?.icon === "ok"
      ? "Synced with your phone"
      : status?.icon === "attention"
        ? "Sync needs your attention"
        : "Sync with your phone";
}

let busy = false;

async function act(cmd, { working, done }) {
  if (busy) return;
  busy = true;
  await renderCloud({ working });
  const result = await sendCloud(cmd);
  busy = false;
  if (result?.ok && done) toast(done(result), "success");
  else if (result && !result.ok && result.code !== "cancelled" && result.code !== "empty-local") {
    toast(ERROR_TEXT[result.code] ?? "Sync could not finish.", "error");
  }
  await renderCloud();
}

async function onConnect() {
  let granted = false;
  try {
    // Asked only now, on the reader's click, so installing or updating the
    // extension never asks for it.
    granted = await chrome.permissions.request({ permissions: ["identity"] });
  } catch (error) {
    reportError(error, "Google sign-in could not be started.");
    return;
  }
  if (!granted) {
    toast("Psalms Way needs your permission to open Google sign-in.", "error");
    return;
  }
  await act("connect", {
    working: "Waiting for Google… If this window closes, open Psalms Way again when you're done.",
    done: (r) =>
      r.addedFromCloud > 0
        ? `Connected. ${r.addedFromCloud} items came from your phone.`
        : "Connected.",
  });
}

async function onSyncAnyway() {
  const confirmed = await confirmDialog({
    title: "Sync this browser as it is?",
    message:
      "Your Google account will then hold only what this browser holds, which is nothing saved.",
    confirmLabel: "Sync anyway",
    destructive: true,
  });
  if (confirmed) await act("syncAnyway", { working: "Syncing…", done: () => "Synced." });
}

async function onDisconnect() {
  const confirmed = await confirmDialog({
    title: "Disconnect Google account?",
    message: "This browser keeps everything it has, and your backup stays in Google Drive.",
    confirmLabel: "Disconnect",
  });
  if (confirmed)
    await act("disconnect", { working: "Disconnecting…", done: () => "Disconnected." });
}

/** The sync state changed (a background run finished): repaint, unless an action is showing progress. */
export async function refreshCloud({ panelOpen }) {
  if (busy) return;
  if (panelOpen) await renderCloud();
  else paintCloudButton(await sendCloud("status"));
}

function button(text, onClick, variant = "button") {
  const node = el("button", { type: "button", class: variant, text });
  node.addEventListener("click", onClick);
  return node;
}

function hint(text) {
  return el("p", { class: "settings-hint", text });
}

/** Renders the Sync panel from the background worker's status. */
export async function renderCloud({ working } = {}) {
  const body = byId("cloudBody");
  if (!body) return;
  const status = await sendCloud("status");
  paintCloudButton(status);

  const blocks = [];
  if (!status?.configured) {
    blocks.push(hint("Sync with the phone app is not available in this version."));
  } else if (!status.email) {
    blocks.push(
      hint(
        "Sign in with the same Google account as the Psalms Way phone app to keep your bookmarks, notes and history the same on both."
      ),
      hint(
        "Saved in a private folder in your own Google Drive that only Psalms Way can see. We never receive your data. Optional: without it, everything stays on this browser."
      ),
      working ? hint(working) : button("Connect Google account", onConnect)
    );
  } else {
    blocks.push(
      el("p", { class: "cloud-account", text: `Connected as ${status.email}` }),
      hint(`Last synced: ${lastSyncedText(status.lastSyncAt)}`),
      hint("Syncs when you open Psalms Way and shortly after each change.")
    );
    if (status.attention === "empty-local") {
      blocks.push(
        el("p", { class: "cloud-alert", role: "alert", text: ERROR_TEXT["empty-local"] }),
        el("div", { class: "settings-controls settings-controls-wide" }, [
          button("Get my data back", () =>
            act("recover", {
              working: "Bringing your data back…",
              done: () => "Your data is back.",
            })
          ),
          button("Sync anyway", onSyncAnyway, "button button-quiet"),
        ])
      );
    } else if (status.lastError) {
      const text = ERROR_TEXT[status.lastError] ?? ERROR_TEXT.unknown;
      const suffix = TRANSIENT.includes(status.lastError)
        ? " It will try again automatically."
        : "";
      blocks.push(el("p", { class: "cloud-alert", role: "status", text: `${text}${suffix}` }));
    }
    if (status.unreadableKeptAsideAt) {
      blocks.push(hint("A backup that could not be read was kept aside in your Google Drive."));
    }
    const controls = working
      ? [hint(working)]
      : [
          status.attention === "reconnect" || status.lastError === "auth-expired"
            ? button("Reconnect", onConnect)
            : button("Sync now", () =>
                act("syncNow", { working: "Syncing…", done: () => "Synced." })
              ),
          button("Disconnect", onDisconnect, "button button-quiet"),
        ];
    blocks.push(el("div", { class: "settings-controls settings-controls-wide" }, controls));
  }
  body.replaceChildren(...blocks);
}
