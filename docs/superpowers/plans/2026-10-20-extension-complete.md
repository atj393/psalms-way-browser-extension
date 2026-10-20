# Psalms Way extension, complete release: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the extension the phone app's versions, languages, appearance options, highlights, favourites, Today, Compare, Prayers and Progress, in a refined version of the current top-row design.

**Architecture:** Vanilla ES modules loaded by `popup.html` (no build step, no runtime dependencies). One module per feature, one stylesheet per feature in `styles/`, data in `bibles/`, `locales/` and `data/`. Phone-shaped data stays in `store.carry` (already synced) behind `src/phoneData.js`. Wave 0 lays down every shared contract so wave 1 agents work on disjoint files in parallel.

**Tech Stack:** Chrome MV3, plain JavaScript ES modules, vitest 2.1.9 (+ jsdom per file), ESLint 9, Prettier 3, `scripts/smoke-test.js` (real Chrome over CDP).

**Spec:** `docs/superpowers/specs/2026-10-20-extension-complete-design.md`

## Global Constraints

- Repository: `C:\Alexis\Test\my projects\github-repos\psalms-way-browser-extension`, branch `main`. Never create branches, push, stash, reset or checkout; the controller commits. Never add AI attribution.
- Phone app (read-only reference): `C:\Alexis\Test\my projects\github-repos\psalms-way-app`.
- No build step, no runtime dependencies, no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`/`new Function` (ESLint and `scripts/validate-package.js` enforce). Build DOM with `el()` and `icon()`.
- Indices are 0-based in code (`chapterIndex`, `verseIndex`), 1-based in what the reader sees and in phone-shaped data (`chapter`, `verse`).
- Reference format `Psalm 23:1` (singular). British spelling in English UI text.
- Every user-visible string goes through `t()` from `src/i18n.js` (wave 1 may pass English literals to `t()` with a key and English fallback; wave 2 completes extraction).
- Popup width 440 px. All controls stay in the top three rows.
- Fonts: `--font-ui` and `--font-read` are Arial (do not change).
- Valid stored data is never altered on read (no trimming, shortening, dropped duplicates).
- Phone-shaped data must keep the phone's exact shapes (see `src/phoneData.js`), because it syncs.
- `npm run check`, `npm run format:check` and `node scripts/smoke-test.js` pass at the end of every task; coverage thresholds (lines 90, functions 90, branches 85, statements 90) hold for every module listed in `vitest.config.js`.
- LF line endings (`.gitattributes` already enforces `eol=lf`).

## Review Focus

1. **A version without the current psalm** (lt_heritage has 137 chapters, ta_oitce 148): switching to it while on Psalm 150 must show "This version does not include Psalm 150" and keep the reader working, not throw. Test in Task 1.
2. **Right-to-left text** (`wlc` Hebrew, Arabic, Persian, Urdu, Uyghur versions; ar/fa/he/ur/ug UI): verse text must render `dir="rtl"` without mirroring the verse numbers or the toolbar. Test in Task 1 (text) and Task 8 (UI).
3. **Highlight and bookmark on the same verse, then sync**: both survive a round trip through `toPhoneData`/`fromPhoneData` unchanged. Test in Task 3.
4. **Challenge marked read twice in one day, and across midnight**: second mark the same local day is blocked; the next local day is allowed. Test in Task 7 with injected dates.
5. **Language with a missing key** (any of the 46): `t()` falls back to English, never shows a raw key. Test in Task 0 and enforced by the parity test in Task 9.

---

## File ownership (parallel safety)

| File                                                                                                                                                                                                                               | Owner task          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `popup.html`, `src/app.js`, `scripts/package-manifest.js`, `scripts/validate-package.js`, `src/storage.js`, `src/phoneData.js`, `src/i18n.js`, `scripts/sync-locales.js`, `locales/**` (wave 0 seed), `styles/*.css` (empty files) | Task 0              |
| `src/versions.js`, `src/versionPicker.js`, `src/data.js`, `bibles/**`, `scripts/sync-bibles.js`, `scripts/validate-data.js`, `styles/versions.css`                                                                                 | Task 1              |
| `src/settings.js`, `styles/appearance.css`, `style.css` (theme/accent variables only)                                                                                                                                              | Task 2              |
| `src/reader.js`, `src/panels.js`, `styles/library.css`                                                                                                                                                                             | Task 3              |
| `src/dailyVerse.js`, `src/today.js`, `styles/today.css`                                                                                                                                                                            | Task 4              |
| `src/compare.js`, `styles/compare.css`                                                                                                                                                                                             | Task 5              |
| `src/prayers.js`, `data/prayers-en.json`, `styles/prayers.css`                                                                                                                                                                     | Task 6              |
| `src/dateKeys.js`, `src/streak.js`, `src/badges.js`, `src/challenges.js`, `src/stats.js`, `src/progress.js`, `styles/progress.css`                                                                                                 | Task 7              |
| every UI module and `popup.html` (strings only), `locales/ext/en.json`                                                                                                                                                             | Task 8 (wave 2)     |
| `locales/ext/<code>.json` for its language group                                                                                                                                                                                   | Task 9a–9f (wave 3) |
| `scripts/smoke-test.js`, `scripts/screenshots.js`, docs, `docs/screenshots/**`                                                                                                                                                     | Task 10             |

Each wave 1 task also owns its own `test/<module>.test.js` files. A task needing a change in a file it does not own reports it to the controller instead of editing.

---

## Wave 0 (controller, sequential)

### Task 0: Scaffolding and shared contracts

**Files:**

- Modify: `scripts/package-manifest.js`, `scripts/validate-package.js`, `src/storage.js`, `popup.html`, `src/app.js`, `vitest.config.js`, `eslint.config.js` (if new globals)
- Create: `src/phoneData.js`, `src/i18n.js`, `scripts/sync-locales.js`, `locales/app/<47 codes>.json` (copied), `locales/ext/en.json`, stub modules `src/versions.js`, `src/versionPicker.js`, `src/today.js`, `src/compare.js`, `src/prayers.js`, `src/progress.js`, empty `styles/{versions,appearance,library,today,compare,prayers,progress}.css`
- Test: `test/phoneData.test.js`, `test/i18n.test.js`, `test/storage.test.js` (settings fields)

**Interfaces (produced, every later task relies on these exact names):**

```js
// scripts/package-manifest.js
export const PACKAGE_FILES = [/* top-level files as today */];
export const PACKAGE_DIRS = ["src", "styles", "bibles", "locales", "data"]; // every file inside ships

