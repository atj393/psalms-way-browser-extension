# Connecting the phone app and the browser extension: roadmap

First written 2026-10-13 · Updated 2026-10-20 · Status: plan agreed in conversation; step 0 done.
Every later step gets its own design, spec and step-by-step plan, approved by the owner, before any
code is written.

Repositories:

- Phone app: `github-repos/psalms-way-app` (React Native, Android).
- Browser extension: `github-repos/psalms-way-browser-extension` (Chrome MV3, no build step),
  published as `aplafmlmecdjlmcgbibmlbjnilcomcnl`.

## Goal

One Psalms Way, on phone and in the browser, under one brand. A reader signs in with the same Google
account in both, and anything they save on one shows up on the other. The extension gains the
phone's features and all of its translations and languages. Signing in stays optional: without it,
the extension keeps working offline and privately, as it does today.

## Decisions

| Topic                   | Decision                                                                                                                                                                                                                                  | From                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Order                   | Phone sync upgrade, extension groundwork, one brand, extension sign-in and sync. Translations and languages, then the remaining features.                                                                                                 | Owner                     |
| Brand                   | One brand for both: the same name, icon, colours and wording. They stay two apps with two codebases.                                                                                                                                      | Owner (codebases assumed) |
| Translations            | All 82 translations ship inside both packages: the phone as now, the extension the same way. Public hosting (GitHub, npm or Drive) is postponed and may be revisited later.                                                               | Owner, 2026-10-20         |
| UI languages            | All 47 ship inside both packages.                                                                                                                                                                                                         | Assumed                   |
| Extension's default     | NIV 1984 stays the default English text.                                                                                                                                                                                                  | Owner                     |
| Google Cloud project    | The new project (number 873591523011) holds the phone's Android client and the extension's clients. The old project `dulcet-outlook-496910-b7` is retired.                                                                                | Owner, 2026-10-20         |
| Where synced data lives | The user's own Google Drive, private app folder, the same `psalms-way-backup.json` the phone writes. No server.                                                                                                                           | Assumed (not changed)     |
| What syncs              | Bookmarks, favourites, highlights, notes, history, streak, badges and challenges. Settings stay per device.                                                                                                                               | Assumed (not changed)     |
| Sync behaviour          | Two-way: adding, changing and deleting on either device reaches the other within about a minute, or on the next open. Not instant.                                                                                                        | Assumed (not changed)     |
| Extension data model    | The phone's. The extension's current "Favourites" (single verses) become Bookmarks, and whole-chapter Favourites are added. This reverses the "one list only" decision in `docs/OVERNIGHT_AUDIT.md`, because both apps' lists must match. | Assumed (not changed)     |
| Browsers                | Chrome and Edge, as today. Firefox is out of scope. The owner chose not to test Edge in the spike.                                                                                                                                        | Owner                     |

## Findings that shape the work

From the extension survey, checks on both repositories and the spike:

1. **Numbering.** The extension counts from 0 (`chapterIndex` 0–149, `verseIndex` 0+, `null` for a
   whole chapter in history). The phone counts from 1 (`isChapter` 1–150, `isVerseNumber` ≥ 1).
2. **Lists.** The extension's `favourites` are verses, which matches the phone's `bookmarks`. The
   phone's `favorites` are chapter numbers. Phone bookmarks have no timestamp; extension favourites
   have `addedAt`.
3. **The extension changes data whenever it loads or saves.** `normaliseStore()` runs on load, save,
   migration and restore. It trims notes, cuts them at 2,000 characters, keeps at most 500 notes and
   keeps only the first note on a verse. A phone note would be altered and then uploaded. This must
   stop before sync.
4. **The phone's backup assumes one phone at a time.** The combine is a union, so an item deleted on
   one device comes back from the other (the "known trade-off" in the cloud backup design). Uploads
   run only when the app opens or returns to the foreground, so a change made just before closing
   waits until the next open.
5. **The extension's rules block this work on purpose.** `scripts/validate-manifest.js` rejects a
   background worker and any new permission. `scripts/smoke-test.js` fails on any network request.
   `CLAUDE.md` lists accounts, background workers and network access as non-goals. This project
   changes those rules deliberately; the account stays optional.
6. **No change listener.** The extension has no `chrome.storage.onChanged` listener, so an open popup
   would not show data a background sync just changed.
7. **Sign-in in the extension works without a client secret.** `launchWebAuthFlow` with Google's
   account picker returns a one-hour token and no refresh token, and renews silently (see step 0).
   Edge has no `chrome.identity.getAuthToken`; silent renewal in Edge is untested.
8. **Verse numbering differs in 13 of 81 translations** (verse counts compared with the KJV). Five
   count the psalm heading as verse 1 (afri, oster, pol_nbg, wlc, wo_kyg). Two are incomplete
   (lt_heritage: 137 chapters, 850 verses; ta_oitce: 148 chapters). Six differ in 1–18 chapters
   (bo_ntb, bungo, martin, te_irv, turkish, ug_ara). Positions are what sync, so on these a bookmark
   can land a verse off; already true on the phone when switching translations. NIV 1984 and KJV
   match in every chapter.
