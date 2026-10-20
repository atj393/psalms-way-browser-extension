// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installChromeMock } from "./chrome-mock.js";
import * as store from "../src/storage.js";
import { applyAccent, applyTheme, initAppearance, paintSettingsControls } from "../src/settings.js";

const root = () => document.documentElement;
// Vitest runs from the project root.
const readProject = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

/** The real popup markup, so the tests also prove the buttons they rely on exist. */
function loadPopupMarkup() {
  const parsed = new DOMParser().parseFromString(readProject("popup.html"), "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
}

/**
 * A system colour scheme the test can flip. It keeps the registered listeners,
 * so a test can prove they are removed and never pile up.
 */
function fakeSystemScheme(initiallyDark) {
  const listeners = new Set();
  const query = {
    matches: initiallyDark,
    addEventListener: (type, listener) => {
      if (type === "change") listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "change") listeners.delete(listener);
    },
  };
  window.matchMedia = vi.fn(() => query);
  return {
    listeners,
    setDark(dark) {
      query.matches = dark;
      for (const listener of [...listeners]) listener({ matches: dark });
    },
  };
}

beforeEach(() => {
  store.resetStoreCache();
  loadPopupMarkup();
  root().removeAttribute("data-theme");
  root().removeAttribute("data-accent");
});

afterEach(() => {
  // Drop any system-scheme listener a test left behind, then the fake itself.
  applyTheme("light");
  delete window.matchMedia;
});