// src/storage.js – settings (sanitiseSettings keeps old fields and adds):
// theme: "light" | "sepia" | "dark" | "auto"            (default "light")
// accent: "green" | "blue" | "red" | "amber" | "purple" (default "green")
// bibleVersion: string | null   (/^[a-z0-9_]+$/, null = choose from the browser language)
// uiLanguage: "auto" | string   (/^[a-z]{2}$/ or "auto", default "auto")
// compareVersions: [string, string] (default ["kjv", "web"])
export const THEMES = ["light", "sepia", "dark", "auto"];
export const ACCENTS = ["green", "blue", "red", "amber", "purple"];

// src/phoneData.js – the phone app's data in store.carry, in the phone's exact shapes
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"];
export function getHighlights(store)                // -> [{chapter, verse, color}]
export function highlightOf(store, ci, vi)          // -> color | null
export async function setHighlight(ci, vi, color)   // color null removes; returns new store
export function getFavoriteChapters(store)          // -> [chapter (1-based)], newest first
export function isFavoriteChapter(store, ci)        // -> boolean
export async function toggleFavoriteChapter(ci)     // -> boolean (now favourite); prepends like the phone
export function getStreakData(store)                // -> {lastDate, count, longestStreak?} | null
export function getEarnedBadges(store)              // -> {badgeId: ISO} (empty object if none)
export function getChallengeProgress(store)         // -> {challengeId: progress} (empty object if none)
export async function updateCarry(mutator)          // mutator(carryDraft) -> void; returns new store
export function getPhoneSettings(store)             // -> carry.settings or {}

// src/i18n.js
export const SUPPORTED_LANGUAGES = [/* the phone's 47 codes */];
export const RTL_LANGUAGES = ["ar", "fa", "he", "ur", "ug"];
export async function initI18n(setting)             // "auto" | code; loads locales/app + locales/ext for the language and English
export function currentLanguage()                   // -> code
export function t(key, vars = {}, fallback)         // ext[lang] > app[lang] > ext.en > app.en > fallback > key; {{var}}; count -> key_one/key_other via Intl.PluralRules
export function applyTranslations(root = document)  // fills [data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder]
export function languageName(code)                  // native name via Intl.DisplayNames(code)
export function resolveBrowserLanguage(tags = navigator.languages) // best supported code, else "en"
export function isRtl(code)

