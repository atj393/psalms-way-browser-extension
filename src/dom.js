// ─── DOM helpers ──────────────────────────────────────────────────────────────
// Element construction, the status/error surface, and the confirmation dialog.
//
// Nothing here assigns innerHTML. Every string that reaches the document goes
// through textContent or a text node, so a note, a search query or a restored
// backup cannot introduce markup.

import { icon } from "./icons.js";

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [props] `class`, `text`, `aria-*`, `data-*`, `on*` handlers, and plain attributes
 * @param {Array<Node|string>} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") throw new Error("el() does not accept raw HTML");
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/** An icon-only button, with the accessible name callers keep forgetting. */
export function iconButton(iconName, label, { className = "btn-icon-only", size = 18, filled = false, onClick } = {}) {
  return el(
    "button",
    {
      type: "button",
      class: className,
      title: label,
      "aria-label": label,
      onClick,
    },
    [icon(iconName, { size, filled })]
  );
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function byId(id) {
  return document.getElementById(id);
}

// ─── Status messages ──────────────────────────────────────────────────────────

let toastTimer = null;

/**
 * Show a short message.
 *
 * Announced through a live region so it reaches a screen reader, and never
 * carries a stack trace: technical detail goes to the console instead.
 *
 * @param {string} message
 * @param {"info"|"error"|"success"} [tone]
 */
export function toast(message, tone = "info") {
  const host = byId("statusBar");
  if (!host) return;

  host.replaceChildren(
    el("span", { class: `status-message status-${tone}` }, [
      tone === "error" ? icon("alert", { size: 14 }) : icon("check", { size: 14 }),
      el("span", { text: message }),
    ])
  );
  host.hidden = false;
  // Errors are assertive; routine confirmations should not interrupt.
  host.setAttribute("role", tone === "error" ? "alert" : "status");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    host.replaceChildren();
    host.hidden = true;
  }, tone === "error" ? 6000 : 2600);
}

/**
 * Report a caught error to the user without leaking internals.
 * The original is logged for anyone with the console open.
 */
export function reportError(error, fallbackMessage) {
  console.error("Psalms Way:", error);
  const message =
    error && typeof error.message === "string" && error.name !== "TypeError"
      ? error.message
      : fallbackMessage;
  toast(message || "Something went wrong.", "error");
}

// ─── Focus management ─────────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableWithin(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (node) => node.offsetParent !== null || node === document.activeElement
  );
}

/** Move focus to the first sensible target inside a panel. */
export function focusFirst(root) {
  const preferred = root.querySelector("[data-autofocus]");
  const target = preferred ?? focusableWithin(root)[0] ?? root;
  if (target instanceof HTMLElement) {
    if (!target.hasAttribute("tabindex") && !focusableWithin(root).includes(target)) {
      target.setAttribute("tabindex", "-1");
    }
    target.focus();
  }
}

// ─── Confirmation dialog ──────────────────────────────────────────────────────

/**
 * A modal confirmation.
 *
 * Replaces window.confirm(), which cannot be themed, cannot be reached
 * consistently by assistive technology inside an extension popup, and blocks
 * the whole renderer. This one traps focus, closes on Escape, and restores
 * focus to whatever opened it.
 *
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const host = byId("dialogHost");
    if (!host) {
      resolve(false);
      return;
    }

    const confirmBtn = el("button", {
      type: "button",
      class: `button ${destructive ? "button-danger" : ""}`.trim(),
      text: confirmLabel,
    });
    const cancelBtn = el("button", { type: "button", class: "button button-quiet", text: cancelLabel });

    const dialog = el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "dialogTitle" }, [
      el("h2", { class: "dialog-title", id: "dialogTitle", text: title }),
      message ? el("p", { class: "dialog-message", text: message }) : null,
      el("div", { class: "dialog-actions" }, [cancelBtn, confirmBtn]),
    ]);

    const backdrop = el("div", { class: "dialog-backdrop" }, [dialog]);

    function close(result) {
      host.replaceChildren();
      host.hidden = true;
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      resolve(result);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(false);
        return;
      }
      if (event.key !== "Tab") return;
      // Keep Tab inside the dialog.
      const focusables = focusableWithin(dialog);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    confirmBtn.addEventListener("click", () => close(true));
    cancelBtn.addEventListener("click", () => close(false));
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKeyDown, true);

    host.replaceChildren(backdrop);
    host.hidden = false;
    confirmBtn.focus();
  });
}

/** Standard empty-state block. */
export function emptyState(message, hint) {
  return el("div", { class: "panel-empty" }, [
    el("p", { class: "panel-empty-title", text: message }),
    hint ? el("p", { class: "panel-empty-hint", text: hint }) : null,
  ]);
}
