# Overnight audit — Psalms Way! browser extension

Audit of the extension as released in version 1.1, at commit `5c17a6a`.

Everything below was checked against the code and, where it concerns runtime
behaviour, reproduced before being written down. Findings that turned out not
to be real are recorded too, under [Investigated and dismissed](#investigated-and-dismissed),
because a claimed fix for a bug that never existed is worse than no fix.

## Contents

- [What version 1.1 was](#what-version-11-was)
- [Feature inventory](#feature-inventory)
- [Findings](#findings)
- [Investigated and dismissed](#investigated-and-dismissed)
- [Decisions](#decisions)
- [External actions](#external-actions)

---

## What version 1.1 was

|          |                                                                                            |
| -------- | ------------------------------------------------------------------------------------------ |
| Manifest | V3, `permissions: ["storage"]`, no host permissions, no content scripts, no service worker |
| Source   | `popup.html` (238 lines), `popup.js` (651 lines), `style.css` (619 lines)                  |
| Data     | `psalms.json`, 150 chapters, 2,461 verses, 224 KB                                          |
| Build    | None. No `package.json`, no dependencies                                                   |
| Tests    | None                                                                                       |
| CI       | None                                                                                       |

The architecture was sound and is kept: plain HTML, CSS and JavaScript, all data
bundled, no network, one permission. The problems were in the details.

---

## Feature inventory

Every capability in 1.1, with what the audit found.

| Feature              | Entry point            | State             | Verdict                                              |
| -------------------- | ---------------------- | ----------------- | ---------------------------------------------------- |
| Today's Psalm        | `btnTodaysPsalm`       | derived from date | **Broken** — [F-01](#f-01)                           |
| Random verse         | `btnVerse`             | `Math.random`     | Sound                                                |
| Random chapter       | `btnChapter`           | `Math.random`     | Sound                                                |
| Previous / next      | `btnPrev`, `btnNext`   | module variable   | Sound, wraps correctly                               |
| Chapter jump         | `txtChapter`, `btnGo`  | —                 | Works; rejects with `alert()` — [F-08](#f-08)        |
| Chapter render       | `updateContent`        | —                 | Works; 176 tab stops — [F-09](#f-09)                 |
| Verse render         | `updateContent`        | —                 | Works                                                |
| Copy verse           | `copyVerse`            | clipboard         | Works; wrong reference wording — [F-06](#f-06)       |
| Search               | `performSearch`        | —                 | Works; escaping correct — [D-01](#d-01)              |
| Search highlight     | `highlightKeyword`     | —                 | Correct — [D-01](#d-01)                              |
| Search result open   | click handler          | —                 | **Opens the chapter, not the verse** — [F-05](#f-05) |
| No-result state      | `renderSearchResults`  | —                 | Present; indistinguishable from the initial state    |
| Favourites           | `psalmsway_favourites` | array             | **Saves can fail silently** — [F-02](#f-02)          |
| History              | `psalmsway_history`    | array, cap 20     | Same silent-failure problem                          |
| Settings             | `psalmsway_settings`   | object            | Same; no validation — [F-03](#f-03)                  |
| Light / sepia / dark | `data-theme`           | persisted         | Works                                                |
| Font size            | `data-size`            | persisted         | Works                                                |
| Toolbar collapse     | `toolbarWrapper`       | persisted         | Works                                                |
| Language selector    | `selectLang`           | persisted         | **Does nothing** — [F-07](#f-07)                     |
| Popup lifecycle      | `DOMContentLoaded`     | —                 | **Reading position lost on close** — [F-04](#f-04)   |
| Keyboard access      | —                      | —                 | No focus management — [F-10](#f-10)                  |
| Offline              | bundled JSON           | —                 | Genuinely offline. Confirmed: zero network requests  |

---

## Findings

Severity: **P0** security, corruption or privacy · **P1** broken important feature ·
**P2** significant product or architecture problem · **P3** polish.

No P0 was found. The extension was not leaking data, requesting excess
permissions, or executing remote code.

---

### F-01

**Today's Psalm shows the wrong Psalm, and changes mid-day** · **P1** · Fixed · Verified

_Feature:_ Today's Psalm

_Evidence._ `getDailyChapterIndex()` computed the day of the year by
subtracting two `Date` objects and dividing by `86400000`:

```js
const start = new Date(now.getFullYear(), 0, 0);
const dayOfYear = Math.floor((now - start) / 86400000);
return dayOfYear % 150;
```

Reproduced in `Europe/Berlin`:

```
1 January            -> Psalm 2      (should be Psalm 1)
Sun 25 Oct 2026      -> Psalm 148 at 00:30, Psalm 149 at 12:30
Sun 29 -> Mon 30 Mar -> Psalm 89 on both days
Sun 25 -> Mon 26 Oct -> Psalm 148 then Psalm 150; Psalm 149 never shown
```

_Root cause._ Two independent errors.

1. `new Date(y, 0, 0)` is 31 December of the _previous_ year, so 1 January
   yielded a day-of-year of 1 and therefore index 1, which is Psalm 2.
2. A local calendar day is not always 86,400,000 ms. On a daylight-saving
   transition it is 23 or 25 hours, so the division drifted by a day. That is
   why one calendar day could span two Psalms, and why a Psalm could be
   repeated or skipped.

Only the first error is visible in a zone without daylight saving, which is
probably why it survived: in UTC the function looks merely off by one.

_Fix._ `src/dates.js` builds both endpoints with `Date.UTC()` from the _local_
year, month and day. UTC days are always exactly 86,400,000 ms apart, so the
arithmetic cannot drift, and 1 January is day 1 and therefore Psalm 1.

_Verification._ `test/dates.test.js` asserts properties rather than fixed
values, so it holds in any time zone: consecutive days advance by exactly one,
every hour of a transition day maps to one chapter, and the sequence wraps from
Psalm 150 to Psalm 1. Checked against the old implementation, these properties
fail four times in `Europe/Berlin` and once in UTC. CI runs the date suite in
six zones, including `Pacific/Chatham`, which has a 45-minute offset.

---

### F-02

**A failed save was reported as a success** · **P1** · Fixed · Verified

_Feature:_ Favourites, history, settings

_Evidence._ All eight storage helpers in `popup.js` discarded their errors.
Eight `catch` blocks swallowed everything; three did so with the comment
`/* fail silently */`:

```js
async function saveFavourites(arr) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_FAVOURITES]: arr });
  } catch {
    /* fail silently */
  }
}
```

The heart still filled in, because the UI updated from local state rather than
from the result of the write. If the quota was exceeded or the profile was
read-only, the verse appeared saved and was gone on the next open, with nothing
logged.

_Root cause._ No layer owned storage, so error handling was per-call-site and
the easiest thing to write was nothing.

_Fix._ `src/storage.js` is the only module that touches `chrome.storage.local`.
Writes reject with a `StorageError` carrying a code (`quota_exceeded`,
`write_failed`, `unavailable`, `read_failed`). Callers report failure through
the status line. The in-memory cache advances only after a write succeeds, so a
failed save cannot leave the popup showing state that is not on disk.

_Verification._ `test/storage.test.js` injects quota and write failures and
asserts both the rejection and that the failed change is not visible afterwards.

---

### F-03

**Stored data was trusted without validation** · **P2** · Fixed · Verified

_Feature:_ All persistence

_Evidence._ `loadFavourites()` returned `result[KEY] || []` and the panel then
did `favs.forEach(({chapterIndex, verseIndex}) => ...)`. A stored string, a
`null` entry, or a chapter index of 9999 flowed straight into rendering. The
settings loader had the same shape, so `theme: "neon"` would be written to
`data-theme` and silently produce an unthemed popup.

_Root cause._ Local extension storage was treated as trusted. It is not: users
upgrade across versions, restore backups, and edit it by hand during
development.

_Fix._ Every record is sanitised on read. Chapter indices must be integers in
range, timestamps must be plausible, notes must be non-empty strings, settings
values must be members of a known set. Anything else is dropped; the rest is
kept. Verse indices are additionally checked against the loaded text at render
time, so a reference to a verse that does not exist cannot blank the view.

_Verification._ Covered in `test/storage.test.js`, and end to end in the browser
smoke test, which writes `"this is not an object"` into the store and asserts
the popup still renders.

---

### F-04

**The popup lost your place every time it closed** · **P2** · Fixed · Verified

_Feature:_ Popup lifecycle

_Evidence._ Startup was:

```js
currentChapter = getRandomChapterIndex();
updateContent(false, currentChapter);
```

Closing the popup mid-Psalm and reopening it gave an unrelated chapter.

_Root cause._ A deliberate choice for a simpler product, but it works against
the popup's own lifecycle: the popup is destroyed on close, so "where I was" has
to be read back from storage or it is gone.

_Fix._ The popup opens on the most recent passage in reading history, and on
Today's Psalm for a first-time reader. Both random buttons are still one click
away.

---

### F-05

**Search results opened the chapter, not the verse** · **P2** · Fixed · Verified

_Evidence._ `renderSearchResults` bound `updateContent(false, chapterIndex)`.
Searching "shepherd", getting `Psalm 78:71`, and clicking it opened Psalm 78 at
verse 1 — a 72-verse chapter with no indication of where the match was.

_Fix._ Results open the exact verse. Favourites and history rows do the same.

---

### F-06

**References read "Psalms 23:1"** · **P2** · Fixed · Verified

_Evidence._ Titles, copied text and every list row used `Psalms ${n}`.

_Root cause._ "Psalms" is the book; a single chapter is "a Psalm". The companion
Android app already formats references as `Psalm {{chapter}}:{{verse}}`
(`i18n/locales/en.json`), so the extension was inconsistent both with English
usage and with its own sibling product.

_Fix._ `formatReference()` produces `Psalm 23` and `Psalm 23:1`, used everywhere
including the clipboard.

---

### F-07

**The language menu offered four languages that do not exist** · **P2** · Fixed · Verified

_Evidence._ The settings panel listed Spanish, French, German and Portuguese as
`disabled` with "(coming soon)". Selecting English wrote `lang` to storage,
which nothing read.

_Fix._ The menu is removed. Advertising four unavailable languages in a
five-row settings panel costs trust and space and buys nothing. The stored
`lang` key is retained and validated so the setting survives if localisation is
built later. See [Decisions](#d-04).

---

### F-08

**`alert()` and `confirm()` for routine feedback** · **P2** · Fixed · Verified

_Evidence._ An out-of-range chapter number raised `alert("Please enter a valid
chapter number between 1 and 150.")`; clearing history used `confirm()`.

_Root cause._ Both are unstyleable, block the renderer, and sit outside the
popup's own theming and focus model.

_Fix._ A live-region status line for messages and a focus-trapping dialog for
confirmations. The dialog closes on Escape and restores focus to whatever
opened it.

---

### F-09

**A 176-verse chapter was 176 tab stops** · **P2** · Fixed · Verified

_Evidence._ Every verse in the chapter list carried a click handler; Psalm 119
has 176 verses. Reaching the toolbar by keyboard meant tabbing through all of
them.

_Fix._ The verse list is a roving tab stop: one stop for the list, arrow keys to
move within it, Home and End to jump, Enter or Space to open a verse's actions.

_Verification._ The smoke test asserts exactly one verse carries `tabindex="0"`
and that ArrowDown moves between verses.

---

### F-10

**No focus management between views** · **P2** · Fixed · Verified

_Evidence._ Opening Search focused the search field, which was the only such
handling. Closing any panel left focus on `<body>`, so a keyboard user restarted
from the top of the popup. Nothing closed on Escape.

_Fix._ Opening a panel moves focus into it, Escape closes it, and focus returns
to the control that opened it. The note editor focuses its textarea and returns
focus to the verse. Panels whose first control is `Close` or `Clear` focus the
panel body instead, so Enter does not immediately dismiss or delete.

---

### F-11

**Icon markup was assigned through `innerHTML` and duplicated** · **P3** · Fixed · Verified

_Evidence._ Nine `innerHTML =` assignments in `popup.js`. The same heart path
appeared in five places, rebuilt on every toggle.

_Assessment._ Not a vulnerability: every string was a static literal, with no
interpolation of stored or user text. It is still worth removing, because it
made "no markup assignment anywhere" impossible to enforce mechanically.

_Fix._ `src/icons.js` holds each path once and builds SVG with
`createElementNS`. Nothing in the extension assigns `innerHTML`, and ESLint
fails the build on `innerHTML`, `outerHTML`, `insertAdjacentHTML` and
`new Function`.

---

### F-12

**Two `<label for>` attributes pointed at `<div>` elements** · **P3** · Fixed · Verified

_Evidence._ `popup.html` lines 197 and 205: `for="themeOptions"` and
`for="fontSizeOptions"` both targeted `<div>`s. A `<label>` only associates with
a form control, so these groups had no accessible name.

_Fix._ Both are `<fieldset>`/`<legend>` groups, which is what a labelled set of
buttons is.

---

### F-13

**Dead CSS** · **P3** · Fixed · Verified

_Evidence._ `.footer` and `.footer a` were defined but no element carried the
class; `.sub-header-right` likewise.

_Fix._ The stylesheet was rewritten around design tokens. Every remaining
selector matches something.

---

### F-14

**The in-repo GitHub link used the repository's former name** · **P3** · Fixed · Verified

_Evidence._ The settings footer linked to `atj393/cx-psalms-way`. That resolves,
via GitHub's rename redirect, to `psalms-way-browser-extension` — so it worked,
but depended on a redirect that only exists until the old name is claimed by
someone else.

_Fix._ Links to the current repository.

---

### F-15

**Search did not say results were truncated** · **P3** · Fixed · Verified

_Evidence._ `SEARCH_MAX = 50`. Searching "the" showed 50 rows with nothing to
indicate that hundreds more existed.

_Fix._ The panel reports either `N matches` or `Showing first 50 of N matches`.

---

### F-16

**`CLAUDE.md` described a different codebase** · **P3** · Fixed · Verified

_Evidence._ It stated `popup.js` was "~107 lines" (it was 651), `style.css`
"~128 lines" (619), and `permissions: []` (it was `["storage"]`). It documented
neither favourites, history, settings, search, themes nor the toolbar.

_Fix._ Rewritten against the current code.

---

### F-17

**No automated tests and no CI** · **P3** · Fixed · Verified

_Fix._ 146 unit and DOM tests, a 73-check browser smoke test against the real
extension, three validators, and a CI workflow that runs all of them plus the
date suite across six time zones.

---

## Investigated and dismissed

### D-01

**Search highlighting and regex escaping — not a defect**

`highlightKeyword()` built a `/g` regular expression and then called
`re.test(part)` once per segment inside a loop. That pattern is usually a bug,
because `.test()` on a `/g` regex advances `lastIndex` between calls, and it was
the first thing this audit expected to find.

It was checked rather than assumed. A differential fuzz compared the shipped
implementation against a stateless reference across every verse in the book for
53 query strings, including every regular-expression metacharacter, quotes and
Unicode:

```
comparisons : 127,972
threw       : 0
text loss   : 0
mismatches  : 0
```

The reason it is safe: `String.split()` with a capturing group always produces
alternating non-matching and matching segments, and a failed `.test()` resets
`lastIndex` to 0. The intervening non-match always resets the state before the
next match is tested.

The escaping in `performSearch` was also correct: the character class
`[.*+?^${}()|[\]\\]` covers every metacharacter that matters when the result is
used as a literal.

No fix was claimed for either. `splitMatches()` in `src/search.js` uses
`matchAll` instead — a readability change, not a bug fix — and the fuzz survives
as a test.

### D-02

**`chrome.storage.sync` — rejected on the evidence**

Considered for cross-device sync and rejected. `storage.sync` allows about
100 KB in total and 8 KB per item, and rejects writes beyond that. Notes are
free text, so a reader who writes steadily would eventually hit the ceiling and
have saves start failing. See [D-05](#d-05) for what was built instead.

### D-03

**Verse highlighting — evaluated, deliberately not built**

See [Decisions](#d-06).

---

## Decisions

<a id="d-04"></a>

### Favourites, not Bookmarks

The Android app has **both** `bookmarks` and `favorites` as separate concepts in
`i18n/locales/en.json`, with separate services and separate empty states. That
is not a model to copy into a 440px popup: two saved-item lists a reader cannot
tell apart is worse than one.

The extension keeps a single concept and keeps calling it **Favourites**, the
name its existing users already have, in the British spelling already used
throughout its UI and store listing. This is an intentional divergence from
Android's American "Favorites" and is recorded here so it is not "corrected"
later by mistake.

The storage key `psalmsway_favourites` is unchanged.

### Language menu removed rather than localised

Building a translation architecture is the larger and more useful piece of work,
but it is not something to start and leave half-finished overnight, and shipping
four disabled options is actively misleading. The menu is gone; the validated
`lang` setting remains so nothing has to be migrated when localisation is built
properly. Recommended follow-up, in order: extract UI strings to a dictionary,
detect `navigator.language`, allow an override, fall back to English.

<a id="d-05"></a>

### Export and import, not cloud sync

Manual export and restore of a versioned JSON file. Reasons, in order:

- Core reading stays completely offline, so the privacy claim stays literally
  true. No account, no OAuth, no server, no new permission.
- It has no quota, unlike `storage.sync` — see [D-02](#d-02).
- It works across browsers and profiles, and to a file the reader controls.
- The download uses a `Blob` and an `<a download>` element, so it needs no
  `downloads` permission.

Imported files are treated as hostile: wrong type, unparseable JSON, a future
schema version, an oversized file and malformed records are each rejected with a
specific message, and anything that survives goes through the same sanitisers as
stored data.

<a id="d-06"></a>

### Highlights evaluated and deferred

Verse highlighting was assessed against notes and favourites for the same
screen space and not built. The reasoning:

- The per-verse action row is the scarcest space in the product. It currently
  holds three controls at 440px. A colour palette makes it four plus a swatch
  row, and every verse row gains a third state to render and keep in sync.
- Notes carry more of what a reader would want to come back to. A highlight
  records _that_ a verse mattered; a note records _why_. Favourites already
  cover the first.
- Highlights are only worth having if they persist, export, restore and render
  correctly in all three themes — the same cost as notes, for less.

The data model already reserves a `highlights` array and the backup format
carries it, so adding them later needs no migration. If they are built, the
recommendation is a fixed four-colour palette checked for contrast in all three
themes, not a colour picker.

### Scripture translations not expanded

The Android app bundles 81 translations. None were copied. See
[External actions](#external-actions).

---

## External actions

Things that need a person, and specifically things this work deliberately did
not do.

### 1. Confirm the licensing of the bundled text — do this before the next release

`psalms.json` is the NIV. Psalm 23:1 reads "The LORD is my shepherd, I shall not
be in want", which is the 1984 NIV wording. The NIV is under copyright to
Biblica, and its published permissions policy limits how much text may be
reproduced without written permission, with thresholds well below a complete
book.

The repository does not misstate this. `README.md` already said the bundled text
"is **not** covered by that licence and remains under its own respective terms",
which is accurate, and that wording has been kept and made more prominent. No
claim of public domain has ever been made and none was added.

This is flagged, not fixed, because it is a legal question and not a code one.
Two options if permission cannot be confirmed:

- Obtain written permission from Biblica for distribution in the extension.
- Switch the bundled text to a public-domain translation. The companion Android
  repository already contains `psalms-en-kjv.json`, a complete 150-chapter KJV
  in the same array-of-arrays shape this extension expects, so the swap is a
  file replacement rather than a rewrite. It would change the reading experience
  and should be a deliberate product decision, which is why it was not done
  overnight.

Nothing in this change increases the exposure: the same text is bundled as
before, at the same size, distributed the same way.

### 2. Chrome Web Store listing

The manifest version is now `1.2` and the description has been rewritten. The
store listing itself, its screenshots and its privacy declarations cannot be
updated from the repository. `docs/screenshots/` holds ten current images at
880×1120 suitable for the listing.

Nothing was published or uploaded.

### 3. Verify CI on the first pull request

The workflow has not run — it cannot until the branch is pushed and a pull
request exists. The browser job uses `xvfb-run` with the runner's preinstalled
Chrome; if `Extensions.loadUnpacked` is unavailable on that image, the smoke
test job will need `browser-actions/setup-chrome`. Everything else in the
workflow was run locally and passes.
