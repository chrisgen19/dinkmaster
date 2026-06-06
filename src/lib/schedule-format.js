/**
 * Shared arena-schedule display helpers — the single source of truth for the
 * weekday list and the one-line schedule summary. Consumed by the arena page
 * (hero + This Week panel), the /arenas directory cards, and the schedule
 * editor's weekday options. Lives in lib (no 'use client') so both server
 * pages and client components can import it.
 */

/** Weekday options, Monday-first; `value` matches JS `Date.getDay()`. */
export const WEEKDAYS = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
];

/** "18:30" → "6:30 PM"; null/empty → null. */
export const formatClock = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

/** Whether an arena has any real play schedule set (days or times), vs. the
 *  empty default that `describeSchedule` would render as "Every day". */
export const hasConfiguredSchedule = (schedule) =>
  Boolean(schedule?.days?.length || schedule?.start || schedule?.end);

/** One-line schedule summary, e.g. "Mon, Wed, Fri · 6:00 PM–10:00 PM (Asia/Manila)". */
export const describeSchedule = ({ days = [], start, end, timezone } = {}) => {
  const ordered = WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.short);
  const dayPart = ordered.length ? ordered.join(', ') : 'Every day';
  const startC = formatClock(start);
  const endC = formatClock(end);
  const timePart = startC && endC ? ` · ${startC}–${endC}` : '';
  return `${dayPart}${timePart}${timezone ? ` (${timezone})` : ''}`;
};
