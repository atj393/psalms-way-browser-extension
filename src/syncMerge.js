// ─── Sync: combining this browser with the cloud copy ────────────────────────
// A port of the phone app's services/backup/mergeBackup.ts. Both work on the
// phone's data shape (1-based chapters and verses) and must pass the same
// cases, copied into test/fixtures/syncVectors.json, so the two clients always
// combine identically.
//
// Without a base (connect, "get my data back") nothing from either side is
// lost: rows carry no ids or edit times, so the rules keep both rather than
// guess. With a base (what this browser and the cloud last agreed on) the
// combine is three-way, row by row: a side that changed a row since the base
// wins over a side that left it alone, so deletions and edits made on the
// phone stick. Only when both sides changed a row do the keep-both rules
// decide; an edit beats a deletion.
//
// Pure: no storage, no network.

export const HISTORY_LIMIT = 50;
const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChapter(value) {
  return Number.isInteger(value) && value >= 1 && value <= 150;
}

function isVerseNumber(value) {
  return Number.isInteger(value) && value >= 1;
}

function isVerseRow(value) {
  return isRecord(value) && isChapter(value.chapter) && isVerseNumber(value.verse);
}

function isHighlight(value) {
  return isVerseRow(value) && HIGHLIGHT_COLORS.includes(value.color);
}

function isNote(value) {
  return isVerseRow(value) && typeof value.text === "string";
}

function isHistoryEntry(value) {
  return (
    isVerseRow(value) && typeof value.date === "string" && !Number.isNaN(Date.parse(value.date))
  );
}

const verseKey = (row) => `${row.chapter}:${row.verse}`;

