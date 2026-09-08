// ─── Icons ────────────────────────────────────────────────────────────────────
// One definition per icon, built with DOM calls rather than innerHTML.
//
// The previous code pasted the same heart SVG string into five places and
// rebuilt it through innerHTML on every toggle. Keeping the path data in one
// table means an icon change happens once, and nothing in the extension assigns
// markup to innerHTML.

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Path data for each icon, in a 24x24 viewBox unless noted.
 * `filled` icons paint with currentColor instead of stroking.
 */
const ICONS = {
  calendar: {
    paths: ["M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M16 2v4", "M8 2v4", "M3 10h18"],
    dots: [[8, 15], [12, 15], [16, 15]],
  },
  search: { paths: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M21 21l-4.35-4.35"] },
  heart: {
    paths: [
      "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
    ],
  },
  clock: { paths: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 3"] },
  settings: { paths: ["M4 6h16", "M4 12h16", "M4 18h16"], dots: [[9, 6], [15, 12], [9, 18]], hollowDots: true },
  library: {
    paths: [
      "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z",
      "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
    ],
  },
  copy: { paths: ["M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"] },
  note: { paths: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"] },
  close: { paths: ["M18 6L6 18", "M6 6l12 12"] },
  chevronLeft: { paths: ["M15 4l-7 8 7 8"] },
  chevronRight: { paths: ["M9 4l7 8-7 8"] },
  chevronDown: { paths: ["M4 8l8 8 8-8"] },
  check: { paths: ["M20 6L9 17l-5-5"] },
  trash: { paths: ["M3 6h18", "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"] },
  download: { paths: ["M12 3v12", "M7 11l5 5 5-5", "M4 21h16"] },
  upload: { paths: ["M12 21V9", "M7 13l5-5 5 5", "M4 3h16"] },
  alert: { paths: ["M12 3l9 16H3z", "M12 10v4"], dots: [[12, 16]] },
};

/**
 * Build an icon element.
 * @param {keyof typeof ICONS} name
 * @param {{size?: number, filled?: boolean}} [options]
 * @returns {SVGSVGElement}
 */
export function icon(name, { size = 18, filled = false } = {}) {
  const spec = ICONS[name];
  if (!spec) throw new Error(`Unknown icon: ${name}`);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", filled ? "currentColor" : "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  for (const d of spec.paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  for (const [cx, cy] of spec.dots ?? []) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", spec.hollowDots ? "2" : "1");
    circle.setAttribute("fill", spec.hollowDots ? "var(--bg)" : "currentColor");
    if (!spec.hollowDots) circle.setAttribute("stroke", "none");
    svg.appendChild(circle);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(ICONS);
