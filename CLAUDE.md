# CLAUDE.md — Psalms Way! Browser Extension

This file provides comprehensive guidance for Claude Code when working on this project.

---

## Project Overview

**Psalms Way!** is a Chrome browser extension (Manifest V3) that displays Biblical Psalms passages. It is designed to be a simple, offline-capable devotional tool requiring zero external dependencies.

- **Version:** 1.1
- **Platform:** Chrome (Manifest V3)
- **Type:** Popup Extension (no background script, no content scripts)
- **Dependencies:** None — pure vanilla JavaScript, no npm, no build tools

---

## Repository Structure

```
psalms-way-browser-extension/
├── manifest.json        # Chrome extension manifest (MV3)
├── popup.html           # Extension popup UI (entry point)
├── popup.js             # All application logic (~107 lines)
├── style.css            # All styling (~128 lines)
├── psalms.json          # Complete 150-chapter Psalms data (~2763 lines)
├── icon.png             # 256x256 icon
├── icon128.png          # 128x128 icon (used in manifest)
├── icon48.png           # 48x48 icon (used in manifest)
├── icon16.png           # 16x16 icon (used in manifest)
├── README.md            # Project overview and setup guide
├── USER_GUIDE.md        # End-user instructions
├── CONTRIBUTING.md      # Contributor workflow and code style
├── CODE_OF_CONDUCT.md   # Community standards (Contributor Covenant 2.0)
└── .gitignore           # Excludes psalms-way.zip only
```

**No directories of source code** — all logic lives directly in the root. There is no `src/`, `dist/`, `node_modules/`, or build output folder.

---

## Architecture

### Extension Type: Popup-Only

This extension has no background service worker, no content scripts, and no injected code. Everything runs in an isolated popup window (440px wide, minimum 400px tall) that Chrome creates when the user clicks the toolbar icon.

```
User clicks icon
    → Chrome opens popup.html (440x400+ px window)
    → style.css applied
    → popup.js executes
    → DOMContentLoaded fires → fetchData("psalms.json") → updateContent()
    → Random chapter rendered on first load
    → Event listeners attached to all buttons/inputs
    → User interactions trigger updateContent() with different parameters
```

### Data Flow

```
psalms.json  →  fetchData()  →  updateContent()  →  DOM manipulation  →  Rendered UI
(offline)       (async fetch)   (transforms data)   (createElement)     (styled by CSS)
```

### psalms.json Data Format

A nested array: 150 chapters, each chapter is an array of verse strings.

```json
[
  ["Blessed is the man...", "But his delight is..."],   // Chapter 1, indices 0-indexed
  ["Why do the nations rage...", "The kings of the earth..."], // Chapter 2
  ...
]
```

- Array index `0` = Psalm 1, index `149` = Psalm 150
- The UI displays chapter numbers as 1-indexed to the user; `popup.js` converts internally

---

## Key Source Files

### manifest.json

- `manifest_version: 3`
- `action.default_popup: "popup.html"` — sole entry point
- `permissions: []` — no permissions required whatsoever
- Icons at 16, 48, 128px

### popup.html

UI sections (all controlled by popup.js via IDs):

| Element ID       | Purpose                                              |
|------------------|------------------------------------------------------|
| `btnVerse`       | Show one random verse from a random chapter          |
| `btnChapter`     | Show an entire random chapter                        |
| `txtChapter`     | Manual chapter number text input (1–150)             |
| `btnGo`          | Load the chapter typed in `txtChapter`               |
| `btnPrev`        | Navigate to previous chapter (wraps 1 → 150)        |
| `btnNext`        | Navigate to next chapter (wraps 150 → 1)            |
| `chapterTitle`   | Displays current chapter/verse heading               |
| `contentElement` | Main content area where verses/chapters are rendered |

Footer contains links to: Feedback Form, GitHub repository, LinkedIn.

### popup.js

**Constants:**
- `CHAPTER_RANGE = { min: 0, max: 149 }` — 0-indexed, 150 chapters
- `DATA_FILE_PATH = "psalms.json"`

**Global State:**
- `currentChapter` — tracks the currently displayed chapter index (0-indexed)

**Functions:**

| Function                        | Description                                                                 |
|---------------------------------|-----------------------------------------------------------------------------|
| `fetchData(filePath)`           | Async; uses Fetch API to load psalms.json; returns parsed JSON array        |
| `updateContent(isVerse, chapterIndex)` | Core renderer; re-fetches data; renders verse (p tag) or chapter (ul/li) |
| `getRandomChapterIndex()`       | Returns random int in [0, 149]                                              |
| `getRandomVerseIndex(chapter)`  | Returns random index within a specific chapter array                        |
| `initializeEventListeners()`    | Binds all button/input events                                               |

**Rendering modes (via `updateContent`):**
- `isVerse=true`: Renders a single `<p>` with one random verse; title format: `"Psalms X:Y"`
- `isVerse=false`: Renders a `<ul>` with `<li>` for each verse; title format: `"Psalms X"`

### style.css

- **Primary brand color:** `#33b249` (green)
- **Popup width:** 440px fixed, `min-height: 400px`
- **Layout:** Flexbox column for body; flexbox row with `space-between` for header
- **Button style:** Green background, white text, `border-radius: 24px`, 0.5s hover opacity transition
- **Input + Go button:** Paired design — input has left-rounded border, Go button has right-rounded border
- **List items:** 16px font, 8px padding, alternating even-child `#eeeeee` background
- **Verse display:** `<p>` tag, 16px font, `0 8px` horizontal margin, `32px` bottom margin
- **Footer:** 12px font

---

## Development Workflow

