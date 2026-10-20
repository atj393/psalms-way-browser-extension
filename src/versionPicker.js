// ─── Version picker ───────────────────────────────────────────────────────────
// The Bible version panel: a filter box above every version, grouped under its
// language. Choosing a row makes it the version being read (versions.js saves
// the choice) and tells the app, which repaints the header chip and the passage.

import { byId, el, emptyState, reportError } from "./dom.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";
import { currentVersion, loadCatalogue, setCurrentVersion } from "./versions.js";

/** Does the typed text appear in the version's name, language or module? */
function matches(version, query) {
  return [version.name, version.lang, version.module].some((text) =>
    text.toLowerCase().includes(query)
  );
}

/** [[language, versions]] in list order, except that `firstLanguage` comes first. */
function groupByLanguage(versions, firstLanguage) {
  const groups = new Map();
  for (const version of versions) {
    if (!groups.has(version.lang)) groups.set(version.lang, []);
    groups.get(version.lang).push(version);
  }
  const ordered = [...groups];
  const first = ordered.findIndex(([language]) => language === firstLanguage);
  if (first > 0) ordered.unshift(...ordered.splice(first, 1));
  return ordered;
}

function renderRow(version, isCurrent, onPick) {
  return el(
    "button",
    {
      type: "button",
      class: "version-row",
      dataset: { module: version.module },
      "aria-current": isCurrent ? "true" : null,
      onclick: () => onPick(version.module),
    },
    [
      el("span", { class: "version-text" }, [
        el("span", { class: "version-title" }, [
          // dir="auto" so a Hebrew or Arabic name reads from its own side.
          el("span", { class: "version-name", dir: "auto", text: version.name }),
          version.year ? el("span", { class: "version-year", text: version.year }) : null,
        ]),
        version.copyright
          ? el("span", { class: "version-credit", dir: "auto", text: version.copyright })
          : null,
      ]),
      isCurrent ? icon("check", { size: 16 }) : null,
    ]
  );
}

/**
 * Fills the version panel. Rejects when the list of versions cannot be loaded,
 * for the app to report.
 *
 * @param {{onChosen?: () => (void|Promise<void>)}} [options] `onChosen` runs once a
 *   version has been chosen and saved
 */
export async function renderVersionPicker({ onChosen } = {}) {
  const catalogue = await loadCatalogue();
  const current = currentVersion();
  const currentLanguage = catalogue.find((version) => version.module === current)?.lang;

  async function pick(module) {
    try {
      await setCurrentVersion(module);
    } catch (error) {
      reportError(error, t("extVersionChooseFailed", {}, "That version could not be selected."));
      return;
    }
    // The choice is made and saved; only showing it failed, which is a different message.
    try {
      await onChosen?.();
    } catch (error) {
      reportError(
        error,
        t(
          "extVersionRepaintFailed",
          {},
          "The version was changed, but the page could not be updated."
        )
      );
    }
  }

  const list = el("div", { class: "version-list" });
  const filter = el("input", {
    type: "search",
    class: "input version-filter",
    placeholder: t("extVersionFilterPlaceholder", {}, "Name, language or code"),
    "aria-label": t("extVersionFilter", {}, "Filter Bible versions"),
    autocomplete: "off",
    spellcheck: "false",
    "data-autofocus": true,
    oninput: paint,
  });

  function paint() {
    const query = filter.value.trim().toLowerCase();
    const shown = catalogue.filter((version) => matches(version, query));
    list.replaceChildren(
      ...(shown.length === 0
        ? [emptyState(t("noResults", {}, "No results found"))]
        : groupByLanguage(shown, currentLanguage).map(([language, versions]) =>
            el("section", { class: "version-group" }, [
              el("h3", { class: "version-language", text: language }),
              ...versions.map((version) => renderRow(version, version.module === current, pick)),
            ])
          ))
    );
  }

  paint();
  byId("versionBody")?.replaceChildren(el("div", { class: "version-filter-bar" }, [filter]), list);
}