function time(iso) {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

// ─── Keep-both rules ──────────────────────────────────────────────────────────

/** Union by key; the first list's rows, and their order, come first. */
function unionBy(first, second, key) {
  const seen = new Set();
  const out = [];
  for (const row of [...first, ...second]) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

const asList = (value) => (Array.isArray(value) ? value : []);

function mergeBookmarks(phone, cloud) {
  return unionBy(asList(phone).filter(isVerseRow), asList(cloud).filter(isVerseRow), verseKey);
}

function mergeFavorites(phone, cloud) {
  return unionBy(asList(phone).filter(isChapter), asList(cloud).filter(isChapter), String);
}

function mergeHighlights(phone, cloud) {
  return unionBy(asList(phone).filter(isHighlight), asList(cloud).filter(isHighlight), verseKey);
}

/** Two notes on the same verse become one without repeating either text. */
export function combineNoteText(phone, cloud) {
  if (phone.includes(cloud)) return phone;
  if (cloud.includes(phone)) return cloud;
  return `${phone}\n\n${cloud}`;
}

function bothNotes(mine, theirs) {
  return {
    ...mine,
    text: combineNoteText(mine.text, theirs.text),
    date: time(theirs.date) > time(mine.date) ? theirs.date : mine.date,
  };
}

function mergeNotes(phone, cloud) {
  const byVerse = new Map();
  for (const note of [...asList(phone).filter(isNote), ...asList(cloud).filter(isNote)]) {
    const mine = byVerse.get(verseKey(note));
    byVerse.set(verseKey(note), mine ? bothNotes(mine, note) : note);
  }
  return [...byVerse.values()];
}

function laterEntry(mine, theirs) {
  return time(theirs.date) > time(mine.date) ? theirs : mine;
}

function mergeHistory(phone, cloud) {
  const byChapter = new Map();
  for (const entry of [
    ...asList(phone).filter(isHistoryEntry),
    ...asList(cloud).filter(isHistoryEntry),
  ]) {
    const current = byChapter.get(entry.chapter);
    if (!current || time(entry.date) > time(current.date)) byChapter.set(entry.chapter, entry);
  }
  return [...byChapter.values()]
    .sort((a, b) => time(b.date) - time(a.date))
    .slice(0, HISTORY_LIMIT);
}

function asStreak(value) {
  if (!isRecord(value)) return null;
  const { lastDate, count, longestStreak } = value;
  if (typeof lastDate !== "string" || typeof count !== "number" || !Number.isFinite(count)) {
    return null;
  }
  return {
    lastDate,
    count,
    longestStreak: typeof longestStreak === "number" ? longestStreak : undefined,
  };
}

/** Whole days from one local 'YYYY-MM-DD' to another, or null if either is unreadable. */
function daysBetween(from, to) {
  const parse = (key) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  };
  const a = parse(from);
  const b = parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function mergeStreak(phone, cloud) {
  const p = asStreak(phone);
  const c = asStreak(cloud);
  if (!p && !c) return null;
  if (!c) return phone;
  if (!p) return cloud;
  // Dates are local 'YYYY-MM-DD', so string order is date order.
  const phoneWins = p.lastDate > c.lastDate || (p.lastDate === c.lastDate && p.count >= c.count);
  const newer = phoneWins ? p : c;
  const older = phoneWins ? c : p;
  // If the older streak ran up to or into the newer one, the reader never
  // missed a day, so the count carries on instead of restarting.
  const gap = daysBetween(older.lastDate, newer.lastDate);
  const count =
    gap !== null && gap <= newer.count ? Math.max(newer.count, gap + older.count) : newer.count;
  return {
    lastDate: newer.lastDate,
    count,
    longestStreak: Math.max(p.longestStreak ?? p.count, c.longestStreak ?? c.count, count),
  };
}

function isDateString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function mergeBadges(phone, cloud) {
  if (!isRecord(phone) && !isRecord(cloud)) return null;
  const out = {};
  for (const side of [phone, cloud]) {
    if (!isRecord(side)) continue;
    for (const [id, earned] of Object.entries(side)) {
      if (!isDateString(earned)) continue;
      const current = out[id];
      if (current === undefined || Date.parse(earned) < Date.parse(current)) out[id] = earned;
    }
  }
  return out;
}

function completedDays(progress) {
  return isRecord(progress) && Array.isArray(progress.completedDays)
    ? progress.completedDays.length
    : -1;
}

function mergeChallenges(phone, cloud) {
  if (!isRecord(phone) && !isRecord(cloud)) return null;
  if (!isRecord(cloud)) return phone;
  if (!isRecord(phone)) return cloud;
  const out = { ...cloud, ...phone };
  for (const [id, progress] of Object.entries(cloud)) {
    if (id in phone && completedDays(progress) > completedDays(phone[id])) out[id] = progress;
  }
  return out;
}

// ─── Three-way rules ──────────────────────────────────────────────────────────

/** JSON with sorted keys, so equal values compare equal whatever their key order. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function same(a, b) {
  return stableJson(a) === stableJson(b);
}

/**
 * Rows keyed by `key`, each side already reduced to one row per key. A row
 * changed (or deleted) on one side since `base` and left alone on the other
 * takes that side's version; when both sides changed it, `both` decides, and
 * an edit beats a deletion. This side's order comes first, unless its list is
 * exactly as last synced: then the other side's order is the newer.
 */
function threeWayRows(base, phone, cloud, key, both) {
  const b = new Map(base.map((row) => [key(row), row]));
  const p = new Map(phone.map((row) => [key(row), row]));
  const c = new Map(cloud.map((row) => [key(row), row]));
  const order = same(phone, base) ? [...c.keys(), ...p.keys()] : [...p.keys(), ...c.keys()];
  const out = [];
  for (const k of new Set(order)) {
    const pr = p.get(k);
    const cr = c.get(k);
    const br = b.get(k);
    if (br === undefined) {
      if (pr !== undefined && cr !== undefined) out.push(both(pr, cr));
      else out.push(pr ?? cr);
      continue;
    }
    if (pr === undefined && cr === undefined) continue;
    if (pr === undefined) {
      if (!same(cr, br)) out.push(cr);
      continue;
    }
    if (cr === undefined) {
      if (!same(pr, br)) out.push(pr);
      continue;
    }
    if (same(pr, br)) out.push(cr);
    else if (same(cr, br)) out.push(pr);
    else out.push(both(pr, cr));
  }
  return out;
}

/** For streak, badges and challenges: one side's change wins when the other left the value alone. */
function threeWayValue(base, phone, cloud, merge) {
  // Never take a missing or damaged value over a usable one.
  if (isRecord(phone) && isRecord(cloud)) {
    if (same(phone, base)) return cloud;
    if (same(cloud, base)) return phone;
  }
  return merge(phone, cloud);
}

const keepFirst = (mine) => mine;

function combineThreeWay(phone, cloud, base) {
  const history = threeWayRows(
    mergeHistory(base.history, []),
    mergeHistory(phone.history, []),
    mergeHistory(cloud.history, []),
    (entry) => String(entry.chapter),
    laterEntry
  );
  return {
    bookmarks: threeWayRows(
      mergeBookmarks(base.bookmarks, []),
      mergeBookmarks(phone.bookmarks, []),
      mergeBookmarks(cloud.bookmarks, []),
      verseKey,
      keepFirst
    ),
    favorites: threeWayRows(
      mergeFavorites(base.favorites, []),
      mergeFavorites(phone.favorites, []),
      mergeFavorites(cloud.favorites, []),
      String,
      keepFirst
    ),
    highlights: threeWayRows(
      mergeHighlights(base.highlights, []),
      mergeHighlights(phone.highlights, []),
      mergeHighlights(cloud.highlights, []),
      verseKey,
      keepFirst
    ),
    notes: threeWayRows(
      mergeNotes(base.notes, []),
      mergeNotes(phone.notes, []),
      mergeNotes(cloud.notes, []),
      verseKey,
      bothNotes
    ),
    history: history.sort((a, b) => time(b.date) - time(a.date)).slice(0, HISTORY_LIMIT),
    streak: threeWayValue(base.streak, phone.streak, cloud.streak, mergeStreak),
    badges: threeWayValue(base.badges, phone.badges, cloud.badges, mergeBadges),
    challenges: threeWayValue(base.challenges, phone.challenges, cloud.challenges, mergeChallenges),
    settings: phone.settings,
  };
}

function combineKeepingBoth(phone, cloud) {
  return {
    bookmarks: mergeBookmarks(phone.bookmarks, cloud.bookmarks),
    favorites: mergeFavorites(phone.favorites, cloud.favorites),
    highlights: mergeHighlights(phone.highlights, cloud.highlights),
    notes: mergeNotes(phone.notes, cloud.notes),
    history: mergeHistory(phone.history, cloud.history),
    streak: mergeStreak(phone.streak, cloud.streak),
    badges: mergeBadges(phone.badges, cloud.badges),
    challenges: mergeChallenges(phone.challenges, cloud.challenges),
    settings: phone.settings,
  };
}

function isEmptyRecord(value) {
  return !isRecord(value) || Object.keys(value).length === 0;
}

/** True when nothing the reader saved is present (streak, badges and settings are automatic). */
export function isEmptyData(data) {
  return (
    asList(data.bookmarks).length === 0 &&
    asList(data.favorites).length === 0 &&
    asList(data.highlights).length === 0 &&
    asList(data.notes).length === 0 &&
    asList(data.history).length === 0 &&
    isEmptyRecord(data.challenges)
  );
}

/** Saved items (bookmarks, favourites, highlights, notes) in `data` that `mine` did not have. */
function countAdded(mine, data) {
  const keysOf = (d) =>
    new Set([
      ...mergeBookmarks(d.bookmarks, []).map((row) => `b${verseKey(row)}`),
      ...mergeFavorites(d.favorites, []).map((chapter) => `f${chapter}`),
      ...mergeHighlights(d.highlights, []).map((row) => `h${verseKey(row)}`),
      ...mergeNotes(d.notes, []).map((row) => `n${verseKey(row)}`),
    ]);
  const before = keysOf(mine);
  return [...keysOf(data)].filter((k) => !before.has(k)).length;
}

/**
 * Combines this browser's data (`phone`, named as in the phone app's code)
 * with the cloud copy. With `base` the combine is three-way; without it, both
 * sides are kept.
 */
export function mergeBackupData(phone, cloud, base = null) {
  // A cloud copy with nothing saved, when the last sync had data, is treated
  // as a lost copy rather than as "everything was deleted elsewhere".
  const useBase = base !== null && !(isEmptyData(cloud) && !isEmptyData(base));
  const data = useBase ? combineThreeWay(phone, cloud, base) : combineKeepingBoth(phone, cloud);
  return { data, addedFromCloud: countAdded(phone, data) };
}