// stubs (wave 1 replaces the internals, keeps the names):
// src/versions.js:      export async function loadCatalogue() -> [{module,name,lang,lang_short,year,chapters,rtl,copyright,file}]
//                       export async function getVersionData(module) -> string[][]
//                       export function currentVersion() -> module ; export async function initVersions(settings, uiLanguage)
//                       export async function setCurrentVersion(module)
//                       export function versionLabel(module) -> short chip text ("NIV", "KJV", "Luther")
// src/reader.js (two hooks added by Task 0; Task 3 fills them):
//                       export function setCompareOpener(fn)   // fn(chapterIndex, verseIndex) opens comparePanel
//                       export function refreshFavChapter(store) // paints #btnFavChapter for the current chapter
// src/data.js:          export function hasChapter(data, chapterIndex) -> boolean (Task 0 adds; Task 1 keeps)
// src/versionPicker.js: export async function renderVersionPicker({ onChosen })
// src/today.js:         export async function renderToday({ navigate })
// src/compare.js:       export async function renderCompare({ chapterIndex, verseIndex })
// src/prayers.js:       export async function renderPrayers()
// src/progress.js:      export async function renderProgress({ navigate }) ; export async function recordVisit(now = new Date())
```

Markup added to `popup.html` (all hidden panels follow the existing `section.panel` pattern with a `panel-head`, close button and `panel-body` id):

- Header: `#btnVersion` (chip, text = current version short name), `#btnCloud` (icon button, moved from toolbar; `#btnCloudLabel` removed, tooltip only), then One Verse, New Chapter.
- Chapter bar: `#btnFavChapter` (heart icon button, `aria-pressed`) after `#chapterTitle`.
- Toolbar (8): `#btnTodaysPsalm` (label Today, opens `todayPanel`), `#btnSearch`, `#btnLibrary`, `#btnHistory`, `#btnCompare`, `#btnPrayers`, `#btnProgress`, `#btnSettings`.
- Panels: `todayPanel/#todayBody`, `versionPanel/#versionBody`, `comparePanel/#compareBody`, `prayersPanel/#prayersBody`, `progressPanel/#progressBody`.
- Library tabs: `data-tab="favourites"` (label Bookmarks), `highlights`, `chapters` (label Favourites), `notes`.
- Settings: theme buttons Light, Sepia, Dark, Auto; `#accentControls` with five `.accent-btn[data-accent]`; `#languageSelect` (select) and `#versionSetting` (button opening the picker); existing text size, Your data, About.

- [ ] Step 1: write `test/phoneData.test.js` (highlight set/replace/remove keeps `{chapter, verse, color}` 1-based; favourites prepend and remove; unknown colour rejected; store without carry works) and `test/i18n.test.js` (fallback chain, `{{count}}` plural `_one`/`_other`, missing key falls back to English then key, `resolveBrowserLanguage(["pt-BR","en"])` → `pt`, `["xx"]` → `en`, `isRtl("ar")`), run, see them fail.
- [ ] Step 2: implement `src/phoneData.js`, `src/i18n.js`, settings fields in `src/storage.js` with tests for each new field's fallback.
- [ ] Step 3: `scripts/sync-locales.js` copies `psalms-way-app/i18n/locales/*.json` to `locales/app/`; run it; seed `locales/ext/en.json` with `{}`.
- [ ] Step 4: package dirs in `scripts/package-manifest.js` and `scripts/validate-package.js` (walk `PACKAGE_DIRS`; keep the forbidden-pattern and reference checks); markup, stubs, empty stylesheets linked from `popup.html`; `src/app.js` wiring (VIEWS for the new panels; Today, Compare, Prayers, Progress, version chip, heart, cloud; `recordVisit()` on start; `initI18n` and `applyTranslations` before first render).
- [ ] Step 5: update `scripts/smoke-test.js` only where Sync moved to the header; run `npm run check`, format, smoke; commit `feat: scaffolding for the complete extension`.

---

## Wave 1 (parallel helper agents; disjoint files)

### Task 1: Bible versions

**Files:** Create `scripts/sync-bibles.js`, `bibles/index.json`, `bibles/<module>.json` (81 files) ; Modify `src/versions.js`, `src/versionPicker.js`, `src/data.js`, `scripts/validate-data.js`, `styles/versions.css` ; Test `test/versions.test.js`, `test/data.test.js`

