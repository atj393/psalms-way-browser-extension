# Psalms Way extension, complete release: design

Date: 2026-10-20 · Status: approved in conversation (layout, scope, parallel build).
Roadmap: `2026-10-13-phone-extension-connection-roadmap.md` (this is its step 5 and most of step 6).

## Goal

Bring the phone app's features to the browser extension, refining the current design, before the
next store release: every Bible version, every app language, the appearance options, highlights and
chapter favourites, Today with the verse of the day, Compare, Prayers, and Progress (streak, stats,
badges, challenges). Reminders are out of scope (owner's decision).

## Decisions

| Topic              | Decision                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout             | Keep the current rows at the top: the popup opens from the toolbar, so every control stays near it. Refine, don't replace. Width stays 440 px.                                                                                                                                                                                                                    |
| Row 1, header      | `Psalms Way` · version chip (`NIV ▾`, opens the version picker) · sync status icon (moved here from the toolbar) · One Verse · New Chapter                                                                                                                                                                                                                        |
| Row 2, chapter bar | `Psalm 23` · ♡ chapter favourite · `1–150` Go · ‹ › ⌄ (unchanged otherwise)                                                                                                                                                                                                                                                                                       |
| Row 3, toolbar     | Eight equal items: Today · Search · Library · History · Compare · Prayers · Progress · Settings                                                                                                                                                                                                                                                                   |
| Font               | Arial throughout (already shipped in `576e2a4`).                                                                                                                                                                                                                                                                                                                  |
| Versions           | All 82 bundled (phone's files), one file per version, only the chosen one loaded. Picker grouped by language with a filter box and each version's credit line. First choice from the browser language with the phone's rule, except English stays NIV (`modern`). Right-to-left text for he, ar, fa, ur, ug. Versions missing chapters say so instead of failing. |
| App languages      | The phone's 47, "Automatic" (browser language) by default, choosable in Settings. The phone's translation files are reused as they are; extension-only wording gets its own files, translated into all 46 other languages. Right-to-left layout for ar, fa, he, ur, ug.                                                                                           |
| Appearance         | Theme Light / Sepia / Dark / Auto (follows the system). Accent: the phone's five (green, blue, red, amber, purple) with its light and dark primaries. Text size small / medium / large (13 / 16 / 19 px).                                                                                                                                                         |
| Highlights         | The phone's four colours (yellow #FFF176 / dark #665A00, green #C8E6C9 / #1B5E20, blue #BBDEFB / #0D47A1, pink #F8BBD0 / #880E4F) from the verse actions; tinted verse background.                                                                                                                                                                                |
| Chapter favourites | ♡ in the chapter bar.                                                                                                                                                                                                                                                                                                                                             |
| Library            | Tabs: Bookmarks · Highlights · Favourites · Notes.                                                                                                                                                                                                                                                                                                                |
| Today              | A panel: Verse of the day (the phone's `getVerseForDate`, so it matches the phone on the same version), Today's Psalm, and the current streak.                                                                                                                                                                                                                    |
| Compare            | The selected verse (or verse 1) in the current version plus two others; defaults KJV and WEB, each changeable.                                                                                                                                                                                                                                                    |
| Prayers            | The phone's 36 prayers in 19 categories (English text; category names translated).                                                                                                                                                                                                                                                                                |
| Progress           | Streak (current, longest), last 7 days, reading totals, most read, badges (the phone's nine), challenges (the phone's six, start / mark today read / reset, one day per calendar day). Logic ported exactly, so phone and browser agree; data lives in the sync carry slot and syncs.                                                                             |
| Data               | Phone-shaped data (highlights, favourites, streak, badges, challenges) stays in `store.carry`, now read and written through one module, `src/phoneData.js`. Sync is unchanged.                                                                                                                                                                                    |
| Not included       | Reminders and notifications.                                                                                                                                                                                                                                                                                                                                      |

## Build

Parallel helper agents in waves, each on its own files, each task reviewed before commit:
wave 0 scaffolding and contracts (one agent); wave 1 features in parallel; wave 2 string
extraction; wave 3 translations in parallel by language group; wave 4 integration, smoke test,
screenshots, package. Plan: `../plans/2026-10-20-extension-complete.md`.

## Known limitations

- The verse of the day matches the phone only when both use the same version.
- Bookmarks and highlights follow verse positions; versions numbered differently can show a
  neighbouring verse (roadmap finding 8).
- Prayers are English only, as on the phone.
- The package grows to about 26 MB installed (about 7 MB download).
