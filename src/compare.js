// ─── Compare ──────────────────────────────────────────────────────────────────
// Wave 0 stub; Task 5 shows the verse in three versions.

import { byId, el } from "./dom.js";
import { formatReference } from "./data.js";

export async function renderCompare({ chapterIndex, verseIndex }) {
  byId("compareBody")?.replaceChildren(
    el("p", { class: "settings-hint", text: formatReference(chapterIndex, verseIndex ?? 0) })
  );
}
