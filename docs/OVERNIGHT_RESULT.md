# Overnight result — Psalms Way! browser extension

Companion to [OVERNIGHT_AUDIT.md](OVERNIGHT_AUDIT.md), which records what was
found and why each decision was taken. This document records what changed.

## Executive summary

Version 1.1 worked, but three things about it were wrong in ways a reader would
eventually feel: **Today's Psalm showed the wrong Psalm** and could change
partway through a day, **a failed save was reported as a success**, and the
popup **forgot where you were** every time it closed.

All three are fixed. On top of that the extension gained per-verse **notes** and
a **Library** to keep them in, **export and restore** for moving personal data
between browsers, a full **keyboard and focus** pass, and the tests and CI it
never had.

What did not change is as deliberate: still Manifest V3 vanilla JavaScript, still
one permission, still no build step, still no network request of any kind, still
no framework and no runtime dependencies.

## Repository

|                      |                                                            |
| -------------------- | ---------------------------------------------------------- |
| Base commit          | `5c17a6a` on `main`                                        |
| Branch               | `codex/extension-overnight-hardening`                      |
| Manifest version     | 1.1 → **1.2**                                              |
| Files shipped        | 5 → **19** (`popup.js` split into 12 modules under `src/`) |
| Runtime dependencies | none → **none**                                            |

---

## Product changes

### Reading

- **Today's Psalm is correct.** 1 January is Psalm 1; a calendar day maps to
  exactly one Psalm; no day is repeated or skipped across a daylight-saving
  transition.
- **The popup resumes where you left off** instead of opening a random chapter.
  A first-time reader gets Today's Psalm.
- **Verse actions are contextual.** Selecting a verse reveals Save, Note and Copy
  in place, rather than putting a permanent button row beside every line.
- **Markers on saved and annotated verses**, so a chapter shows at a glance what
  you have kept.
- The reading column is set in a serif face with a wider line height; the
  surrounding chrome was quietened so the text is the loudest thing on screen.

### Library — new

Favourites and Notes in one panel, replacing the favourites-only panel.

- **Notes** are new: write, edit and delete a short note on any verse; open the
  verse again from the Library; markers show which verses carry one. Saving an
  empty note deletes it, so there is no way to leave an invisible empty record.
- **Favourites** keeps its name and its storage key. The Android app has _both_
  "Bookmarks" and "Favorites" as separate concepts; that ambiguity was
  deliberately not copied.

### Search

- Results **open the exact verse that matched**, not just its chapter.
- The match count is reported, and a truncated set says so: _Showing first 50 of
  812 matches_.
- Snippets are longer and the initial state no longer looks like an error.

### History

- Cap raised 20 → 50, and history now records verses as well as chapters.
- Rows distinguish `Psalm 23` from `Psalm 23:1` and stamp _Today_ / _Yesterday_.
- Clearing asks for confirmation in a real dialog and says explicitly that
  favourites and notes are untouched.

### Settings

- The **language menu is gone.** It listed four languages as "coming soon" that
  do not exist, in a five-row panel.
- **Export and restore** added.
- Theme and text size are `<fieldset>` groups with real labels rather than
  `<label for>` pointing at a `<div>`.

### Accessibility

- **Keyboard-complete.** Escape closes any panel; focus moves into a panel when
  it opens and returns to the control that opened it when it closes.
- **Psalm 119 is no longer 176 tab stops.** The verse list is a roving tab stop
  with arrow-key, Home and End navigation.
- Panels whose first control is _Close_ or _Clear_ focus the panel body, so Enter
  does not immediately dismiss or delete.
- `aria-pressed` on toggles, `aria-expanded` on the selected verse and toolbar,
  a live region for status messages, `aria-invalid` on a rejected chapter number,
  accessible names on every icon-only control, one consistent `:focus-visible`
  ring, and `prefers-reduced-motion` honoured.

### Design

- The stylesheet is rebuilt on design tokens — colour, space, radius, typography
  and focus. A theme is now a block of variables; nothing is themed by overriding
  a component.
