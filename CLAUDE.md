# CLAUDE.md — Psalms Way! browser extension

Guidance for Claude Code working on this repository.

## What this is

A Manifest V3 Chrome extension that puts all 150 Psalms in a browser popup. It
works offline, requests one permission, and has no runtime dependencies.

- **Version:** 2.0
- **Type:** popup only — no background service worker, no content scripts
- **Runtime dependencies:** none. `package.json` exists for development tooling
  only and is not shipped.

## Layout

```
manifest.json          MV3 manifest. permissions: ["storage"] and nothing else
popup.html             the popup markup; loads src/app.js as a module
style.css              all styling, built on CSS custom properties
psalms.json            150 chapters, 2,461 verses, 224 KB. Data, not source
icon{16,48,128}.png    manifest icons

src/                   the extension's JavaScript, loaded as ES modules
  app.js               bootstrap, view switching, focus management, event wiring
  reader.js            the reading view: chapters, single verses, verse actions
  panels.js            search results, Library and history lists
  notes.js             the note editor
  settings.js          appearance, export and restore
  storage.js           the ONLY module that touches chrome.storage
  backup.js            versioned export format, import validation
  search.js            search and match segmentation (pure)
  data.js              bundled text, reference formatting, range checks
  dates.js             Today's Psalm (pure)
  dom.js               element helpers, status line, confirmation dialog
  icons.js             SVG icon definitions

test/                  Vitest suites plus a strict chrome.storage double
scripts/               validators, packaging, browser smoke test, screenshots
docs/                  audit, results, screenshots
```

There is **no build step**. The files in the repository are the files that ship.
`src/*.js` are loaded directly by the browser as ES modules, which Manifest V3
popups support natively.

## Commands

```bash
npm test              # 146 unit and DOM tests (Vitest)
npm run test:coverage # service-layer coverage, thresholds enforced
npm run test:browser  # loads the real extension into Chrome, 73 checks
npm run lint          # ESLint
npm run format:check  # Prettier
npm run validate      # psalms.json + manifest.json + package contents
npm run package       # dist/psalms-way-extension.zip
npm run check         # lint + validate + test
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
- **No network request.** The smoke test fails if the popup makes one.
- **No remote code.** Manifest V3 forbids it and the package validator checks.
- `psalms.json` must stay 150 chapters of non-empty verse strings.

## Conventions

- 2-space indent, semicolons, `const`/`let`, ES modules. Prettier settings are in
  `.prettierrc.json`; run `npm run format` rather than hand-formatting.
- References are formatted by `formatReference()` and read **"Psalm 23:1"**,
  singular. "Psalms" is the book; a chapter is a Psalm. This matches the
  companion Android app. Do not write `Psalms 23:1`.
- Chapter and verse indices are **0-based everywhere in code** and 1-based only
  in what the reader sees. `formatReference()` does the conversion.
- Saved verses are **Favourites**, British spelling, one concept. The Android app
  has both "Bookmarks" and "Favorites"; that is deliberately not copied. See
  `docs/OVERNIGHT_AUDIT.md`.
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
surprising, and never allowed to throw mid-render.

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

## Testing approach

- **Pure logic** — `dates`, `search`, `data`, `backup`, and the sanitisers and
  migration in `storage` — is tested directly in Vitest under Node.
- **DOM helpers** are tested under jsdom (`// @vitest-environment jsdom`).
- **Views** (`reader`, `panels`, `notes`, `settings`) are covered by
  `scripts/smoke-test.js` in real Chrome rather than by jsdom tests, because what
  matters about them is that they work in an actual extension popup. They are
  excluded from the coverage thresholds for that reason, not to flatter the
  number.
- The `chrome.storage` double in `test/chrome-mock.js` is deliberately strict: it
  structured-clones values as Chrome does and can inject quota and write
  failures. Do not loosen it to make a test pass.

## Not to be added

Without a strong, stated reason: a framework or bundler, runtime dependencies,
analytics or telemetry, an account requirement, a background service worker,
content scripts, host permissions, or remote code. The extension's value is that
it is small, fast, offline and trustworthy.

## Scripture text

`psalms.json` is an English NIV text and is **not** covered by the repository's
MIT licence. Do not describe it as public domain, do not replace the licence
notice, and do not add further translations without confirming distribution
rights. There is an open licensing question recorded in
`docs/OVERNIGHT_AUDIT.md` under External actions.

Do not edit verse text.
