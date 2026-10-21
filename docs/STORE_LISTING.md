# Chrome Web Store listing

The text and answers to enter in the Chrome Web Store developer dashboard for
version 3.0. Every fact comes from the code, `manifest.json` or `PRIVACY.md`.
Where a fact cannot be checked from this repository it says **Unknown**.

## Name

Psalms Way

This is the manifest `name`. Whether the live listing shows a longer title is
**Unknown** (the listing's address ends `psalms-way-biblical-begin`).

## Short description

The store takes this from the manifest `description`, so it must stay the same
(limit 132 characters; it is 126):

```
All 150 Psalms in 80 Bible versions and 47 languages. Bookmarks, highlights, notes, prayers and progress. Optional phone sync.
```

## Full description

Plain text, as the store shows it:

```
Psalms Way puts all 150 Psalms in your browser toolbar, in 80 Bible versions and 47 languages. Everything is built into the extension, so it opens instantly and works offline.

READ
- 80 Bible versions in 46 languages, chosen from a list with a filter box. English readers start on the NIV (1984).
- Today: the verse of the day, Today's Psalm and your reading streak.
- One Verse and New Chapter for something at random, or step between Psalms and jump to any number from 1 to 150.
- Search all 150 Psalms in the version you are reading.
- Compare one verse in three versions, side by side.

KEEP
- Bookmark a verse, highlight it in yellow, green, blue or pink, write a note on it, or copy it.
- Click the heart to keep a whole Psalm.
- The Library holds your bookmarks, highlights, favourite Psalms and notes. History lists what you read last.

PRAY AND GROW
- 50 prayers in 19 categories, in English, each with Scripture references that open the Psalm.
- Progress: your reading streak, the last seven days, nine badges and six reading challenges.

MAKE IT YOURS
- Light, sepia, dark and auto themes, five accent colours and three text sizes.
- 47 languages, with a right-to-left layout for Arabic, Persian, Hebrew, Urdu and Uyghur.

SYNC WITH THE PSALMS WAY PHONE APP (OPTIONAL)
- Connect the same Google account as the phone app, and your bookmarks, notes, highlights, favourite Psalms, history, streak, badges and challenges stay the same on both.
- They are kept in a private app folder in your own Google Drive that only Psalms Way can see. There is no Psalms Way server, and the developer never receives your data.

PRIVATE BY DESIGN
- Without sync, the extension makes no network requests at all.
- The only permission is storage. Google sign-in is asked for only if you connect sync.
- It cannot see or change the pages you visit. No analytics, no ads, no tracking.
- There are no reminders or notifications.

Each Bible version keeps its own terms; its credit line is shown in the version list. The extension's code is open source (MIT licence): github.com/atj393/psalms-way-browser-extension
```

## What's new in 3.0

```
80 Bible versions with a picker. 47 languages, with right-to-left layout. Light, sepia, dark and auto themes and five accent colours. Highlights and favourite Psalms. Today with the verse of the day. Compare. 50 prayers. Progress with streaks, badges and challenges. Optional sync with the Psalms Way phone app through your own Google Drive.
```

## Other fields

| Field                | Value                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version              | 3.0 (`manifest.json`)                                                                                                                                                                                                                 |
| Category             | Unknown (not recorded anywhere in the repository)                                                                                                                                                                                     |
| Language of the page | English. Translated store pages: Unknown (none are written)                                                                                                                                                                           |
| Website              | https://github.com/atj393/psalms-way-browser-extension                                                                                                                                                                                |
| Support              | https://github.com/atj393/psalms-way-browser-extension/issues                                                                                                                                                                         |
| Feedback form        | The link in the README (the same one the extension's Settings shows)                                                                                                                                                                  |
| Privacy policy       | `PRIVACY.md` in this repository, effective 20 October 2026. Its public address is Unknown until it is on GitHub: `https://github.com/atj393/psalms-way-browser-extension/blob/main/PRIVACY.md` is where it will be on the main branch |
| Store icon           | `icon128.png` (128 x 128)                                                                                                                                                                                                             |
| Promotional images   | Unknown (none are in the repository)                                                                                                                                                                                                  |

## Screenshots to upload

Ready to upload: `docs/store/store-1.png` … `store-5.png`, 1280 x 800 each. Each
puts one of the popup screenshots below beside a short headline: All 150 Psalms,
80 Bible versions, Compare, a daily habit (Progress), and an Arabic right-to-left
page. Check the dashboard for the current size and number rules.

The popup screenshots themselves are 880 x 1200 pixels (the popup's 440 x 600 at
twice the density), made by `node scripts/screenshots.js` from the real extension,
so they never show anything the extension does not do. Suggested order if you
upload them directly:

| #   | File                                     | What it shows                                                                   |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `docs/screenshots/01-reading-light.png`  | Psalm 23 in the NIV, with a highlighted verse and a favourite Psalm (the heart) |
| 2   | `docs/screenshots/12-today.png`          | Today: verse of the day, Today's Psalm and the streak                           |
| 3   | `docs/screenshots/13-compare.png`        | One verse in three Bible versions                                               |
| 4   | `docs/screenshots/15-progress.png`       | Reading streak, the last seven days and reading totals                          |
| 5   | `docs/screenshots/18-reading-arabic.png` | An Arabic Bible in the right-to-left layout                                     |

Spares, if one above is dropped:

| File                                          | What it shows                                                      |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `docs/screenshots/11-versions.png`            | The Bible version picker, grouped by language                      |
| `docs/screenshots/14-prayers.png`             | A prayer with its Scripture references                             |
| `docs/screenshots/16-library-highlights.png`  | The Library's Highlights tab                                       |
| `docs/screenshots/17-settings-appearance.png` | Settings: theme, text size, accent colour and language (in German) |
| `docs/screenshots/02-verse-actions.png`       | A selected verse with Bookmark, Highlight, Note, Copy and Compare  |
| `docs/screenshots/08-reading-dark.png`        | The dark theme                                                     |

The other screenshots (`03`, `04`, `05`, `06`, `07`, `09`, `10`) are for the README
and the user guide.

## Privacy practices tab

### Single purpose

Read the Psalms: all 150 Psalms in a toolbar popup, in many Bible versions and
languages, with tools to keep, compare and track the reader's reading.

### Permission justifications

| Permission            | Justification                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`             | Keeps the reader's bookmarks, notes, highlights, favourite Psalms, history, reading progress and settings in the browser (`chrome.storage.local`).                    |
| `identity` (optional) | Requested only when the reader chooses to connect sync. It opens Google's sign-in so the reader can use the same account as the phone app. Never requested otherwise. |
| Host permissions      | None. The extension cannot read or change any web page.                                                                                                               |
| Content scripts       | None.                                                                                                                                                                 |
| Remote code           | None. All code and all Bible text are in the package.                                                                                                                 |

### Data the developer collects

**None.** From `PRIVACY.md`: the developer never receives, sees or stores the
reader's data. There is no Psalms Way server, no advertising, no analytics and no
tracking.

What the extension keeps, on the reader's own browser only: bookmarks, notes,
highlights, favourite Psalms, reading history, streak, badges, challenge progress
and settings.

The one transfer, and only if the reader connects sync: that data (except this
extension's own look-and-feel settings, which stay on the browser) goes, as one
file, from the browser straight to a hidden app folder in the reader's own Google
Drive (the `drive.appdata` scope, which cannot see any other file in the Drive). The
reader's email address is read from Google to show which account is connected, and
stays on the device. Sign-in tokens are held in browser memory (`chrome.storage.session`)
and are not shared.

Certifications, as far as `PRIVACY.md` states them: the data is used only to keep
the reader's own devices in step; it is never sold, never used for advertising and
never transferred to anyone; the use of Google API data follows the Google API
Services User Data Policy, including the Limited Use requirements.

Which data-type boxes the dashboard wants ticked for the optional Drive transfer is
**Unknown**: it depends on how the store defines collecting data, which cannot be
checked from this repository. Answer from the facts above.

### Children

`PRIVACY.md`: Psalms Way collects no personal information from anyone, including
children.
