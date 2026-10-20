// ─── Sync panel ───────────────────────────────────────────────────────────────
// The popup's view of cloud sync with the phone app. Every sync itself runs in
// the background worker (cloudSync.js); this module only asks it to act and
// shows what happened. Optional: nothing here runs for a reader who never
// connects, and no request leaves the browser for them.

import { byId, confirmDialog, el, reportError, toast } from "./dom.js";
import { icon } from "./icons.js";
import { formatTimestamp } from "./dates.js";
import { dateLocale, t } from "./i18n.js";

const busyText = () => t("syncErrBusy", {}, "Google Drive is busy.");

/** The sentence for each problem the background worker reports, in the reader's language. */
const ERROR_TEXT = {
  network: () => t("syncErrNetwork", {}, "No internet connection."),
  quota: busyText,
  server: busyText,
  unknown: () => t("somethingWentWrong", {}, "Something went wrong."),
  "auth-expired": () => t("syncErrAuthExpired", {}, "Google needs you to sign in again."),
  "drive-full": () =>
    t(
      "syncErrDriveFull",
      {},
      "Your Google Drive is full. Free up space in your Google account and sync will continue."
    ),
  "incompatible-backup": () =>
    t(
      "syncErrIncompatible",
      {},
      "Your backup was made by a newer version of Psalms Way. Update this extension."
    ),
  "empty-local": () =>
    t("syncErrEmptyLocal", {}, "This browser has nothing saved, but your Google account does."),
};
const TRANSIENT = ["network", "quota", "server", "unknown"];

/** The sentence for a problem code, or `otherwise()` for a code with none. */
function errorText(code, otherwise) {
  return Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code]() : otherwise();
}

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
  if (Number.isNaN(ms)) return t("syncNotYet", {}, "Not yet");
  const time = new Intl.DateTimeFormat(dateLocale(), { hour: "numeric", minute: "2-digit" }).format(
    ms
  );
  return t("syncDateAtTime", { date: formatTimestamp(ms), time }, "{{date}} at {{time}}");
}

/** The status last painted on the header button, so a change of language can paint it again. */
let lastStatus = null;

/**
 * Paints the header button: off, synced, or needs attention. It has no visible text, so
 * the tooltip and the accessible name are the same sentence and both follow the state.
 */
export function paintCloudButton(status) {
  lastStatus = status;
  const button = byId("btnCloud");
  if (!button) return;
  const name = { ok: "cloudCheck", attention: "cloudAlert" }[status?.icon] ?? "cloudOff";
  // An icon-only button in the header.
  button.replaceChildren(icon(name, { size: 18 }));
  button.classList.toggle("needs-attention", status?.icon === "attention");
  const label =
    status?.icon === "ok"
      ? t("syncedWithPhone", {}, "Synced with your phone")
      : status?.icon === "attention"
        ? t("syncNeedsAttention", {}, "Sync needs your attention")
        : t("syncWithPhone", {}, "Sync with your phone");
  button.title = label;
  button.setAttribute("aria-label", label);
}

/** Paints the button again with the state it last had, after the language changed. */
export function repaintCloudButton() {
  paintCloudButton(lastStatus);
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
    toast(
      errorText(result.code, () => t("syncErrFinish", {}, "Sync could not finish.")),
      "error"
    );
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
    reportError(error, t("syncSignInError", {}, "Google sign-in could not be started."));
    return;
  }
  if (!granted) {
    toast(
      t("syncPermissionNeeded", {}, "Psalms Way needs your permission to open Google sign-in."),
      "error"
    );
    return;
  }
  await act("connect", {
    working: t(
      "syncWaiting",
      {},
      "Waiting for Google… If this window closes, open Psalms Way again when you're done."
    ),
    done: (r) =>
      r.addedFromCloud > 0
        ? t(
            "syncConnectedAdded",
            { count: r.addedFromCloud },
            "Connected. {{count}} items came from your phone."
          )
        : t("syncConnected", {}, "Connected."),
  });
}

async function onSyncAnyway() {
  const confirmed = await confirmDialog({
    title: t("syncAnywayTitle", {}, "Sync this browser as it is?"),
    message: t(
      "syncAnywayMessage",
      {},
      "Your Google account will then hold only what this browser holds, which is nothing saved."
    ),
    confirmLabel: t("syncAnyway", {}, "Sync anyway"),
    destructive: true,
  });
  if (confirmed) {
    await act("syncAnyway", {
      working: t("syncSyncing", {}, "Syncing…"),
      done: () => t("syncDone", {}, "Synced."),
    });
  }
}