9. **Licences, from each file's own notice** (81 extracted files plus NIV): 50 public domain, 20
   Creative Commons, 12 restricted. The 12: NIV 1984 (`modern`, identical to the extension's
   `psalms.json`); NET Bible (`net`, used with permission); Uwspółcześniona Biblia Gdańska
   (`pol_ubg`); Afrikaans 1953 (`afri`), Schlachter (`schlachter`), Thai KJV (`thaikjv`) and
   Terjemahan Baru (`indo_tb`), copyrighted with non-commercial copying allowed; Reina Valera Gómez
   2010 and 2004 (`rvg`, `rvg_2004`, rights reserved); Kannada KJV (`kn_kjv`, copyright unknown);
   Fidela (`fidela`); Nowej Biblii Gdańskiej (`pol_nbg`). Shipping them in both packages is the
   owner's decision; the licensing question recorded in the extension's docs remains open.
10. **Size of bundling every translation in the extension.** 82 files, 26 MB installed (already
    compact; minifying saves under 1 %), about 6.5 MB zipped. Today's package is 365 KB installed and
    121 KB zipped. The largest single translation is 770 KB; NIV is 221 KB. The phone's 47 UI locale
    files total 855 KB.

## Steps

### 0. Spike: can the extension share the phone's Drive folder? (done)

A throwaway test extension with a fixed ID and two "Web application" OAuth clients.

- Headless Chrome 154 and Edge 155 (2026-10-13): the test extension loads with its fixed ID in both;
  a jsDelivr download and Drive API calls work from the page and from the background worker without
  host permissions (Google echoes the extension's origin in its cross-origin headers, and its
  preflight allows authorised multipart uploads).
- Owner's run in Chrome 155 (2026-10-20), new Cloud project:
  - **Shared folder: yes.** A file created through client A was listed by client B and the other
    way round, on the same account.
  - **Silent renewal: yes** (without a restart). After the tokens were dropped, both clients got a
    new one-hour token without any window, in 345–418 ms.
  - **Account email: yes.** Drive `about.get` returned it with only `drive.appdata`.
  - **Optional permission: yes.** `identity` was granted at runtime from the page, and the
    background worker could use it immediately.
  - First sign-in took about 10 s (account picker and consent); the second client's about 4 s.
  - The test files were deleted afterwards.
- Not tested: Edge with a real sign-in (owner's choice), renewal after a browser restart, and the
  phone's Android client reading the same folder. The last one is checked when the phone is first
  tested on a device after step 1.

Clean-up when no longer needed: delete the "Psalms Way spike A" and "B" clients, remove the test
extension, and delete the two `client_secret_873591523011-…json` files from Downloads.

### 1. Phone sync upgrade (phone repository)

Goal: deletions and edits sync both ways, and changes upload soon after they are made.

Proposed approach, to be designed and approved:

- Each device keeps a local copy of the data it last synced. Combine three ways, item by item: if
  only one side changed since the last sync, that side wins. When both changed, a rule decides: notes
  keep both texts, as today; an edit beats a deletion; history keeps the later date; streak, badges
  and challenges keep their current rules.
- A device without a local copy (first connect, reinstall, cleared storage) combines both sides as
  today, so nothing is lost.
- Upload shortly after any change to synced data, and when the app goes to the background, as well
  as on open and return to the foreground.
- The cloud file format stays at schema 1, so current builds keep working.
- Shared test cases (JSON inputs and expected results) that the extension's version must also pass.

Before starting: commit the current cloud backup work so the upgrade is a clean diff on top (only if
the owner asks).

Done when, with two phones on one account (or one phone and the extension later), an item added,
edited or deleted on one shows the same way on the other after it opens; deleted items stay deleted;
existing tests stay green.

### 2. Extension groundwork (extension repository)

Goal: the extension can sync safely, while users notice little.

- Store schema 3 with the phone's data model: bookmarks, favourite chapters, highlights, notes and
  history, plus streak, badges and challenges carried through unchanged until those features exist.
  Non-destructive migration from schema 2, keeping the old key the way the 1.1 migration does.
- Stored data is never altered on load or save: no trimming, no 2,000-character cut, no 500-note
  cap, no dropped duplicates. An input limit in the note editor may stay.
- "Favourites" becomes "Bookmarks" in the interface.
- Strings move into an English dictionary with a small `t()` helper, ready for translation.
- A background service worker, and a `chrome.storage.onChanged` listener so an open popup refreshes.
- The enforced rules updated: the manifest allow-list, the smoke test's network rule (still zero
  requests while not connected), and the `CLAUDE.md` non-goals.

Done when real 1.1 and 2.0 profiles migrate intact (tests); the only visible change is the
Bookmarks label; `npm run check` and the browser smoke test pass with zero network requests.