- Dark and sepia were audited surface by surface. Search highlight, notes,
  dividers, placeholders, focus rings and error text all have their own values
  rather than inheriting light-mode ones.
- Dead rules removed (`.footer`, `.footer a`, `.sub-header-right`).

---

## Engineering changes

### Architecture

`popup.js` (651 lines, everything) became 12 modules loaded as native ES modules,
which Manifest V3 popups support directly — so there is still no build step.

Persistence, business logic, rendering and event wiring are now separate:
`storage.js` is the only module that touches `chrome.storage`; `dates.js`,
`search.js`, `data.js` and `backup.js` are pure and directly testable; the view
modules render and nothing else.

### Storage and migration

A single versioned record replaces three loose keys, with defaults, validation
and migration owned in one place. Writes reject on failure instead of being
discarded.

### Security

- Nothing assigns `innerHTML` anywhere. ESLint fails the build on `innerHTML`,
  `outerHTML`, `insertAdjacentHTML` and `new Function`; the package validator
  greps the shipped files for those plus `eval`, `document.write` and remote
  script or stylesheet tags.
- `validate-manifest.js` holds permissions to an approved list and rejects
  `host_permissions`, `optional_host_permissions` and `content_scripts` outright.
- Imported backups are validated before anything is written, and note text is
  rendered through `textContent` only. Both are tested, including with an
  `<img src=x onerror=...>` payload written directly into storage and then
  rendered — asserted inert in real Chrome.

### Performance

Search is a linear scan of 2,461 verses; measured at well under a millisecond, so
no index was added. `psalms.json` is fetched once per popup and cached. The popup
is destroyed on close, so there is nothing to keep warm.

---

## Bugs fixed

| Symptom                                                                                              | Root cause                                                                                        | Fix                                                                                         | Test                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Today's Psalm showed Psalm 2 on 1 January                                                            | `new Date(y, 0, 0)` is 31 Dec of the previous year                                                | Day of year from `Date.UTC()` on local components                                           | `dates.test.js` — 1 Jan is Psalm 1                                                                           |
| Today's Psalm changed partway through 25 Oct 2026; 29–30 Mar both showed Psalm 89; Psalm 149 skipped | A local day is 23 or 25 hours on a DST transition, but the code divided by 86,400,000             | Same fix; the arithmetic no longer involves local offsets                                   | Property tests: consecutive days advance by one, one chapter per transition day. Run in six time zones in CI |
| A verse could look saved and be gone next time                                                       | Eight `catch` blocks discarded every storage error                                                | `StorageError` with codes; UI reports failure; cache advances only after a successful write | `storage.test.js` injects quota and write failures                                                           |
| Malformed stored data could reach rendering                                                          | No validation on read                                                                             | Every record sanitised; out-of-range references dropped                                     | Unit tests plus the smoke test writing `"this is not an object"` into the store                              |
| Reading position lost on every close                                                                 | Startup called `getRandomChapterIndex()`                                                          | Resume most recent passage, else Today's Psalm                                              | Smoke test reopens the popup                                                                                 |
| Search result opened the chapter, not the verse                                                      | Handler passed only `chapterIndex`                                                                | Results carry the verse                                                                     | Smoke test asserts a `Psalm n:v` title                                                                       |
| References read "Psalms 23:1"                                                                        | —                                                                                                 | `formatReference()` — "Psalms" is the book, a chapter is a Psalm                            | `data.test.js`, smoke test                                                                                   |
| Dialog focus trap could collapse to one control                                                      | `focusableWithin()` filtered on `offsetParent`, which is `null` for any `position: fixed` element | Filter on `hidden`/`disabled` instead                                                       | `dom.test.js` Tab-cycle test; smoke test asserts both dialog buttons are focusable                           |

The last was found by writing the tests, not by reading the code.

