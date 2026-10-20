// ─── Prayers ──────────────────────────────────────────────────────────────────
// Wave 0 stub; Task 6 shows the phone app's prayers.

import { byId } from "./dom.js";

export async function renderPrayers(_options) {
  byId("prayersBody")?.replaceChildren();
}
