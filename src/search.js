// ─── Search ───────────────────────────────────────────────────────────────────
// Plain case-insensitive substring search over the bundled text.
//
// The whole book is 2,461 verses and about 224 KB, which a linear scan walks in
// well under a millisecond. An index would be more code, more memory and more
// to keep correct, for a search the reader cannot perceive as faster.

export const SEARCH_MAX = 50;
export const SEARCH_MIN_QUERY = 2;

/** Escape a user query for literal use inside a RegExp. */
export function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normaliseQuery(input) {
  return String(input ?? "").trim();
}

/**
 * Find verses containing the query.
 *
 * @returns {{results: Array<{chapterIndex:number,verseIndex:number,text:string}>, truncated: boolean, total: number}}
 */
export function searchVerses(data, query, limit = SEARCH_MAX) {
  const needle = normaliseQuery(query).toLowerCase();
  const results = [];
  let total = 0;

  if (!Array.isArray(data) || needle.length < SEARCH_MIN_QUERY) {
    return { results, truncated: false, total };
  }

  for (let chapterIndex = 0; chapterIndex < data.length; chapterIndex++) {
    const chapter = data[chapterIndex];
    if (!Array.isArray(chapter)) continue;
    for (let verseIndex = 0; verseIndex < chapter.length; verseIndex++) {
      const text = chapter[verseIndex];
      if (typeof text !== "string") continue;
      if (!text.toLowerCase().includes(needle)) continue;
      total++;
      if (results.length < limit) {
        results.push({ chapterIndex, verseIndex, text });
      }
    }
  }

  return { results, truncated: total > results.length, total };
}

/**
 * Split a verse into alternating plain and matching segments.
 *
 * Returns data rather than DOM so the caller can build text nodes itself. Match
 * text is never interpolated into markup anywhere in this extension.
 *
 * @returns {Array<{text: string, match: boolean}>}
 */
export function splitMatches(text, query) {
  const source = String(text ?? "");
  const needle = normaliseQuery(query);
  if (needle === "") return [{ text: source, match: false }];

  const pattern = new RegExp(`(${escapeRegExp(needle)})`, "gi");
  const segments = [];
  let lastIndex = 0;

  // Iterate with matchAll rather than testing a shared /g regex repeatedly:
  // one pass, no lastIndex to reason about.
  for (const match of source.matchAll(pattern)) {
    if (match.index > lastIndex) {
      segments.push({ text: source.slice(lastIndex, match.index), match: false });
    }
    segments.push({ text: match[0], match: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < source.length) {
    segments.push({ text: source.slice(lastIndex), match: false });
  }
  return segments.length > 0 ? segments : [{ text: source, match: false }];
}

/** One-line preview for list rows. */
export function truncate(text, maxLength = 96) {
  const source = String(text ?? "");
  return source.length > maxLength ? `${source.slice(0, maxLength).trimEnd()}…` : source;
}