**One suspected bug was investigated and found not to be real.** `highlightKeyword`
used a `/g` regex with `.test()` in a loop — normally a `lastIndex` bug. A
differential fuzz over every verse for 53 queries produced 127,972 comparisons
with zero mismatches: `split()` with a capturing group guarantees alternating
segments, and a failed `.test()` resets `lastIndex`. No fix is claimed for it.
Details in the audit under [D-01](OVERNIGHT_AUDIT.md#d-01).

---

## Existing user migration

**Nothing is lost, and nothing is deleted.**

Version 1.1 wrote three keys:

```
psalmsway_favourites   [{ chapterIndex, verseIndex, addedAt }]
psalmsway_history      [{ chapterIndex, verseIndex, viewedAt }]
psalmsway_settings     { theme, fontSize, lang, toolbarCollapsed }
```

On first open after the update, `loadStore()` reads all three, validates every
record, and writes a single `psalmsway` record at `schemaVersion: 2`. Then:

- **The three old keys are left exactly as they were.** A user who rolls back to
  1.1 still finds their favourites, history and theme. The cost is a few
  kilobytes of duplication, which is the right trade against losing someone's
  saved verses.
- **Migration is idempotent.** It runs only when the new key is absent; a second
  run produces the same result and writes nothing further.
- **Partial and corrupt profiles survive.** Missing keys fall back to defaults;
  malformed records are dropped and the valid ones kept.
- **A failed migration write is not fatal.** The legacy keys are untouched, so
  the next open recomputes the same result.

Verified three ways: unit tests pinned against the exact 1.1 shape; a test
asserting the legacy keys still exist afterwards; and the browser smoke test,
which writes a real 1.1 profile into `chrome.storage.local`, reloads the popup,
and checks that two favourites, one history entry and the dark theme all arrive —
and that `psalmsway_favourites` still holds its two records.

---

## Permissions

**Before**

```json
"permissions": ["storage"]
```

**After**

```json
"permissions": ["storage"]
```

**No change.** No permission was added, including for export and restore: the
download uses a `Blob` and an `<a download>` element, and the import uses
`<input type="file">`, so neither needs the `downloads` or `fileSystem`
permission.

There are still no host permissions, no optional permissions, no content scripts
and no background service worker. `scripts/validate-manifest.js` now fails the
build if any of those appear, or if a permission outside the approved list is
added.

---

## Privacy

**No network functionality was introduced. The extension still makes no network
request of any kind.**

This is not an assertion — the browser smoke test records every request the popup
makes and fails if any is not `chrome-extension://`. The final run recorded zero.

Export writes a file to the reader's own disk; restore reads one they choose.
Neither touches the network. There is no account, no OAuth, no server, no
analytics and no telemetry.

`chrome.storage.sync` was considered for cross-device sync and rejected: it
allows about 100 KB in total and 8 KB per item, so notes would eventually start
failing to save. Choosing export/import over sync is what keeps the "no network
requests" claim literally true — see the audit under
[D-05](OVERNIGHT_AUDIT.md#d-05).

---

## Test results

Real output from the final run.

```
Lint                    PASS   ESLint, 0 problems
Formatting              PASS   Prettier, all matched files
Unit and DOM tests      PASS   146 tests, 6 files
Coverage                PASS   96.12% statements on the service layer
Psalm data check        PASS   150 chapters, 2461 verses
Manifest check          PASS   MV3, permissions: storage, no host access
Package check           PASS   19 files, 359 KB unpacked, no remote code
Browser smoke test      PASS   73/73 checks, real Chrome 152
Package build           PASS   dist/psalms-way-extension.zip, 119 KB
```

Coverage by module:

```
File         | % Stmts | % Branch | % Funcs | % Lines
-------------|---------|----------|---------|--------
All files    |   96.12 |    91.76 |   94.93 |   96.12
 backup.js   |     100 |    85.29 |     100 |     100
 data.js     |     100 |      100 |     100 |     100
 dates.js    |     100 |    83.33 |     100 |     100
 dom.js      |   89.07 |     85.5 |   84.61 |   89.07
 icons.js    |     100 |      100 |     100 |     100
 search.js   |     100 |    90.62 |     100 |     100
 storage.js  |   95.67 |    93.87 |      95 |   95.67
```

The view modules (`app`, `reader`, `panels`, `notes`, `settings`) are excluded
from these thresholds and covered by the browser smoke test instead, because what
matters about them is that they work in a real extension popup. The coverage
config says so rather than quietly excluding them.

The smoke test covers: startup, Today's Psalm against the date, Psalms 1/119/150,
previous and next wrapping, the chapter picker including an out-of-range value,
random chapter and verse, favourites and their persistence across a reopen, note
creation and inert rendering of markup in note text, the Library and its tabs,
search including five regular-expression metacharacter queries and result
truncation, Escape and focus return, roving tabindex and arrow keys, history and
its confirmation dialog, all three themes and text size persisting across a
reopen, toolbar collapse persisting, no horizontal scrolling, damaged storage
recovery, migration from a real 1.1 profile, a backup round trip with four
rejection cases, zero console errors and zero network requests.

### CI

The workflow ran on the pull request and **all eight jobs passed on the first
attempt** (run `34174927156`):

```
Lint, validate and test                          PASS  17s
Browser smoke test                               PASS  38s   73/73, Chrome 152 on Linux
Date logic across time zones (UTC)               PASS   9s
Date logic across time zones (Europe/Berlin)     PASS  12s
Date logic across time zones (America/New_York)  PASS  15s
Date logic across time zones (Australia/Sydney)  PASS  14s
Date logic across time zones (Asia/Kolkata)      PASS  10s
Date logic across time zones (Pacific/Chatham)   PASS  13s
```

The browser job runs against `dist/unpacked` — the zip is built, extracted and
loaded — so what CI tests is the packaged output rather than the working tree.
`Extensions.loadUnpacked` works on the `ubuntu-latest` image under `xvfb-run`,
so no extra Chrome setup action is needed.

**Not verified:** Firefox. It is untested and is not claimed as supported.

---

## Screenshots

Ten current images in [`docs/screenshots/`](screenshots/), captured from the real
extension at 880×1120 by `npm run screenshots`:

|                        |                                         |
| ---------------------- | --------------------------------------- |
| `01-reading-light.png` | Psalm 23, light                         |
| `02-verse-actions.png` | A selected verse with Save, Note, Copy  |
| `03-library-notes.png` | Library, Notes tab                      |
| `04-search.png`        | Search results with highlighted matches |
| `05-note-editor.png`   | The note editor                         |
| `06-history.png`       | Reading history                         |
| `07-settings.png`      | Settings, including export and restore  |
| `08-reading-dark.png`  | Psalm 23, dark                          |
| `09-reading-sepia.png` | Psalm 121, sepia                        |
| `10-library-dark.png`  | Library, dark                           |

---

## Remaining issues

1. **The NIV licensing question is open.** Not introduced by this work and not
   resolved by it — see below.
2. **English only.** The misleading language menu is gone; a real localisation
   architecture was not built. Recommended order is in the audit.
3. **No "follow system theme" option.** The default is light, so a reader on a
   dark desktop who has never opened Settings gets a bright popup. Adding an
   Auto theme means changing the default for people who never chose one, which
   deserves a deliberate decision rather than an overnight one.
4. **Highlights are not implemented.** Evaluated and deferred with reasons; the
   data model and backup format already reserve space, so no migration is needed
   to add them later.
5. **Firefox is not supported.** It would need `browser_specific_settings` and
   its own test run.

---

## External actions required

1. **Confirm the licensing of the bundled Psalms text.** `psalms.json` is an
   English NIV text, which is under copyright to Biblica. The repository has
   never claimed otherwise and still does not — the README states plainly that
   the text is not covered by the MIT licence. This needs either written
   permission or a switch to a public-domain translation; the companion Android
   repository already contains a complete KJV in the identical format, so the
   swap would be a file replacement. **Worth settling before the next store
   submission.** Full detail in the audit under External actions.

2. **Update the Chrome Web Store listing** when you publish. The manifest is at
   1.2 with a rewritten description; the listing text, screenshots and privacy
   declarations can only be changed from the dashboard. `docs/screenshots/` has
   ten current images. **Nothing was published or uploaded.**

3. **Review and merge the draft pull request.** It is left as a draft
   deliberately; nothing was merged to `main`.