### Loading the Extension Locally

There is **no build step**. Load directly:

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the project root directory (`psalms-way-browser-extension/`)

After any code change, click the **refresh icon** on the extension card in `chrome://extensions/`.

### Making Changes

- Edit HTML/CSS/JS directly — no compilation needed
- Reload extension in `chrome://extensions/` to see changes
- The popup re-opens fresh each time; there is no hot-reload

### No Build System

- No `package.json`, no npm, no webpack, no Babel
- Do **not** introduce a build system unless explicitly requested
- All JavaScript must be compatible with Chrome's modern V8 engine (ES6+ is fine; no TypeScript)

---

## Testing

There is **no automated test framework**. All testing is manual in the browser.

### Manual Test Checklist

Before any PR or change, verify:

1. **One Verse button** — Each click shows a new random verse; title shows `"Psalms X:Y"` format
2. **New Chapter button** — Loads full chapter as a numbered list; title shows `"Psalms X"`
3. **Prev/Next buttons** — Navigate chapters sequentially; wrap correctly at boundaries (Psalm 1 ↔ Psalm 150)
4. **Go button** — Loads specific chapter by number; invalid input shows an alert; Enter key also triggers this
5. **Input validation** — Numbers outside 1–150 are rejected with an alert
6. **Offline access** — With no internet connection, the extension loads and displays content normally (data is bundled)
7. **Chapter title** — Updates correctly after every interaction

---

## Code Conventions

### Naming

- **Element IDs:** `btn<Action>` for buttons (e.g., `btnVerse`), `txt<Input>` for inputs (e.g., `txtChapter`)
- **Functions:** camelCase, descriptive (e.g., `getRandomChapterIndex`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `CHAPTER_RANGE`, `DATA_FILE_PATH`)
- **CSS classes:** lowercase with hyphens where applicable

### JavaScript Style

- Indentation: **2 spaces**
- Use `async/await` for asynchronous operations (not `.then()` chains)
- Wrap async calls in `try/catch` with `console.error()` logging
- Use `const`/`let`; no `var`
- No semicolons are not enforced — follow existing file style (semicolons present in popup.js)
- DOM creation via `document.createElement()` and `replaceChildren()` (not innerHTML)

### CSS Style

- Use existing CSS custom properties / named colors where applicable
- Keep to flexbox for layout
- Maintain the green brand color (`#33b249`) for interactive elements

### No External Libraries

- Do **not** add jQuery, React, or any other library
- Do **not** add CDN script tags in HTML
- Do **not** create a package.json unless a build system is explicitly requested

---

## Git Workflow

### Branch Naming (from CONTRIBUTING.md)

- `feature/<description>` — new features
- `issues/<issue-number>` — bug fixes or issue work (e.g., `issues/9`)
- `codex/<description>` — automated/AI-assisted changes

### Commit Style

- Short imperative messages (e.g., `Add enter key support for chapter input`)
- Reference issue numbers where applicable

### PR Process

1. Fork → branch → changes → PR against `main`
2. All manual tests must pass before opening a PR
3. Code review required

---

## Manifest V3 Constraints

This extension uses MV3. Key implications:

- **No background pages** — use service workers if background logic is ever needed (currently not used)
- **No `eval()`** — MV3 forbids dynamic code execution
- **No remote code** — all scripts must be bundled locally (psalms.json is local; no CDNs allowed per MV3)
- **Permissions** — currently none; adding any permission requires justification and manifest update
- **CSP** — MV3 has stricter Content Security Policy; avoid inline event handlers (use `addEventListener`)

---

## Psalms Data Notes

- `psalms.json` contains the complete Book of Psalms (150 chapters) in an archaic English translation (King James style)
- The file is ~2763 lines and should not be reformatted without care — it is human-readable and used directly
- Chapter sizes vary: shortest ~6 verses (e.g., Psalm 117), longest ~45 verses (Psalm 119)
- The word "Selah" appears as part of verse text — this is intentional and should not be removed
- Do **not** modify psalms.json content unless the translation is being intentionally updated
- Array is 0-indexed internally; all user-facing numbers are 1-indexed (Psalms 1–150)

---

## Common Tasks

### Add a new button/feature to the popup

1. Add the button element to `popup.html` with a descriptive `id` (follow `btn<Action>` convention)
2. Style it in `style.css` using existing button styles
3. Add the event listener in `initializeEventListeners()` in `popup.js`
4. If it displays content, use or extend `updateContent()`

### Change the display format of verses or chapters

- Modify the DOM creation logic inside `updateContent()` in `popup.js`
- Verse rendering: look for the `isVerse === true` branch (creates `<p>` element)
- Chapter rendering: look for the `isVerse === false` branch (creates `<ul>/<li>` elements)

### Update extension metadata (name, description, version)

- Edit `manifest.json` directly — `name`, `description`, `version` fields

### Package the extension for distribution

- Zip the entire project root (excluding `.git/` and `psalms-way.zip` itself)
- Output: `psalms-way.zip` (excluded from git via `.gitignore`)
- Submit to Chrome Web Store via the developer dashboard

---

## What NOT to Do

- Do **not** introduce a build system, bundler, or transpiler without explicit request
- Do **not** add npm dependencies
- Do **not** use `innerHTML` for rendering user-visible content (use DOM API methods)
- Do **not** add permissions to manifest.json unless strictly required
- Do **not** modify `psalms.json` verse text casually — it's sacred source material
- Do **not** add background service workers unless the feature explicitly requires persistent state
- Do **not** break offline functionality — all data must remain bundled locally
- Do **not** use inline `onclick=` handlers in HTML — use `addEventListener` in JS
