// ─── Local calendar days ──────────────────────────────────────────────────────
// A port of the phone app's services/dateUtils.ts date keys. Streaks,
// challenges and the verse of the day are anchored to the reader's own
// midnight, so everything here uses the LOCAL calendar day as 'YYYY-MM-DD',
// never toISOString() (which is the UTC day).

const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

/** A Date's local calendar day, 'YYYY-MM-DD'. */
export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Local midnight of 'YYYY-MM-DD', or null for anything that is not a real day. */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Reject values that rolled over (e.g. 2026-02-31 → March 3).
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Whole local days from `a` to `b` (positive when `b` is later), or null. */
export function daysBetween(a, b) {
  const da = parseDateKey(a);
  const db = parseDateKey(b);
  if (!da || !db) return null;
  // UTC-normalised midnights, so a DST change in between still counts one day.
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}

/** The day `n` local days after `key`, or null. */
export function addDays(key, n) {
  const d = parseDateKey(key);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}
