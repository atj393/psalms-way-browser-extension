# Psalms Way! — user guide

All 150 Psalms, one click away in your browser toolbar. Everything works offline
and stays on your own computer.

## Getting started

Click the Psalms Way! icon in your toolbar. The popup opens on whatever you read
last, or on Today's Psalm the first time.

The popup has three parts:

- **The top row** — the two quick buttons, One Verse and New Chapter.
- **The chapter row** — where you are, and how to move between Psalms.
- **The toolbar** — Today, Search, Library, History and Settings.

You can hide the toolbar with the **⌄** button on the right of the chapter row,
and bring it back the same way. It stays hidden until you show it again.

---

## Reading

### Today's Psalm

**Today** gives you one Psalm for the day. It is the same Psalm all day and it
changes at midnight. Nothing is downloaded or scheduled — it comes from the date
on your computer, so it is the same for anyone reading in your time zone on the
same day.

### One Verse

A single verse chosen at random, shown on its own with its reference underneath.
If you have written a note on that verse, it appears below it.

Use **Read Psalm _n_** at the bottom to open the whole chapter around it.

### New Chapter

A whole Psalm chosen at random.

### Moving between Psalms

- **‹** and **›** step to the previous and next Psalm. They wrap around, so
  going back from Psalm 1 takes you to Psalm 150.
- Type a number from 1 to 150 in the box and press **Go**, or just press Enter.
  If the number is not a Psalm, you are told and nothing moves.

### Doing something with a verse

Click any verse and three buttons appear beneath it:

|          |                                                      |
| -------- | ---------------------------------------------------- |
| **Save** | Add it to your Favourites. Click again to remove it. |
| **Note** | Write a note about it.                               |
| **Copy** | Copy the verse and its reference, ready to paste.    |

Copied text looks like this:

```
Psalm 23:1 — The LORD is my shepherd, I shall not be in want.
```

Small markers on the right of a verse show at a glance that you have saved it
(a heart) or written a note on it (a pencil).

Click the same verse again to close its buttons.

**By keyboard:** Tab to the list of verses, then use ↑ and ↓ to move between
them, Home and End to jump to the start or end, and Enter or Space to open a
verse's buttons.

---

## Search

Click **Search**, type at least two characters, and press Enter.

- Matches are highlighted in the results.
- You are told how many verses matched. If there are more than 50, it says so —
  for example, _Showing first 50 of 812 matches_.
- Clicking a result opens **that exact verse**, not just its chapter.
- Punctuation and symbols are searched for literally, so you can look for
  `LORD.` or `(` without anything odd happening.

Press **Escape** to close Search.

---

## Library

Your Library holds the verses you have kept, in two tabs.

### Favourites

Every verse you have saved, newest first. Click one to open it. Click the **✕**
on the right to remove it.

### Notes

Every note you have written, with the verse it belongs to. Click a note to open
its verse. Click the bin icon to delete it — you are asked to confirm first,
because a deleted note cannot be recovered.

### Writing a note

1. Open a Psalm and click the verse you want to write about.
2. Click **Note**.
3. Type. The verse stays visible above the box so you can see what you are
   writing about.
4. Click **Save**, or press Ctrl+Enter (Cmd+Enter on a Mac).

To change a note later, open the verse and click **Note** again, or open it from
the Library.

To delete a note, either clear the box and save, or use **Delete** in the editor.

Notes can be up to 2,000 characters, and you can keep up to 500 of them.

---

## History

**History** lists the Psalms and verses you have opened, newest first, with when
you read them. Click any entry to go back to it.

The list keeps your 50 most recent passages. Opening something you have read
before moves it back to the top rather than adding a second entry.

**Clear** empties the list. You are asked to confirm. Clearing your history does
**not** touch your favourites or your notes.

---

## Settings

### Theme

**Light**, **Sepia** or **Dark**. Sepia is a warm, paper-like tone that some
people find easier for long reading.

### Text size

Three sizes, applied to the Psalm text.

### Your data

Your favourites, notes, history and settings live on this browser only. They are
not sent anywhere, and they are **deleted if you remove the extension**.

**Export…** saves everything to a file named something like
`psalms-way-backup-2026-09-08.json`. Keep it somewhere safe, or move it to
another computer.

**Restore…** reads a file you exported before.

> **Restoring replaces what is on this browser.** You are shown how many
> favourites, notes and history entries the file contains, and asked to confirm,
> before anything changes.

If a file is not a Psalms Way backup, is damaged, or was made by a newer version
of the extension, you are told exactly what is wrong and nothing is changed.

---

## Keyboard

| Key             | What it does                                  |
| --------------- | --------------------------------------------- |
| Tab / Shift+Tab | Move between controls                         |
| ↑ ↓             | Move between verses in a chapter              |
| Home / End      | First or last verse                           |
| Enter / Space   | Open the buttons for the selected verse       |
| Enter           | In the chapter box or search box: go / search |
| Escape          | Close the open panel, or cancel a dialog      |
| Ctrl+Enter      | Save a note (Cmd+Enter on a Mac)              |

When you close a panel, focus goes back to the button you opened it with, so you
do not lose your place.

---

## Privacy

- The extension makes **no network requests at all**. Everything, including all
  150 Psalms, is bundled inside it.
- It has **no permission to read the pages you visit** — it cannot see your
  browsing at all.
- There is no account, no sign-in, no analytics and no tracking.
- The only permission it asks for is `storage`, which is what keeps your
  favourites, notes, history and settings on your own machine.

---

## Common questions

**Will my favourites and notes sync to my phone?**
No. They stay on this browser. Use **Export…** and **Restore…** to move them
yourself. The [Android app](https://github.com/atj393/psalms-way-app) is a
separate product with its own data.

**Does it still work with no internet?**
Yes, entirely. Nothing is ever downloaded.

**Will I lose my saved verses when I update the extension?**
No. Favourites, history and settings saved by earlier versions are carried
forward automatically.

**What happens if I uninstall it?**
Chrome deletes the extension's stored data. Export a backup first if you want to
keep your notes.

**Which translation is this?**
An English NIV text. See the licence note in the [README](README.md).

---

## Something went wrong

Messages appear briefly at the bottom of the popup.

| Message                                                  | What it means                                           |
| -------------------------------------------------------- | ------------------------------------------------------- |
| _That verse could not be saved._                         | The browser refused the write. Usually storage is full. |
| _There is no room left in browser storage._              | Clear your history or delete some notes.                |
| _Your browser blocked the copy._                         | Select the verse and press Ctrl+C instead.              |
| _That file is not a Psalms Way backup._                  | You picked the wrong file.                              |
| _That backup was made by a newer version of Psalms Way._ | Update the extension, then restore again.               |
| _The Psalms text could not be loaded._                   | Reload the extension from `chrome://extensions`.        |

If something keeps going wrong, please
[open an issue](https://github.com/atj393/psalms-way-browser-extension/issues)
or use the
[feedback form](https://docs.google.com/forms/d/e/1FAIpQLSda0j_4GX_E_aFhsyItJssbgRc6C7Ukg-No54Gc0Sivzt5iSA/viewform?usp=sf_link).
