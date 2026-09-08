// ─── Note editor ──────────────────────────────────────────────────────────────
// A single-purpose panel: one verse, one note. Deliberately not a document
// editor — a browser popup is 440px wide and a note here is a sentence or two.

import { byId, toast, reportError, confirmDialog } from "./dom.js";
import { formatReference } from "./data.js";
import { getNote, saveNote, deleteNote, NOTE_MAX_LENGTH } from "./storage.js";

let returnFocusTo = null;
let closeEditor = () => {};

/** Injected by app.js so the editor can hand the view back. */
export function setEditorCloser(fn) {
  closeEditor = fn;
}

/**
 * Open the editor for a verse.
 * @param {{chapterIndex:number, verseIndex:number, text:string, onSaved?:() => void}} options
 */
export async function openNoteEditor({ chapterIndex, verseIndex, text, onSaved }) {
  returnFocusTo = document.activeElement;

  let existing = null;
  try {
    existing = await getNote(chapterIndex, verseIndex);
  } catch (error) {
    reportError(error, "Your note could not be read.");
    return;
  }

  const reference = formatReference(chapterIndex, verseIndex);
  byId("noteEditorTitle").textContent = existing ? `Edit note — ${reference}` : `Add note — ${reference}`;
  byId("noteVerse").textContent = text;

  const textarea = byId("noteText");
  textarea.value = existing?.text ?? "";
  textarea.maxLength = NOTE_MAX_LENGTH;

  const counter = byId("noteCounter");
  const paintCounter = () => {
    counter.textContent = `${textarea.value.length} / ${NOTE_MAX_LENGTH}`;
  };
  paintCounter();
  textarea.oninput = paintCounter;

  byId("btnDeleteNote").hidden = !existing;

  const save = async () => {
    try {
      const saved = await saveNote(chapterIndex, verseIndex, textarea.value);
      toast(saved ? `Note saved for ${reference}` : "Note removed", "success");
      onSaved?.();
      close();
    } catch (error) {
      reportError(error, "Your note could not be saved.");
    }
  };

  const remove = async () => {
    const confirmed = await confirmDialog({
      title: "Delete this note?",
      message: `Your note on ${reference} will be removed. This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteNote(chapterIndex, verseIndex);
      toast("Note deleted", "success");
      onSaved?.();
      close();
    } catch (error) {
      reportError(error, "That note could not be deleted.");
    }
  };

  const close = () => {
    textarea.oninput = null;
    closeEditor();
    if (returnFocusTo instanceof HTMLElement && document.contains(returnFocusTo)) {
      returnFocusTo.focus();
    }
    returnFocusTo = null;
  };

  byId("btnSaveNote").onclick = save;
  byId("btnDeleteNote").onclick = remove;
  byId("btnCancelNote").onclick = close;
  byId("btnCloseNote").onclick = close;

  // Ctrl/Cmd+Enter saves; Escape is handled by the global panel handler, which
  // calls closeNoteEditor() below.
  textarea.onkeydown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      save();
    }
  };

  return { close };
}

/** Called by the global Escape handler. */
export function cancelNoteEditor() {
  const textarea = byId("noteText");
  if (textarea) textarea.oninput = null;
  closeEditor();
  if (returnFocusTo instanceof HTMLElement && document.contains(returnFocusTo)) {
    returnFocusTo.focus();
  }
  returnFocusTo = null;
}
