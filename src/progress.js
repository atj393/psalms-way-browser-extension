// ─── Progress ─────────────────────────────────────────────────────────────────
// Wave 0 stub; Task 7 adds the streak, stats, badges and challenges.

import { byId } from "./dom.js";

/** Records today's visit (streak, badges). Called once per popup open. */
export async function recordVisit(_now = new Date()) {}

export async function renderProgress(_options) {
  byId("progressBody")?.replaceChildren();
}
