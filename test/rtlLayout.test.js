// ─── Right-to-left layout ─────────────────────────────────────────────────────
// A script-free scan of the stylesheets. With <html dir="rtl"> a rule that says
// "left" or "right" does not move, so a verse number would sit on the wrong
// side and a marker would land on the text. Layout is written with logical
// properties (start, end, inline) so one rule serves both directions; the few
// icons that point somewhere are flipped by an explicit :root[dir="rtl"] rule.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Vitest runs from the project root.
const root = process.cwd();
const sheets = [
  "style.css",
  ...readdirSync(resolve(root, "styles"))
    .filter((name) => name.endsWith(".css"))
    .map((name) => join("styles", name)),
].map((path) => ({
  path,
  css: readFileSync(resolve(root, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
}));

/** Every `selector { declarations }` pair, one level deep (media queries are flattened). */
function declarations(css) {
  const out = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const line of match[2].split(";")) {
      const [property, ...rest] = line.split(":");
      if (property.trim() && rest.length > 0) {
        out.push({
          selector: match[1].trim().replace(/\s+/g, " "),
          property: property.trim(),
          value: rest.join(":").trim(),
        });
      }
    }
  }
  return out;
}

const all = sheets.flatMap(({ path, css }) =>
  declarations(css).map((declaration) => ({ path, ...declaration }))
);
const describeAt = ({ path, selector, property, value }) =>
  `${path}: ${selector} { ${property}: ${value} }`;

describe("the stylesheets", () => {
  it("find their declarations (the scan itself works)", () => {
    expect(all.length).toBeGreaterThan(500);
    expect(all.some((d) => d.property === "margin-inline-end")).toBe(true);
  });

  it("use no left or right in a property name", () => {
    const physical = all.filter(
      ({ property }) =>
        /^(left|right)$/.test(property) ||
        /^(margin|padding|border|scroll-margin|scroll-padding)-(left|right)/.test(property) ||
        /^border-(top|bottom)-(left|right)-radius$/.test(property)
    );
    expect(physical.map(describeAt)).toEqual([]);
  });

  it("align text to the start or end, never to a side", () => {
    const aligned = all.filter(
      ({ property, value }) =>
        (property === "text-align" || property === "float" || property === "clear") &&
        /\b(left|right)\b/.test(value)
    );
    expect(aligned.map(describeAt)).toEqual([]);
  });

  it("give a pill or panel the same rounding on both sides, or write it per logical corner", () => {
    const lopsided = all.filter(({ property, value }) => {
      if (property !== "border-radius") return false;
      const parts = value.split(/\s+/);
      if (parts.length === 2) return parts[0] !== parts[1];
      if (parts.length === 4) return parts[0] !== parts[1] || parts[2] !== parts[3];
      return parts.length === 3;
    });
    expect(lopsided.map(describeAt)).toEqual([]);
  });

  it("give padding and margins the same inline space on both sides, or write each logically", () => {
    const lopsided = all.filter(({ property, value }) => {
      if (!/^(padding|margin)$/.test(property)) return false;
      const parts = value.split(/\s+/);
      return parts.length === 4 && parts[1] !== parts[3];
    });
    expect(lopsided.map(describeAt)).toEqual([]);
  });

  it("do not slide or turn anything sideways without a right-to-left rule", () => {
    const sideways = all.filter(
      ({ property, value }) =>
        property === "transform" && /translateX|translate\(|rotate\(-?90/.test(value)
    );
    // The toolbar toggle turns a quarter when collapsed; its right-to-left twin turns the other way.
    for (const declaration of sideways) {
      expect(declaration.selector, describeAt(declaration)).toMatch(/btn-toolbar-toggle/);
    }
    const css = sheets.map((sheet) => sheet.css).join("\n");
    expect(css).toMatch(/:root\[dir="rtl"\][^{]*btn-toolbar-toggle[^{]*\{[^}]*rotate\(90deg\)/);
  });
});

describe("the arrows", () => {
  const css = sheets.map((sheet) => sheet.css).join("\n");
  const flipped = (selector) =>
    new RegExp(
      `:root\\[dir="rtl"\\][^{}]*${selector}[^{}]*\\{[^}]*transform:\\s*scaleX\\(-1\\)`
    ).test(css);

  it("flip the previous and next Psalm arrows", () => {
    expect(flipped("#btnPrev")).toBe(true);
    expect(flipped("#btnNext")).toBe(true);
  });

  it("flip the chevrons in Prayers (the rows and Back), as Progress already does", () => {
    expect(flipped("prayer-row")).toBe(true);
    expect(flipped("prayer-back")).toBe(true);
    expect(flipped("progress-back")).toBe(true);
  });
});

describe("the tab strip", () => {
  const css = sheets.map((sheet) => sheet.css).join("\n");

  it("lets long translations wrap or shrink rather than scroll", () => {
    const tabs = all.filter(({ selector }) => selector === ".tabs");
    expect(tabs.some(({ property, value }) => property === "overflow-x" && value === "auto")).toBe(
      false
    );
    expect(css).toMatch(/\.tab\s*\{[^}]*min-width:\s*0/);
    expect(css).not.toMatch(/\.tab\s*\{[^}]*white-space:\s*nowrap/);
  });
});