describe("applyTheme", () => {
  it.each(["light", "sepia", "dark"])("sets the %s theme as it is", (theme) => {
    applyTheme(theme);
    expect(root().getAttribute("data-theme")).toBe(theme);
  });

  it("falls back to light for a theme it does not know", () => {
    applyTheme("neon");
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("resolves auto to dark when the system prefers dark", () => {
    const system = fakeSystemScheme(true);
    applyTheme("auto");
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(system.listeners.size).toBe(1);
  });

  it("resolves auto to light when the system prefers light", () => {
    fakeSystemScheme(false);
    applyTheme("auto");
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("follows the system while auto is chosen", () => {
    const system = fakeSystemScheme(false);
    applyTheme("auto");

    system.setDark(true);
    expect(root().getAttribute("data-theme")).toBe("dark");

    system.setDark(false);
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("stops following the system once another theme is chosen", () => {
    const system = fakeSystemScheme(false);
    applyTheme("auto");
    applyTheme("sepia");

    expect(system.listeners.size).toBe(0);
    system.setDark(true);
    expect(root().getAttribute("data-theme")).toBe("sepia");
  });

  it("keeps a single listener when auto is chosen again", () => {
    const system = fakeSystemScheme(false);
    applyTheme("auto");
    applyTheme("auto");
    expect(system.listeners.size).toBe(1);
  });
});

describe("applyAccent", () => {
  it.each(store.ACCENTS)("sets the %s accent on the document", (accent) => {
    applyAccent(accent);
    expect(root().getAttribute("data-accent")).toBe(accent);
  });

  it.each([undefined, null, "", "teal", 7])("falls back to green for %j", (accent) => {
    applyAccent("blue");
    applyAccent(accent);
    expect(root().getAttribute("data-accent")).toBe("green");
  });
});

describe("paintSettingsControls", () => {
  const settings = { theme: "auto", fontSize: "medium", accent: "red" };
  const pressed = (selector) =>
    [...document.querySelectorAll(selector)]
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset.theme ?? button.dataset.accent);

  it("marks Auto pressed when the saved theme is auto", () => {
    paintSettingsControls(settings);
    expect(pressed(".theme-btn")).toEqual(["auto"]);
  });

  it("marks only the saved accent pressed", () => {
    paintSettingsControls(settings);
    expect(pressed(".accent-btn")).toEqual(["red"]);

    paintSettingsControls({ ...settings, accent: "purple" });
    expect(pressed(".accent-btn")).toEqual(["purple"]);
  });
});

describe("initAppearance", () => {
  it("applies the saved auto theme and accent, and marks both controls", async () => {
    installChromeMock({});
    await store.updateSettings({ theme: "auto", accent: "purple" });
    store.resetStoreCache();
    fakeSystemScheme(true);

    await initAppearance();

    expect(root().getAttribute("data-theme")).toBe("dark");
    expect(root().getAttribute("data-accent")).toBe("purple");
    expect(
      document.querySelector('.theme-btn[data-theme="auto"]').getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      document.querySelector('.accent-btn[data-accent="purple"]').getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("applies an accent when its button is clicked, then saves it", async () => {
    const local = installChromeMock({});
    await initAppearance();

    document.querySelector('#accentControls .accent-btn[data-accent="blue"]').click();

    // Applied at once, before the write finishes.
    expect(root().getAttribute("data-accent")).toBe("blue");
    await vi.waitFor(() => expect(local.data[store.STORE_KEY].settings.accent).toBe("blue"));
    expect(
      document.querySelector('.accent-btn[data-accent="blue"]').getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      document.querySelector('.accent-btn[data-accent="green"]').getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("wires all five accent buttons", async () => {
    const local = installChromeMock({});
    await initAppearance();

    for (const accent of store.ACCENTS) {
      document.querySelector(`#accentControls .accent-btn[data-accent="${accent}"]`).click();
      await vi.waitFor(() => expect(local.data[store.STORE_KEY].settings.accent).toBe(accent));
      expect(root().getAttribute("data-accent")).toBe(accent);
    }
  });

  it("still applies the defaults, and the accent buttons still work, when settings cannot be read", async () => {
    const local = installChromeMock({});
    local.rejectNextGet();
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initAppearance();
    expect(root().getAttribute("data-theme")).toBe("light");
    expect(root().getAttribute("data-accent")).toBe("green");

    document.querySelector('.accent-btn[data-accent="amber"]').click();
    expect(root().getAttribute("data-accent")).toBe("amber");
    await vi.waitFor(() => expect(local.data[store.STORE_KEY].settings.accent).toBe("amber"));
  });
});

// ─── The colours themselves ───────────────────────────────────────────────────
// The CSS is where the accents live, so these read it as data: a mistyped hex
// would otherwise only show up as a button nobody can read.

/** The phone's primaries (theme/index.ts), light and dark. */
const PRIMARIES = {
  green: ["#3a6b38", "#9fd49c"],
  blue: ["#0057a8", "#adc6ff"],
  red: ["#9b1919", "#ffb4ab"],
  amber: ["#8b5000", "#ffb961"],
  purple: ["#6b3fa0", "#d4bbff"],
};

/** Selector (whitespace squeezed) to its declarations; later rules merge over earlier ones. */
function parseRules(css) {
  const rules = new Map();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = {};
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
    for (const selector of selectors.split(",")) {
      const key = selector.trim().replace(/\s+/g, " ");
      rules.set(key, { ...rules.get(key), ...declarations });
    }
  }
  return rules;
}

const base = parseRules(readProject("style.css"));
const accents = parseRules(readProject("styles/appearance.css"));

/** Green is the base palette in style.css; the other accents override it in appearance.css. */
function variablesFor(accent, theme) {
  if (accent === "green") return base.get(theme === "dark" ? ':root[data-theme="dark"]' : ":root");
  const selector = `:root[data-accent="${accent}"]`;
  return accents.get(theme === "dark" ? `${selector}[data-theme="dark"]` : selector);
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
/** 12% darker: each channel scaled by 0.88. */
const darker = (hex) => toHex(channels(hex).map((c) => c * 0.88));
/** 12% lighter: each channel moved 12% of the way to white. */
const lighter = (hex) => toHex(channels(hex).map((c) => c + (255 - c) * 0.12));
const rgba = (hex, alpha) => `rgba(${channels(hex).join(", ")}, ${alpha})`;

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe("accent colours in CSS", () => {
  const cases = store.ACCENTS.flatMap((accent) => [
    [accent, "light", PRIMARIES[accent][0]],
    [accent, "dark", PRIMARIES[accent][1]],
  ]);

  it("covers exactly the accents the store accepts", () => {
    expect(Object.keys(PRIMARIES)).toEqual(store.ACCENTS);
  });

  it.each(cases)("%s %s: brand is the phone's primary", (accent, theme, primary) => {
    expect(variablesFor(accent, theme)["--brand"]).toBe(primary);
  });

  it.each(cases)("%s %s: strong and soft follow from the primary", (accent, theme, primary) => {
    const variables = variablesFor(accent, theme);
    expect(variables["--brand-strong"]).toBe(theme === "dark" ? lighter(primary) : darker(primary));
    expect(variables["--brand-soft"]).toBe(rgba(primary, theme === "dark" ? 0.16 : 0.1));
  });

  it("uses white text on light and near-black text on dark", () => {
    expect(base.get(":root")["--brand-text"]).toBe("#ffffff");
    expect(base.get(':root[data-theme="dark"]')["--brand-text"]).toBe("#1b1b1a");
  });

  it.each(cases)("%s %s: button text on brand and on hover is readable", (accent, theme) => {
    const text = theme === "dark" ? "#1b1b1a" : "#ffffff";
    const variables = variablesFor(accent, theme);
    expect(contrast(text, variables["--brand"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, variables["--brand-strong"])).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves sepia its paper colours and gives it no brand of its own", () => {
    const sepia = base.get(':root[data-theme="sepia"]');
    expect(sepia["--bg"]).toBeDefined();
    expect(Object.keys(sepia).filter((name) => name.startsWith("--brand"))).toEqual([]);
  });

  it.each(store.ACCENTS)("%s: the swatch shows its light primary", (accent) => {
    const swatch = accents.get(`.accent-btn[data-accent="${accent}"]`);
    expect(swatch.background).toBe(PRIMARIES[accent][0]);
  });

  it("has a swatch button in the popup for every accent", () => {
    const found = [...document.querySelectorAll("#accentControls .accent-btn")].map(
      (button) => button.dataset.accent
    );
    expect(found).toEqual(store.ACCENTS);
    for (const button of document.querySelectorAll("#accentControls .accent-btn")) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  });
});
