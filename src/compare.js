// ─── Compare ──────────────────────────────────────────────────────────────────
// One verse in three versions, one card each: the version being read, then two
// the reader picks. The picks are saved as `compareVersions`, so they are still
// there next time. The current version is changed from the header chip, so its
// card is not a select, and the two selects never offer it: it is already
// showing, and offering it again would only put the same text on the page twice.

import { byId, el, reportError } from "./dom.js";
import { formatReference } from "./data.js";
import { t } from "./i18n.js";
import { getSettings, updateSettings } from "./storage.js";
import { currentVersion, getVersionData, loadCatalogue } from "./versions.js";

const MISSING = "—";

// A pick can finish after a newer render has started (the reader steps through
// the select with the arrow keys); only the newest render may touch the page.
let latestRender = 0;

/**
 * Shows a verse in the current version and the two saved comparison versions.
 * @param {{ chapterIndex: number, verseIndex: number | null }} passage 0-based;
 *   a null verse means the first verse of the chapter
 */
export async function renderCompare({ chapterIndex, verseIndex }) {
  await draw(chapterIndex, verseIndex ?? 0, null);
}

async function draw(chapterIndex, verseIndex, focusSlot) {
  const body = byId("compareBody");
  if (!body) return;
  const render = ++latestRender;

  const [catalogue, settings] = await Promise.all([loadCatalogue(), getSettings()]);
  const current = currentVersion();
  const others = catalogue.filter((version) => version.module !== current);
  const picks = resolvePicks(settings.compareVersions, others);

  const modules = [current, ...picks];
  const results = await Promise.allSettled(
    modules.map((module) => verseIn(module, chapterIndex, verseIndex))
  );
  if (render !== latestRender) return;

  const metaOf = (module) =>
    catalogue.find((version) => version.module === module) ?? { module, name: module };
  const pickSelect = (module, slot) =>
    versionSelect(others, module, slot, (next) => {
      const compareVersions = [...picks];
      compareVersions[slot] = next;
      return choose(compareVersions, chapterIndex, verseIndex, slot);
    });

  const cards = [
    buildCard(
      metaOf(current),
      el("h3", { class: "compare-card-name", text: metaOf(current).name }),
      results[0]
    ),
    ...picks.map((module, slot) =>
      buildCard(metaOf(module), pickSelect(module, slot), results[slot + 1])
    ),
  ];
  for (const result of results) {
    if (result.status === "rejected") reportError(result.reason, loadFailedText());
  }

  body.replaceChildren(
    el("div", { class: "compare" }, [
      el("p", { class: "compare-reference", text: formatReference(chapterIndex, verseIndex) }),
      el("div", { class: "compare-cards" }, cards),
    ])
  );
  if (focusSlot !== null) body.querySelectorAll(".compare-select")[focusSlot]?.focus();
}

/**
 * The two comparison versions to show. A saved version that has gone from the
 * catalogue, or that is now the current version, is shown as the first other
 * version instead; the saved choice itself is left as it was.
 */
function resolvePicks(saved, others) {
  if (others.length === 0) return [];
  return saved.map((module) =>
    others.some((version) => version.module === module) ? module : others[0].module
  );
}

/** The verse's text in one version, or null when that version lacks it. */
async function verseIn(module, chapterIndex, verseIndex) {
  const chapters = await getVersionData(module);
  return chapters[chapterIndex]?.[verseIndex] || null;
}

const loadFailedText = () => t("compareVersionLoadFailed", {}, "This version could not be loaded.");

/** The two selects need names that tell them apart, for someone who cannot see which card is which. */
const slotLabel = (slot) =>
  slot === 0
    ? t("compareFirstVersion", {}, "First version")
    : t("compareSecondVersion", {}, "Second version");

function versionSelect(versions, chosen, slot, onPick) {
  return el(
    "select",
    {
      class: "select compare-select",
      "aria-label": slotLabel(slot),
      onChange: (event) => {
        onPick(event.target.value).catch((error) =>
          reportError(error, t("compareFailed", {}, "Compare could not be shown."))
        );
      },
    },
    versions.map((version) =>
      el("option", {
        value: version.module,
        text: version.name,
        selected: version.module === chosen,
      })
    )
  );
}

function buildCard(meta, header, result) {
  const text = result.status === "fulfilled" ? result.value : null;
  const note =
    result.status === "rejected"
      ? loadFailedText()
      : text === null
        ? t("compareNotInVersion", {}, "not in this version")
        : null;
  return el("article", { class: "compare-card" }, [
    el("div", { class: "compare-card-head" }, [header]),
    el("p", {
      class: "compare-text",
      text: text ?? MISSING,
      dir: meta.rtl ? "rtl" : "ltr",
      lang: meta.lang_short || undefined,
    }),
    note ? el("p", { class: "compare-note settings-hint", text: note }) : null,
  ]);
}

/**
 * Saves the picks, then draws again. A failed save is reported and the draw
 * still happens, so the selects go back to what is actually saved.
 */
async function choose(compareVersions, chapterIndex, verseIndex, focusSlot) {
  try {
    await updateSettings({ compareVersions });
  } catch (error) {
    reportError(error, t("compareSaveFailed", {}, "Your choice could not be saved."));
  }
  await draw(chapterIndex, verseIndex, focusSlot);
}