async function onDisconnect() {
  const confirmed = await confirmDialog({
    title: t("syncDisconnectTitle", {}, "Disconnect Google account?"),
    message: t(
      "syncDisconnectMessage",
      {},
      "This browser keeps everything it has, and your backup stays in Google Drive."
    ),
    confirmLabel: t("backupDisconnect", {}, "Disconnect"),
  });
  if (confirmed) {
    await act("disconnect", {
      working: t("syncDisconnecting", {}, "Disconnecting…"),
      done: () => t("syncDisconnected", {}, "Disconnected."),
    });
  }
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

/** Two or more buttons side by side, equal widths. */
function buttonRow(buttons) {
  return el("div", { class: "button-row" }, buttons);
}

function banner(text, role = "status") {
  return el("div", { class: "cloud-alert", role }, [
    icon("alert", { size: 16 }),
    el("span", { text }),
  ]);
}

/** The connected account: initial, email, and how the last sync went. */
function accountCard(status) {
  const failing = status.attention || status.lastError;
  const line = failing
    ? status.attention
      ? t("syncStatusAttention", {}, "Needs your attention")
      : t(
          "syncStatusRetry",
          { when: lastSyncedText(status.lastSyncAt) },
          "Will try again · last synced {{when}}"
        )
    : t("syncStatusOk", { when: lastSyncedText(status.lastSyncAt) }, "Synced · {{when}}");
  return el("div", { class: "cloud-card" }, [
    el("span", {
      class: "cloud-avatar",
      "aria-hidden": "true",
      text: (status.email[0] ?? "?").toUpperCase(),
    }),
    el("div", { class: "cloud-card-text" }, [
      el("p", { class: "cloud-account", text: status.email }),
      el("p", { class: `cloud-status ${failing ? "is-failing" : "is-ok"}` }, [
        icon(failing ? "alert" : "check", { size: 13 }),
        el("span", { text: line }),
      ]),
    ]),
  ]);
}

/** Renders the Sync panel from the background worker's status. */
export async function renderCloud({ working } = {}) {
  const body = byId("cloudBody");
  if (!body) return;
  const status = await sendCloud("status");
  paintCloudButton(status);

  const blocks = [];
  if (!status?.configured) {
    blocks.push(
      hint(t("syncUnavailable", {}, "Sync with the phone app is not available in this version."))
    );
  } else if (!status.email) {
    blocks.push(
      el("div", { class: "cloud-hero" }, [
        el("span", { class: "cloud-hero-icon" }, [icon("cloud", { size: 26 })]),
        el("p", {
          class: "cloud-hero-title",
          text: t("syncHeroTitle", {}, "Your Psalms Way on every device"),
        }),
        el("p", {
          class: "cloud-hero-text",
          text: t(
            "syncHeroText",
            {},
            "Sign in with the same Google account as the Psalms Way phone app, and your bookmarks, notes and history stay the same on both."
          ),
        }),
      ]),
      working
        ? hint(working)
        : buttonRow([
            button(
              t("syncConnect", {}, "Connect Google account"),
              onConnect,
              "button button-large"
            ),
          ]),
      el("p", {
        class: "settings-hint cloud-privacy",
        text: t(
          "syncPrivacy",
          {},
          "Saved in a private folder in your own Google Drive that only Psalms Way can see. We never receive your data. Optional: without it, everything stays on this browser."
        ),
      })
    );
  } else {
    blocks.push(accountCard(status));
    if (status.attention === "empty-local") {
      blocks.push(
        banner(ERROR_TEXT["empty-local"](), "alert"),
        buttonRow([
          button(
            t("syncRecover", {}, "Get my data back"),
            () =>
              act("recover", {
                working: t("syncRecovering", {}, "Bringing your data back…"),
                done: () => t("syncRecovered", {}, "Your data is back."),
              }),
            "button button-large"
          ),
          button(
            t("syncAnyway", {}, "Sync anyway"),
            onSyncAnyway,
            "button button-large button-quiet"
          ),
        ])
      );
    } else if (status.lastError) {
      const text = errorText(status.lastError, ERROR_TEXT.unknown);
      blocks.push(
        banner(
          TRANSIENT.includes(status.lastError)
            ? t("syncErrRetry", { text }, "{{text}} It will try again automatically.")
            : text
        )
      );
    }
    if (status.unreadableKeptAsideAt) {
      blocks.push(
        hint(
          t(
            "syncUnreadableAside",
            {},
            "A backup that could not be read was kept aside in your Google Drive."
          )
        )
      );
    }
    blocks.push(
      working
        ? hint(working)
        : buttonRow([
            status.attention === "reconnect" || status.lastError === "auth-expired"
              ? button(t("cloudReconnect", {}, "Reconnect"), onConnect, "button button-large")
              : button(
                  t("syncNow", {}, "Sync now"),
                  () =>
                    act("syncNow", {
                      working: t("syncSyncing", {}, "Syncing…"),
                      done: () => t("syncDone", {}, "Synced."),
                    }),
                  "button button-large"
                ),
            button(
              t("backupDisconnect", {}, "Disconnect"),
              onDisconnect,
              "button button-large button-quiet"
            ),
          ]),
      hint(t("syncWhen", {}, "Syncs when you open Psalms Way and a few seconds after each change."))
    );
  }
  body.replaceChildren(...blocks);
}
