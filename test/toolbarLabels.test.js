// @vitest-environment jsdom
// Toolbar labels in long languages: a word too wide for its button is drawn a
// little smaller until it fits on one line, rather than being broken mid-word
// ("Einstell-ungen"). Only when even the smallest size is too wide may it break.
import { describe, it, expect } from "vitest";
import { fitTopRowText } from "../src/settings.js";

/**
 * A toolbar label whose text is `perPixel` × font size wide, in a button 58 px
 * wide. jsdom does no layout, so the widths are stood in for.
 */
function label(perPixel) {
  const node = document.createElement("span");
  node.className = "btn-tool-label";
  Object.defineProperty(node, "clientWidth", { get: () => 58 });
  Object.defineProperty(node, "scrollWidth", {
    configurable: true,
    get: () => Math.round(perPixel * parseFloat(node.style.fontSize || "10")),
  });
  document.body.append(node);
  return node;
}

/** One Verse / New Chapter: `perPixel` × font size wide in a 100 px box. */
function headerButton(perPixel) {
  if (!document.getElementById("sizes")) {
    // The stylesheet's sizes, for getComputedStyle.
    const sizes = document.createElement("style");
    sizes.id = "sizes";
    sizes.textContent = ".header-actions .button { font-size: 12px; }";
    document.head.append(sizes);
  }
  let actions = document.querySelector(".header-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "header-actions";
    document.body.append(actions);
  }
  const node = document.createElement("button");
  node.className = "button";
  Object.defineProperty(node, "clientWidth", { get: () => 100 });
  Object.defineProperty(node, "scrollWidth", {
    get: () => Math.round(perPixel * parseFloat(node.style.fontSize || "12")),
  });
  actions.append(node);
  return node;
}

describe("fitting the header buttons", () => {
  it("draws both smaller together, so they keep one size", () => {
    document.body.replaceChildren();
    const verse = headerButton(8); // fits at 12 px
    const chapter = headerButton(10); // 120 px at 12, 100 at 10
    fitTopRowText();
    expect(chapter.style.fontSize).toBe("10px");
    expect(verse.style.fontSize).toBe("10px");
  });

  it("stops at 10 px and leaves the rest to the ellipsis", () => {
    document.body.replaceChildren();
    const long = headerButton(14);
    fitTopRowText();
    expect(long.style.fontSize).toBe("10px");
  });
});

describe("letting the title give way", () => {
  /**
   * The title at the stylesheet's 14 px and one header button `perPixel` × font size wide,
   * in a box that is 90 px wide and gains 5 px for each pixel the title gives up.
   */
  function header(perPixel) {
    document.body.replaceChildren();
    if (!document.getElementById("titleSize")) {
      const sizes = document.createElement("style");
      sizes.id = "titleSize";
      sizes.textContent =
        ".title { font-size: 14px; } .header-actions .button { font-size: 12px; }";
      document.head.append(sizes);
    }
    const title = Object.assign(document.createElement("h1"), { className: "title" });
    const actions = Object.assign(document.createElement("div"), { className: "header-actions" });
    const button = Object.assign(document.createElement("button"), { className: "button" });
    const titlePx = () => parseFloat(title.style.fontSize || "14");
    Object.defineProperty(button, "clientWidth", { get: () => 90 + (14 - titlePx()) * 5 });
    Object.defineProperty(button, "scrollWidth", {
      configurable: true,
      get: () => Math.round(perPixel * parseFloat(button.style.fontSize || "12")),
    });
    actions.append(button);
    const row = Object.assign(document.createElement("header"), { className: "header" });
    row.append(title, actions);
    document.body.append(row);
    return { title, button };
  }

  it("leaves the title alone while the buttons fit at 10 px", () => {
    const { title, button } = header(9); // 90 px at 10 px
    fitTopRowText();
    expect(button.style.fontSize).toBe("10px");
    expect(title.style.fontSize).toBe("");
  });

  it("draws the title smaller, only as far as the buttons need, once they are at 10 px", () => {
    const { title, button } = header(9.5); // 95 px at 10 px: the title gives up 1 px
    fitTopRowText();
    expect(button.style.fontSize).toBe("10px");
    expect(title.style.fontSize).toBe("13px");
  });

  it("stops the title at 12 px and leaves the rest to the ellipsis", () => {
    const { title } = header(12);
    fitTopRowText();
    expect(title.style.fontSize).toBe("12px");
  });

  it("starts the title again from the stylesheet's size", () => {
    const { title, button } = header(12);
    fitTopRowText();
    Object.defineProperty(button, "scrollWidth", { get: () => 40 });
    fitTopRowText();
    expect(title.style.fontSize).toBe("");
  });
});

describe("fitting toolbar labels", () => {
  it("leaves a label that fits as it is", () => {
    document.body.replaceChildren();
    const short = label(4);
    fitTopRowText();
    expect(short.style.fontSize).toBe("");
    expect(short.classList.contains("is-tight")).toBe(false);
  });

  it("draws a long word smaller, only as far as it needs", () => {
    document.body.replaceChildren();
    const long = label(7); // 70 px at 10 px, 59.5 at 8.5, 56 at 8
    fitTopRowText();
    expect(long.style.fontSize).toBe("8px");
    expect(long.classList.contains("is-tight")).toBe(false);
  });

  it("lets a word break only when even the smallest size is too wide", () => {
    document.body.replaceChildren();
    const longest = label(9); // 72 px at 8 px
    fitTopRowText();
    expect(longest.style.fontSize).toBe("8px");
    expect(longest.classList.contains("is-tight")).toBe(true);
  });

  it("starts again from the stylesheet's size, for a new language", () => {
    document.body.replaceChildren();
    const node = label(7);
    fitTopRowText();
    Object.defineProperty(node, "scrollWidth", { get: () => 40 });
    fitTopRowText();
    expect(node.style.fontSize).toBe("");
    expect(node.classList.contains("is-tight")).toBe(false);
  });
});
