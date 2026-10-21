# CLAUDE.md — Psalms Way browser extension

Guidance for Claude Code working on this repository.

## What this is

A Manifest V3 Chrome extension that puts all 150 Psalms in a browser popup, in 80
Bible versions and 47 interface languages. It works offline, requests one
permission, and has no runtime dependencies. It carries the phone app's features
(highlights, favourite Psalms, Today, Compare, Prayers, Progress) except reminders,
which are out of scope.

- **Version:** 3.0
- **Type:** popup, plus a background worker used only for optional sync with the
  phone app (`src/background.js`); no content scripts
- **Runtime dependencies:** none. `package.json` exists for development tooling
  only and is not shipped.

## Layout

```
manifest.json          MV3 manifest. permissions: ["storage"]; optional: ["identity"]
popup.html             the popup markup; loads src/app.js as a module
style.css              the base styling, built on CSS custom properties
styles/                one stylesheet per feature (versions, today, compare, prayers,
                       progress, library) and appearance.css (the accent colours)
psalms.json            the NIV (module "modern"): 150 chapters, 2,461 verses. Data, not source
bibles/                the other 79 versions, one <module>.json each, and index.json,
                       the catalogue (written by scripts/sync-bibles.js, never by hand)
locales/app/           the phone app's 47 translation files, copied unchanged
locales/ext/           the extension's own wording, one file per language (en.json is the source)
data/prayers-en.json   the phone's 50 prayers in 19 categories, copied unchanged
icon{16,48,128}.png    manifest icons

src/                   the extension's JavaScript, loaded as ES modules
  app.js               bootstrap, view switching, focus management, event wiring
  reader.js            the reading view: chapters, single verses, verse actions
  panels.js            search results, Library tabs and history lists
  notes.js             the note editor
  settings.js          appearance, language, top-row text fitting, export and restore
  storage.js           the ONLY module that touches chrome.storage; the write queue
  phoneData.js         the phone's data in store.carry: highlights, favourite Psalms,
                       streak, badges, challenges (every read and write goes here)
  versions.js          catalogue, current version, version text, readingTextAttributes()
  versionPicker.js     the Bible version panel
  i18n.js              t(), plurals, the page's lang and dir, right-to-left
  today.js, dailyVerse.js   the Today panel and the verse of the day (a port of the phone's)
  compare.js           the Compare panel
  prayers.js           the Prayers panel
  progress.js          the Progress panel and recordVisit() (once per popup open)
  streak.js, badges.js, challenges.js, stats.js   the phone's rules, ported, pure
  dateKeys.js          local calendar days as 'YYYY-MM-DD'
  backup.js            versioned export format, import validation
  search.js            search and match segmentation (pure)
  data.js              reference formatting, range checks, the current version's chapters
  dates.js             Today's Psalm (pure)
  dom.js               element helpers, status line, confirmation dialog
  icons.js             SVG icon definitions
  cloud.js             the Sync panel
  background.js        the worker that runs sync
  cloudSync.js, syncMerge.js, syncModel.js, drive.js, googleAuth.js, config.js   sync

test/                  Vitest suites plus a strict chrome.storage double
scripts/               validators, packaging, smoke test, screenshots, and the two
                       sync-* scripts that copy files from the phone app
docs/                  audit, results, screenshots, specs and plans
```

There is **no build step**. The files in the repository are the files that ship.
`src/*.js` are loaded directly by the browser as ES modules, which Manifest V3
popups support natively.

## Commands

```bash
npm test              # unit and DOM tests (Vitest, over 1,000)
npm run test:coverage # logic-layer coverage, thresholds enforced
npm run test:browser  # loads the real extension into Chrome, every panel
npm run lint          # ESLint
npm run format:check  # Prettier
npm run validate      # every Bible file + manifest.json + package contents
npm run package       # dist/psalms-way-extension.zip
npm run check         # lint + validate + test
node scripts/screenshots.js   # rewrites docs/screenshots from the real popup
node scripts/sync-bibles.js   # copies the phone's Bibles into bibles/ and rewrites index.json
node scripts/sync-locales.js  # copies the phone's translations into locales/app/
```

`npm run test:browser` needs Chrome; set `CHROME_PATH` if it is not on a usual
path. `--headful` watches it run. It drives the popup over the DevTools Protocol
and fails if the popup logs an error or makes any network request.

## Rules that are enforced, not just preferred

These are checked by lint, a validator or a test. Breaking one fails the build.

