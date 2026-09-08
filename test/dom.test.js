// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  el,
  toast,
  reportError,
  confirmDialog,
  emptyState,
  hydrateIcons,
  focusFirst,
} from "../src/dom.js";
import { icon, ICON_NAMES } from "../src/icons.js";

beforeEach(() => {
  document.body.innerHTML = `
    <div class="status-bar" id="statusBar" hidden></div>
    <div id="dialogHost" hidden></div>
  `;
});

describe("el", () => {
  it("sets text as text, never as markup", () => {
    const node = el("p", { text: "<b>not bold</b>" });
    expect(node.textContent).toBe("<b>not bold</b>");
    expect(node.querySelector("b")).toBeNull();
    expect(node.children).toHaveLength(0);
  });

  it("appends string children as text nodes", () => {
    const node = el("div", {}, ["<script>alert(1)</script>"]);
    expect(node.querySelector("script")).toBeNull();
    expect(node.textContent).toBe("<script>alert(1)</script>");
  });

  it("refuses a raw HTML property outright", () => {
    expect(() => el("div", { html: "<b>x</b>" })).toThrow(/does not accept raw HTML/);
  });

  it("sets classes, attributes, data and listeners", () => {
    const onClick = vi.fn();
    const node = el("button", {
      class: "a b",
      "aria-pressed": "true",
      dataset: { tab: "notes" },
      onClick,
    });
    expect(node.className).toBe("a b");
    expect(node.getAttribute("aria-pressed")).toBe("true");
    expect(node.dataset.tab).toBe("notes");
    node.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("skips null, undefined and false values", () => {
    const node = el("div", { title: null, hidden: false, "data-x": undefined }, [null, undefined]);
    expect(node.hasAttribute("title")).toBe(false);
    expect(node.hasAttribute("hidden")).toBe(false);
    expect(node.childNodes).toHaveLength(0);
  });

  it("renders a boolean true attribute as a bare attribute", () => {
    expect(el("input", { required: true }).hasAttribute("required")).toBe(true);
  });
});

describe("icons", () => {
  it("builds every icon without markup parsing", () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(svg.querySelectorAll("path, circle").length).toBeGreaterThan(0);
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("throws on an unknown icon rather than rendering nothing", () => {
    expect(() => icon("not-an-icon")).toThrow(/Unknown icon/);
  });

  it("fills when asked", () => {
    expect(icon("heart", { filled: true }).getAttribute("fill")).toBe("currentColor");
    expect(icon("heart").getAttribute("fill")).toBe("none");
  });

  it("hydrates data-icon placeholders and clears them", () => {
    document.body.innerHTML += `<button id="b" data-icon="search" data-icon-size="16"><span>Label</span></button>`;
    hydrateIcons();
    const button = document.getElementById("b");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.hasAttribute("data-icon")).toBe(false);
    // The icon is inserted before the existing label.
    expect(button.firstElementChild.tagName.toLowerCase()).toBe("svg");
    expect(button.textContent).toBe("Label");
  });
});

describe("toast", () => {
  it("shows a message and marks errors assertive", () => {
    toast("Saved", "success");
    const bar = document.getElementById("statusBar");
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain("Saved");
    expect(bar.getAttribute("role")).toBe("status");

    toast("Broken", "error");
    expect(bar.getAttribute("role")).toBe("alert");
    expect(bar.textContent).toContain("Broken");
  });

  it("renders the message as text", () => {
    toast("<img src=x onerror=1>", "info");
    const bar = document.getElementById("statusBar");
    expect(bar.querySelector("img")).toBeNull();
    expect(bar.textContent).toContain("<img");
  });
});

describe("reportError", () => {
  it("shows the error's own message when it has a useful one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Your note could not be saved.");
    error.name = "StorageError";
    reportError(error, "fallback");
    expect(document.getElementById("statusBar").textContent).toContain(
      "Your note could not be saved."
    );
  });

  it("falls back for an internal error rather than leaking it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reportError(new TypeError("undefined is not a function"), "Something went wrong.");
    const text = document.getElementById("statusBar").textContent;
    expect(text).toContain("Something went wrong.");
    expect(text).not.toContain("undefined is not a function");
  });

  it("always logs the original for the console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    reportError(error, "fallback");
    expect(spy).toHaveBeenCalledWith("Psalms Way:", error);
  });
});

describe("confirmDialog", () => {
  it("resolves true on confirm and false on cancel", async () => {
    const confirmed = confirmDialog({ title: "Delete?", confirmLabel: "Delete" });
    document.querySelector(".dialog-actions .button:last-child").click();
    expect(await confirmed).toBe(true);

    const cancelled = confirmDialog({ title: "Delete?" });
    document.querySelector(".dialog-actions .button-quiet").click();
    expect(await cancelled).toBe(false);
  });

  it("focuses the confirm button and restores focus afterwards", async () => {
    const opener = el("button", { text: "open" });
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const pending = confirmDialog({ title: "Clear history?" });
    expect(document.activeElement.textContent).toBe("Confirm");

    document.querySelector(".dialog-actions .button-quiet").click();
    await pending;
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape without confirming", async () => {
    const pending = confirmDialog({ title: "Delete?" });
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await pending).toBe(false);
    expect(document.getElementById("dialogHost").hidden).toBe(true);
  });

  it("keeps Tab inside the dialog", async () => {
    const pending = confirmDialog({ title: "Delete?", message: "Sure?" });
    const buttons = document.querySelectorAll(".dialog-actions button");
    const [cancel, confirm] = buttons;

    confirm.focus();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(cancel);

    document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })
    );
    expect(document.activeElement).toBe(confirm);

    cancel.click();
    await pending;
  });

  it("renders title and message as text", async () => {
    const pending = confirmDialog({ title: "<b>T</b>", message: "<i>M</i>" });
    const dialog = document.querySelector(".dialog");
    expect(dialog.querySelector("b")).toBeNull();
    expect(dialog.querySelector("i")).toBeNull();
    document.querySelector(".dialog-actions .button-quiet").click();
    await pending;
  });

  it("is marked as a modal dialog", async () => {
    const pending = confirmDialog({ title: "Delete?" });
    const dialog = document.querySelector(".dialog");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("dialogTitle");
    document.querySelector(".dialog-actions .button-quiet").click();
    await pending;
  });
});

describe("emptyState", () => {
  it("renders a title and an optional hint as text", () => {
    const node = emptyState("No notes yet", "Select a verse to add one.");
    expect(node.textContent).toContain("No notes yet");
    expect(node.textContent).toContain("Select a verse");
    expect(emptyState("Only a title").querySelectorAll("p")).toHaveLength(1);
  });
});

describe("focusFirst", () => {
  it("prefers an element marked data-autofocus", () => {
    const panel = el("div", {}, [
      el("button", { text: "first" }),
      el("input", { "data-autofocus": "" }),
    ]);
    document.body.appendChild(panel);
    focusFirst(panel);
    expect(document.activeElement.tagName.toLowerCase()).toBe("input");
  });
});