**Interfaces:** Consumes `t`, settings (`bibleVersion`), `updateSettings` from storage. Produces the `src/versions.js` API listed in Task 0 with real data. `getData()` in `src/data.js` keeps its signature and returns the **current version's** chapters.

- `scripts/sync-bibles.js`: reads `psalms-way-app/psalms_extracted/psalms-*.json` (`{metadata, psalms}`), writes `bibles/<module>.json` = the `psalms` array only (compact JSON, no pretty print), and `bibles/index.json` = catalogue sorted by language name then version name, with `modern` (NIV, file `psalms.json` at the repo root, kept) first. Language names: the phone's `LANGUAGE_NAMES` table in `services/psalmsModules.ts:117-165` and its `resolveLanguageName`. `rtl: ["he","ar","fa","ur","ug"].includes(lang_short)`. `copyright`: first 160 characters of `metadata.copyright_statement` (or `copyright` when it is a string), whitespace collapsed. `chapters`: the array length.
- First choice when `bibleVersion` is null: English → `modern`; otherwise the phone's rule (`services/autoSetupService.ts:25-45`: `PREFERRED_BIBLE` then the first catalogue entry with that `lang_short`, excluding `modern`), using the UI language; no match → `modern`. Persist the choice.
- `getVersionData(module)` caches per module; rejects with `DataError` for unknown modules; a version shorter than 150 chapters is fine.
- A version shorter than 150 chapters: `getData()` returns its shorter array; `hasChapter()` (from Task 0) tells the reader. The message itself is Task 3's.
- RTL: after loading, `versions.js` sets `#readingView` `dir` to `rtl` or `ltr` and `lang` to the version's `lang_short`.
- `src/versionPicker.js`: renders into `#versionBody`: a filter input (matches name, language, module), languages as headings (current language first), each version a row (name, year, copyright in small text, check on the current one); choosing calls `setCurrentVersion(module)`, updates `#btnVersion` text (short label: module upper-case for ≤6 chars, else first word of name) and calls `onChosen()`.
- `scripts/validate-data.js`: validates every catalogue entry's file exists, is an array of arrays of non-empty strings, chapter count equals catalogue `chapters`, and `psalms.json` stays exactly 150 chapters.
- Tests: catalogue sorted; `modern` first; default for `de` is the phone's German choice; `en` → `modern`; unknown → `modern`; `rtl` true for `wlc`; a 137-chapter version loads and `hasChapter(data, 149)` is false; picker filter "kjv" shows KJV rows only (jsdom).
- Commit: `feat: all 82 Bible versions with a picker`.

### Task 2: Appearance (auto theme, accent colours)

**Files:** Modify `src/settings.js`, `style.css` (variables only), `styles/appearance.css` ; Test `test/appearance.test.js` (jsdom)

**Interfaces:** Consumes settings `theme`, `accent`. Produces `applyTheme(theme)` handling `auto` via `matchMedia("(prefers-color-scheme: dark)")` with a change listener, and `applyAccent(accent)` setting `data-accent` on `<html>`.

- Accent primaries (light / dark), from the phone's `theme/index.ts`: green `#3A6B38` / `#9FD49C`, blue `#0057A8` / `#ADC6FF`, red `#9B1919` / `#FFB4AB`, amber `#8B5000` / `#FFB961`, purple `#6B3FA0` / `#D4BBFF`. `--brand` from the accent; `--brand-strong` 12% darker (light) / lighter (dark); `--brand-soft` the primary at 10% (light) / 16% (dark); `--brand-text` white on light, `#1b1b1a` on dark. Sepia keeps its paper colours and uses the accent's light primary.
- Accent buttons: five 28 px circles in `#accentControls`, `aria-pressed`, name as `aria-label`.
- Tests: `auto` resolves to dark when `matchMedia` matches and switches on change; each accent sets `data-accent`; invalid accent falls back to green.
- Commit: `feat: auto theme and the phone's accent colours`.

### Task 3: Highlights, chapter favourites and Library tabs

**Files:** Modify `src/reader.js`, `src/panels.js`, `styles/library.css` ; Test `test/highlights.test.js`, `test/syncModel.test.js` (add round-trip case)

**Interfaces:** Consumes `phoneData` (`highlightOf`, `setHighlight`, `isFavoriteChapter`, `toggleFavoriteChapter`, `getHighlights`, `getFavoriteChapters`, `HIGHLIGHT_COLORS`). Produces `refreshFavChapter(store)` used by `app.js` (wave 0 calls it after every passage render).

