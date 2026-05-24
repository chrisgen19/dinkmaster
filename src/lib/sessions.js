// Session detection — pure schedule + clock arithmetic, no database.
// Mirrors leaderboard.js/matchmaking.js/rating.js: keep this module free of
// server-only imports so it runs in the browser. The arena's schedule
// (scheduleDays, scheduleStart, scheduleEnd, timezone) defines recurring
// play-day instances ("sessions"); the manager prep banner and the
// `prepareNextSession` server action both call into here so they can't drift.
//
// Convention: `scheduleDays` is the JS `Date.getDay()` set (0=Sun…6=Sat).
// An empty `scheduleDays` means "no schedule" for session purposes — distinct
// from `leaderboard.js`, which treats empty as "every day counts". A session
// can't fire when the club has never declared a play day.

/** Default IANA zone used when an arena has no timezone set. */
export const DEFAULT_TIMEZONE = 'Asia/Manila';

/**
 * How far ahead of `scheduleStart` the banner flips from `between` to
 * `imminent`. UI lives outside this module, but a default lets callers stay
 * consistent without each picking their own threshold.
 */
export const IMMINENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve a usable IANA zone, falling back to the default when the input is
 * empty or invalid. App writes validate the timezone (`updateArenaSchedule`)
 * and Prisma defaults it, so this mainly shields the pure module from
 * legacy/corrupted data or non-DB callers — it must return null/values, not
 * throw a RangeError out of `new Intl.DateTimeFormat`.
 */
function safeTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Local wall-clock parts of an instant in a given IANA timezone. */
function zonedParts(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = {};
  for (const part of dtf.formatToParts(instant)) map[part.type] = part.value;
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    hour: +map.hour,
    minute: +map.minute,
    second: +map.second,
  };
}

/**
 * Convert a local wall-clock time in `timeZone` to the matching UTC instant.
 * Two passes correct for any offset change at the boundary (DST-safe).
 */
function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetAt = (ms) => {
    const p = zonedParts(new Date(ms), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  const firstPass = guessUtc - offsetAt(guessUtc);
  return new Date(guessUtc - offsetAt(firstPass));
}

/** JS `getDay()` weekday number (0=Sun…6=Sat) of an instant in `timeZone`. */
function zonedWeekday(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Parse "HH:MM" → [hour, minute], or null if missing/malformed. */
function parseClock(hhmm) {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return [h, min];
}

/**
 * Build the UTC `{start, end}` for a session on the local calendar day
 * (year/month/day) in `timeZone`. Missing/invalid `scheduleStart`/`End` fall
 * back to the whole day. Overnight sessions (start ≥ end) are not supported
 * in V1 and are coerced to whole-day; revisit if late-night clubs need it.
 */
function buildWindow(year, month, day, scheduleStart, scheduleEnd, timeZone) {
  let [sH, sM] = parseClock(scheduleStart) ?? [0, 0];
  let [eH, eM] = parseClock(scheduleEnd) ?? [23, 59];
  if (sH * 60 + sM >= eH * 60 + eM) {
    sH = 0; sM = 0; eH = 23; eM = 59;
  }
  return {
    start: zonedToUtc(year, month, day, sH, sM, timeZone),
    end: zonedToUtc(year, month, day, eH, eM, timeZone),
  };
}

/**
 * The session window for the calendar day containing `instant` in `tz` — if
 * that day is in `scheduleDays`. Returns `{start, end}` UTC instants or null.
 *
 * @param {{days?:number[], start?:string|null, end?:string|null, timezone?:string}} schedule
 * @param {Date} instant
 * @returns {{start: Date, end: Date} | null}
 */
export function sessionWindow(schedule = {}, instant = new Date()) {
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (days.length === 0) return null;
  const timeZone = safeTimeZone(schedule.timezone || DEFAULT_TIMEZONE);
  const p = zonedParts(instant, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  if (!days.includes(weekday)) return null;
  return buildWindow(p.year, p.month, p.day, schedule.start, schedule.end, timeZone);
}

/**
 * The currently-live session window if `now` is inside one, else null.
 *
 * @param {{days?:number[], start?:string|null, end?:string|null, timezone?:string}} schedule
 * @param {Date} [now]
 * @returns {{start: Date, end: Date} | null}
 */
export function currentSession(schedule = {}, now = new Date()) {
  const win = sessionWindow(schedule, now);
  if (!win) return null;
  if (now < win.start || now >= win.end) return null;
  return win;
}

/**
 * The next session strictly after `now`, scanning forward up to 14 days
 * (enough to cover any weekly schedule, including a once-a-week single day).
 *
 * @param {{days?:number[], start?:string|null, end?:string|null, timezone?:string}} schedule
 * @param {Date} [now]
 * @returns {{start: Date, end: Date} | null}
 */
export function nextSession(schedule = {}, now = new Date()) {
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (days.length === 0) return null;
  const timeZone = safeTimeZone(schedule.timezone || DEFAULT_TIMEZONE);
  for (let offset = 0; offset <= 14; offset++) {
    const probe = new Date(now.getTime() + offset * 86_400_000);
    const p = zonedParts(probe, timeZone);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    if (!days.includes(weekday)) continue;
    const win = buildWindow(p.year, p.month, p.day, schedule.start, schedule.end, timeZone);
    if (win.start > now) return win;
  }
  return null;
}

/**
 * The most recent session ending at-or-before `now`, scanning backward up to
 * 14 days. Returns `{start, end}` UTC instants or null. A session that's
 * currently *live* is NOT considered "last" — callers wanting "active or
 * most recent" should check `currentSession` first.
 *
 * @param {{days?:number[], start?:string|null, end?:string|null, timezone?:string}} schedule
 * @param {Date} [now]
 * @returns {{start: Date, end: Date} | null}
 */
export function lastSession(schedule = {}, now = new Date()) {
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  if (days.length === 0) return null;
  const timeZone = safeTimeZone(schedule.timezone || DEFAULT_TIMEZONE);
  for (let offset = 0; offset <= 14; offset++) {
    const probe = new Date(now.getTime() - offset * 86_400_000);
    const p = zonedParts(probe, timeZone);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    if (!days.includes(weekday)) continue;
    const win = buildWindow(p.year, p.month, p.day, schedule.start, schedule.end, timeZone);
    if (win.end <= now) return win;
  }
  return null;
}