### 3. One brand (both repositories)

Goal: phone and extension look and read as one product before the first connected release.

- Decide with the owner: the product name (today "Psalms Way" on the phone and "Psalms Way! -
  Biblical Beginnings" in the extension), icon, colour palette (the phone's theme colours and the
  extension's light, sepia and dark), typography and the shared words for things (Bookmarks,
  Favourites, Notes, History, Cloud backup).
- Apply it to both: names, icons, colours and wording; store listing text and screenshots.
- No feature changes.

Done when both apps use the agreed name, icon, palette and wording, and both store listings match.

### 4. Extension sign-in and sync (extension repository)

Goal: the first connected release.

- Sign-in with `launchWebAuthFlow` and Google's account picker, proven in step 0. `identity` is an
  optional permission requested when the user taps Connect, so the update does not disable the
  extension for existing users. No host permission is needed. Edge is checked by hand at release;
  if it cannot renew silently there, Edge users see "Reconnect" when the hour runs out.
- A plain-JavaScript port of the phone's sync: Drive client, backup validation, three-way combine,
  empty-device guard, one run at a time. It passes the shared test cases from step 1.
- Carry-through: data the extension does not use yet (streak, badges, challenges) and the phone's
  settings stay exactly as they are in the cloud file.
- Runs when the popup opens and, through the background worker, shortly after any change.
- A cloud icon with the phone's three looks, and a Cloud panel: connect, connected as, last synced,
  sync now, reconnect, the empty-device choices, disconnect.
- OAuth: a Web client in the new project with the redirect URL of the published ID
  (`https://aplafmlmecdjlmcgbibmlbjnilcomcnl.chromiumapp.org/`). An Edge Add-ons listing, if there
  is one, has its own ID and needs its own redirect URL.
- Privacy text, store listing and permission reasons updated.

Done when a bookmark, note or highlight saved on the phone appears in the extension after the phone
syncs and the popup opens, and the other way round; deletions stick; with no account the extension
behaves exactly as before.

### 5. Translations and UI languages in the extension (bundled)

- All 82 translations ship as separate files in the package, as on the phone. Only the chosen one is
  loaded, so opening the popup stays as fast as today (the largest file is 770 KB; NIV is 221 KB).
- The phone's files (`{metadata, psalms}`) are used as they are; the extension's loader reads that
  shape. A script copies them from the phone repository so both always carry the same text.
- A picker grouped by language, with each translation's name and licence or credit line.
- Automatic first choice from the browser language: English keeps NIV; other languages follow the
  phone's rule (`PREFERRED_BIBLE`, then the first match). The reader can change it at any time.
- The extension's UI strings translated into the phone's 47 languages, all bundled; the browser
  language picks one, with English as the fallback.
- The package script, `scripts/package-manifest.js` and the package validator learn the new files;
  the smoke test checks that every translation loads with 150 chapters (148 and 137 for the two
  incomplete ones).
- Cost: the download grows from about 121 KB to about 6.5 MB, and each extension update downloads
  the package again. Nothing is fetched from the network, so it all works offline from the first
  open.

Done when a German browser opens in German with a German Bible on first launch, offline, and every
translation can be picked and read.

### 6. Phone features in the extension, as small releases

Each slice gets its own short spec and plan:

- a. Chapter favourites and highlights (the phone's four colours, checked for contrast in light,
  sepia and dark).
- b. Daily verse, streak, badges and stats.
- c. Challenges and reminders (optional `notifications` permission, `alarms`).
- d. Prayers (check the origin and licence of `prayers-en.json`) and Compare translations.
- e. Onboarding and settings tips.

The 440 px popup stays the quick reader; larger features need a full-page view (an extension page in
a tab). Decide in slice a.

### 7. Store, privacy and release (alongside each release)

- Google Cloud (new project): publish the OAuth consent screen (both apps need it); the phone's
  release and Play-signing Android clients (see `docs/RELEASE.md` in the phone repository); the
  extension's Web client.
- One privacy policy URL covering both apps.
- Chrome Web Store: listing text (it promises "no account" today), privacy practices, permission
  reasons. Edge Add-ons too, if the extension is listed there.
- Play Console: the Data safety answers in the phone's `docs/RELEASE.md` cover Drive backup; recheck
  them once the extension shares the file.

## Known limitations

- Not instant: changes arrive with the next sync (about a minute after a change, or on open).
- Bookmarks follow positions, so translations numbered differently can show a neighbouring verse
  (finding 8).
- If a device loses its local copy of the last sync (cleared storage), its next sync combines both
  sides, so items deleted elsewhere since its last sync can come back once.
- Edge sign-in renewal is untested (finding 7).

## Still to decide, in each step's design

- Brand: name, icon, palette and wording (step 3).
- Full-page view or the side panel for the larger features (step 6a).
- Later, optionally: moving the 70 public translations to a public host to shrink the extension.