- Verse actions row: Bookmark · Highlight · Note · Copy · Compare (Compare calls the navigator to open `comparePanel` for that verse; wave 0 exposes `openCompare(chapterIndex, verseIndex)` through `setCompareOpener`). Highlight opens an inline row of four swatches plus "None".
- Highlighted verses: `.verse-body` background `var(--hl-<color>)`; light values `#FFF176 #C8E6C9 #BBDEFB #F8BBD0`, dark `#665A00 #1B5E20 #0D47A1 #880E4F`, sepia uses the light values at 70% opacity; text colour keeps contrast ≥ 4.5:1 (dark theme uses light text on the dark values).
- `#btnFavChapter`: heart, filled when the chapter is a favourite; toggles via `toggleFavoriteChapter`.
- Missing chapter in the current version (`!hasChapter(data, chapterIndex)`): the reading view shows `t("versionMissingPsalm", {number}, "This version does not include Psalm {{number}}.")` with a button "Choose another version" (opens `versionPanel` through the navigator); prev/next still work.
- Library: four tabs. Highlights list (colour dot, reference, preview, remove), Favourites list (Psalm N, first verse preview, remove). Arrow-key tab switching includes the new tabs.
- Tests: highlight set/replace/remove updates `carry.highlights` in phone shape; bookmark + highlight on one verse survive `fromPhoneData(toPhoneData(store))` unchanged; favourite toggle prepends/removes.
- Commit: `feat: highlights, chapter favourites and Library tabs`.

### Task 4: Today and the verse of the day

**Files:** Create `src/dailyVerse.js` ; Modify `src/today.js`, `styles/today.css` ; Test `test/dailyVerse.test.js`