- **No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval` or `new Function`.**
  Build nodes with `el()` and `icon()` from `src/dom.js` and `src/icons.js`.
  ESLint fails on the first three; `scripts/validate-package.js` greps the
  shipped files for all of them.
- **No new permission** without adding it to the approved list in
  `scripts/validate-manifest.js` with a justification.
- **No `host_permissions` and no `content_scripts`.** The validator rejects both
  outright. Not reading the user's pages is the extension's main promise.
- **No network request unless the reader connected sync.** The smoke test fails
  if the popup makes one. Sync runs in the background worker and talks only to
  Google (sign-in and the Drive app folder), only for a connected reader.
- **Sync must combine exactly as the phone app does.** `src/syncMerge.js` is a
  port of the phone's `services/backup/mergeBackup.ts` and must pass the same
  cases: `test/fixtures/syncVectors.json` is a byte-for-byte copy of the
  phone's `__tests__/fixtures/syncVectors.json`; change both together.
- **No remote code.** Manifest V3 forbids it and the package validator checks.
- **Every Bible version is exactly 150 chapters of verse strings, chapter N being Psalm
  N.** `scripts/validate-data.js` checks `psalms.json` and every file in
  `bibles/`. Empty verses are allowed only where the phone's file has them, in a
  pinned table (`BLANK_VERSES`).
- **Every string the reader sees goes through `t()`** (see "The interface language"
  below). `test/i18nCoverage.test.js` fails on a key with no English wording and on
  an extension key nothing uses.
- **`locales/` and `bibles/` are generated or copied.** Never edit
  `locales/app/*` or a `bibles/` file by hand; change the phone's file and run the
  sync script.

## Conventions

- 2-space indent, semicolons, `const`/`let`, ES modules. Prettier settings are in
  `.prettierrc.json`; run `npm run format` rather than hand-formatting.
- References are formatted by `formatReference()` and read **"Psalm 23:1"**,
  singular. "Psalms" is the book; a chapter is a Psalm. This matches the
  companion Android app. Do not write `Psalms 23:1`.
- Chapter and verse indices are **0-based everywhere in code** (except the
  phone-shaped `carry` data, which is 1-based) and 1-based in what the reader sees. `formatReference()` does the conversion.
- Saved verses are **Bookmarks**, as in the Android app, because the two now sync
  (see `docs/superpowers/specs/2026-10-13-phone-extension-connection-roadmap.md`).
  Code still names verse bookmarks `favourites` (`store.favourites`). The phone's
  whole-chapter favourites are the heart in the chapter bar and the Library's
  Favourites tab; they live in `store.carry.favorites` (American spelling, the
  phone's key), 1-based chapter numbers, newest first.
- British spelling in English text, **Arial** throughout (`--font-ui`, `--font-read`).
- Phone-shaped data (highlights, favourite Psalms, streak, badges, challenges) is
  stored in the phone's own shapes: 1-based chapter and verse, ISO dates. Read and
  write it only through `src/phoneData.js`; sync uploads it as it is.
- User-facing errors go through `toast()` or `reportError()` in `src/dom.js`.
  They are one sentence and never contain a stack trace. Technical detail goes to
  `console.error`.

## Things that are easy to get wrong here

**The popup is destroyed every time it closes.** A module-level variable is not
state, it is a cache. Anything that must survive belongs in `src/storage.js`. When
changing behaviour, test it by closing and reopening the popup, not by clicking
around in one session.

**Never swallow a storage error.** Writes in `src/storage.js` reject with a
`StorageError`; callers report it. The previous version caught and discarded
every storage error, so a verse could look saved and be gone on the next open. Do
not reintroduce `catch {}` on a write path.

**Stored data is untrusted.** Users upgrade across versions, restore backups and
edit storage by hand. Everything read from storage goes through a sanitiser in
`src/storage.js`; malformed records are dropped, not repaired into something
surprising, and never allowed to throw mid-render. Valid records are never changed
on read (no trimming, shortening or dropped duplicates): cloud sync would upload
the change as if the reader had made it. Limits apply to what the reader types.

**Migration must stay non-destructive.** Version 1.1 wrote three separate keys
(`psalmsway_favourites`, `psalmsway_history`, `psalmsway_settings`). `loadStore()`
migrates them into the single `psalmsway` record on first run and **leaves the old
keys in place**, so a user who rolls back does not lose anything. The migration is
idempotent. `test/storage.test.js` pins this against the exact 1.1 shape — if you
change the schema, extend those tests first.

**Dates are not milliseconds.** A local calendar day is 23 or 25 hours long on a
daylight-saving transition. `src/dates.js` builds both endpoints with `Date.UTC()`
from local calendar components for exactly this reason. Do not "simplify" it back
to subtracting two `Date` objects — that was a real shipped bug, and CI runs the
date tests in six time zones to stop it coming back.

**Psalm 119 has 176 verses.** Any per-verse UI has to work at that size. The verse
list uses a roving tabindex rather than putting each verse in the tab order.

**The store's writes run one at a time.** `updateStore()` and `saveStore()` in
`src/storage.js` go through a queue (`oneAtATime`). Two changes started together,
such as the daily streak at start-up and a bookmark, would otherwise both copy the
same store and the second write would undo the first. A failed change still rejects
for its own caller; the queue just moves on. The queue is per page: the background
worker (sync) is another context, so it reads fresh with `readFreshStore()`, never
from the popup's cache. Change the store only through `updateStore`; do not read it,
wait, and write it back yourself.

**The interface language.** `t(key, vars, fallback)` in `src/i18n.js` looks a key
up in `locales/ext/<lang>.json`, then `locales/app/<lang>.json` (the phone's file),
then English in the same two files, then the `fallback` you pass, then the key. Put
the English wording in `locales/ext/en.json` (reuse a key from `locales/app/en.json`
when its English is exactly what you need) and pass the same English as the
fallback. Placeholders are `{{name}}`; a count picks `key_one`, `key_other` (and
`_few`, `_many`, ... where the language needs them) by that language's plural rules.
Markup in `popup.html` uses `data-i18n`, `data-i18n-title`, `data-i18n-aria-label` and
`data-i18n-placeholder`; `applyTranslations()` fills them, and the English in the
markup is the fallback. `initI18n()` sets `<html lang>` and `<html dir>`. The
stylesheets are written with logical properties (start, end, inline) so one rule
serves both directions for ar, fa, he, ur and ug; an icon that points somewhere is
flipped by an explicit `:root[dir="rtl"]` rule, and `test/rtlLayout.test.js` scans
for a stray `left` or `right`. `test/localeParity.test.js` fails if a language in `locales/ext/` has other
keys or placeholders than `en.json`, or the wrong plural forms for its language
(`LOCALES=de,fr` checks only those). A key with no translation falls back to
English; it is never shown raw.

**Bible text has its own language and direction.** The popup's words follow the
interface language; the verses follow the version being read (an Arabic Bible in an
English popup, or the other way round). `readingTextAttributes()` in
`src/versions.js` returns `{lang, dir}` for the current version, and every element
that shows Bible text (verses, the single verse, search and Library previews, the
verse of the day, a challenge's verse) spreads it on that element only; a Compare
card marks its own text with its own version's language and direction. Never put it
on a container that also holds buttons or labels. The prayers are the
other exception: English only, marked `lang="en" dir="ltr"`.

**The Bible catalogue.** `bibles/index.json` lists every version (the NIV, module
`modern`, first, at `psalms.json`, then the rest by language and name), with
`rtl` and a credit line each. `scripts/sync-bibles.js` writes it from the phone's
`psalms_extracted/` folder and deletes files it no longer lists. A version that
cannot be laid out as 150 chapters with chapter N = Psalm N is left out, never
patched, through the `EXCLUDED` table in that script, with the reason beside it.
Two are out today: `lt_heritage` (partial: selected verses only, no verse numbers)
and `ta_oitce` (148 chapters, and Psalm 11's chapter holds the verses of Psalms 11,
115 and 116 mixed together). That is why the catalogue has 80 versions, not the
phone's 82. To add or drop a version, run the script; do not hand-edit `bibles/`.

**Highlights, favourites and progress belong to the phone's data.** Their shapes
are the phone's (see Conventions) and they sync. `recordVisit()` in
`src/progress.js` runs once per popup open and is the only thing in the popup that
moves the streak; the Today and Progress panels only read it.

## Testing approach

- **Pure logic** — `dates`, `search`, `data`, `backup`, and the sanitisers and
  migration in `storage` — is tested directly in Vitest under Node.
- **DOM helpers** are tested under jsdom (`// @vitest-environment jsdom`).
- **Views** (`app`, `background`, `cloud`, `compare`, `notes`, `panels`, `prayers`,
  `progress`, `reader`, `settings`, `today`, `versionPicker`) are covered by
  `scripts/smoke-test.js` in real Chrome (and some by jsdom tests) rather than the
  coverage thresholds, because what matters about them is that they work in an actual
  extension popup. They are excluded in `vitest.config.js` for that reason, not to
  flatter the number. Everything else under `src/` is counted, so a new logic module
  is measured without editing the config.
- **Translations** are checked by `test/localeParity.test.js` (every language has
  the English keys, placeholders and plural forms) and `test/i18nCoverage.test.js`
  (every key the code asks for has English wording). Both read the files as text.
- The smoke test has a section per feature (Bible versions, Highlights and favourite
  Psalms, Compare, Prayers, Progress, Language, and one that opens every panel before
  the console and network checks). Add to the matching section; a feature that is
  not exercised there is only half tested.
- The `chrome.storage` double in `test/chrome-mock.js` is deliberately strict: it
  structured-clones values as Chrome does and can inject quota and write
  failures. Do not loosen it to make a test pass.

## Not to be added

Without a strong, stated reason: a framework or bundler, runtime dependencies,
analytics or telemetry, an account requirement, content scripts, host
permissions, or remote code. Reminders and notifications are out of scope.
The Google account for sync stays optional, and its `identity` permission is
requested only when the reader connects. The extension's value is that it is fast,
offline and trustworthy.

## Scripture text

`psalms.json` is an English NIV text and the files in `bibles/` are the phone
app's other versions. None of it is covered by the repository's MIT licence. Each
version keeps its own terms (the roadmap records which are public domain, Creative
Commons or restricted, and that shipping them is the owner's decision), and its
credit line is shown in the version picker. Do not describe the NIV as public
domain, do not replace the licence notice, and do not add a version without
confirming distribution rights. There is an open licensing question recorded in
`docs/OVERNIGHT_AUDIT.md` under External actions.

Do not edit verse text.
