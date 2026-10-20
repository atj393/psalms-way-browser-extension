// ─── Today ────────────────────────────────────────────────────────────────────
// Wave 0 stub: the Today button still opens Today's Psalm. Task 4 turns it
// into a panel with the verse of the day.

import { getDailyChapterIndex } from "./dates.js";

/** Called by the Today button. `showPanel` opens todayPanel; `navigate` opens a passage. */
export async function openToday({ navigate, showPanel: _showPanel }) {
  await navigate({ chapterIndex: getDailyChapterIndex() });
}

export async function renderToday(_options) {}