- `hashString` and `getVerseForDate(dateKey, version, data)` ported exactly from `psalms-way-app/services/dailyVerseService.ts:36-78` (data passed in instead of `getChapter`).
- Test vectors (computed from the phone's algorithm): `hashString("2026-10-20|modern") === 3818330699`; `hashString("2026-09-08|kjv") === 2184820137`; NIV (`psalms.json`) `2026-10-20` → Psalm 150:6, `2026-12-25` → 95:1, `2027-01-01` → 106:23; KJV `2026-10-20` → 48:12, `2026-12-25` → 37:23, `2027-01-01` → 66:4.
- Today panel: Verse of the day card (reference, text, Open (navigates to the verse), Copy), "Today's Psalm" card (`getDailyChapterIndex()` from `dates.js`, Read button), streak line from `getStreakData` (Task 7 is not needed: read `count` directly; "Day 1" when null).
- Commit: `feat: Today with the verse of the day`.

### Task 5: Compare

**Files:** Modify `src/compare.js`, `styles/compare.css` ; Test `test/compare.test.js` (jsdom)

- Renders the reference, then three cards: current version and the two in settings `compareVersions` (each card header is a `<select>` of all versions; changing it saves `compareVersions` and re-renders). Missing verse in a version shows "—" and "not in this version" in small text. RTL versions set `dir` on their card text.
- Default verse: the passed verse, else verse 1 of the current chapter.
- Tests: three cards in order; duplicate version choice is allowed but the current version is never offered twice; missing verse shows the dash.
- Commit: `feat: compare a verse across versions`.

### Task 6: Prayers

**Files:** Create `data/prayers-en.json` (copied from `psalms-way-app/prayers-en.json` byte for byte) ; Modify `src/prayers.js`, `styles/prayers.css` ; Test `test/prayers.test.js` (jsdom)

- Category list (19, names via `t(category.i18nKey, {}, category.name)`, count of prayers, empty categories show `prayerEmpty`), prayer list per category (title, occasion), prayer detail (title, text, Psalm references as links that navigate, Copy). Back button inside the panel returns one level.
- Tests: 19 categories, 36 prayers total, a category with none shows the empty text, a Psalm reference "Psalm 23" navigates to chapter index 22.
- Commit: `feat: prayers`.

### Task 7: Progress (streak, stats, badges, challenges)

**Files:** Create `src/dateKeys.js`, `src/streak.js`, `src/badges.js`, `src/challenges.js`, `src/stats.js` ; Modify `src/progress.js`, `styles/progress.css` ; Test `test/streak.test.js`, `test/badges.test.js`, `test/challenges.test.js`, `test/stats.test.js`

- `dateKeys.js`: `toDateKey`, `daysBetween`, `addDays` ported from `psalms-way-app/services/dateUtils.ts` (local days).
- `streak.js`: `nextStreak(data, now)` pure port of `checkAndUpdateStreak` (`services/streakService.ts:71-127`) and `currentStreak(data, now)` of `getStreak`.
- `badges.js`: `BADGE_DEFS` verbatim from `services/badgesService.ts:24-34`; `awardBadges(earned, streak, nowIso)` returns `{earned, newly}`.
- `challenges.js`: `CHALLENGE_DEFS` verbatim from `services/challengesService.ts:40-95`; `startChallenge(all, id, data, {hour, minute}, todayKey, random = Math.random)`, `getNextDayIndex`, `canReadToday(progress, todayKey)`, `markDayComplete(all, id, dayIndex, todayKey)` (same guards and results as the phone), `resetChallenge(all, id)`. Hour/minute from phone settings `notificationHour`/`notificationMinute`, default 8:00.
- `progress.js`: `recordVisit(now)` = one `updateCarry` applying `nextStreak` then `awardBadges`; `renderProgress` with three sections in one panel: Streak and stats (current, longest, last 7 days dots, totals: chapters read, sessions, bookmarks, highlights, notes, favourites; most read top 3), Badges (nine, earned with date, locked greyed), Challenges (six cards; detail view: progress bar, day list, "Mark today's reading as done" (disabled when `canReadToday` is false), Open verse, Reset with confirm).
- Tests: every streak branch from the phone (first open, same day, next day, gap, corrupt date, longest kept); badges awarded once with ISO dates; challenge start shapes match the phone (`startDate`, `notifHour`, `notifMinute`, `dayAssignments` with 1-based `verseNumber`, `completedDays: []`, `completed: false`); mark twice same day blocked; next day allowed; out-of-range index throws; completing the last day sets `completed` and `completedDate`.
- Commit: `feat: progress with streak, stats, badges and challenges`.

---

## Wave 2

### Task 8: Strings, language picker and right-to-left layout

**Files:** Modify every UI module and `popup.html` (strings only), `locales/ext/en.json`, `src/settings.js` (language select) ; Test `test/i18nCoverage.test.js`

- Replace every English literal shown to the reader with `t(key, vars, fallback)` / `data-i18n`. Reuse the phone's key when its English text is identical (check `locales/app/en.json`); otherwise add an `ext` key in `locales/ext/en.json` (camelCase, prefixed `ext` only when it would clash).
- Settings language select: "Automatic (browser language)" + the 47 by native name; changing it re-inits i18n and re-renders.
- RTL UI: `<html dir="rtl">` for RTL languages; mirror the chapter arrows and toolbar order through CSS logical properties only where the layout needs it.
- Test: a script-free scan asserting every `data-i18n` key and every `t("key"` literal in `src/` exists in `locales/ext/en.json` or `locales/app/en.json`.
- Commit: `feat: every string translatable, language picker, right-to-left layout`.

## Wave 3 (parallel helper agents)

### Tasks 9a–9f: Translations of `locales/ext/en.json`

Groups: 9a de fr es it pt nl ro pl; 9b ru cs hu lt lv fi sq tr; 9c hi bn gu mr pa ne ta te kn ml; 9d zh ja ko vi th id tl my; 9e ar fa he ur ug so ha af; 9f ht mi wo bo.

- Each writes `locales/ext/<code>.json` with every key of `ext/en.json`, same `{{placeholders}}`, the register and terms of that language's `locales/app/<code>.json` (for "Bookmarks", "Notes", "Settings", etc. use the phone's existing word). "Psalms Way" and "Google Drive" untranslated. Low-confidence languages reported.
- Shared parity test (`test/localeParity.test.js`, written by 9a, others run it): every ext file has exactly the en keys and placeholders.
- Commit per group: `i18n: <languages>`.

## Wave 4 (controller)

### Task 10: Integration, smoke test, screenshots, package

- Smoke test additions: version picker switches to KJV and the title stays; a 137-chapter version on Psalm 150 shows the missing message; highlight a verse; favourite a chapter; Today shows a verse; Compare shows three cards; Prayers opens a prayer; Progress shows a streak of 1; language German shows German labels; Arabic sets `dir="rtl"`; still no network request.
- Regenerate `docs/screenshots`, update README, USER_GUIDE, CLAUDE.md, store listing notes; `npm run package`; full review; commit `release: complete extension`.
