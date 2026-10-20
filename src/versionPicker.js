// ─── Version picker ───────────────────────────────────────────────────────────
// Wave 0 stub; Task 1 builds the grouped, filterable list.

import { byId, el } from "./dom.js";
import { t } from "./i18n.js";

export async function renderVersionPicker({ onChosen: _onChosen } = {}) {
  byId("versionBody")?.replaceChildren(
    el("p", {
      class: "settings-hint",
      text: t("extVersionsComing", {}, "More versions are coming."),
    })
  );
}
