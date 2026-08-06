// Activities — PURE window enumeration, titles, and per-activity tallies.
// No database. Mirrors leaderboard.js/sessions.js/session-stats.js: keep this
// module free of server-only imports so it runs in the browser, letting the
// arena view recompute standings live from the `matchHistory` it already holds
// while the server reads the identical function. Client and server can't drift.
//
// The relationship to sessions.js: that module turns the arena's recurring
// schedule into `{start, end}` windows on demand. This module decides WHICH of
// those windows deserve to be persisted as `Activity` rows, and tallies records
// against the ones that were.

import { currentSession, nextSession } from '@/lib/sessions';

/** How far ahead `upcomingWindows` materializes by default. */
export const DEFAULT_HORIZON_DAYS = 28;

/**
 * Safety valve on the enumeration loop. A daily schedule over the default
 * horizon yields 28 windows; 128 leaves generous headroom while guaranteeing
 * termination if `nextSession` ever fails to advance.
 */
const MAX_WINDOWS = 128;

/**
 * Every session window from `now` out to `horizonDays`, oldest first.
 *
 * Includes the currently-live window when there is one — `nextSession` only
 * returns windows starting strictly after `now`, so without this a manager
 * loading the page mid-session would find tonight missing from the list.
 *
 * @param {{days?:number[], start?:string|null, end?:string|null, timezone?:string}} schedule
 * @param {Date} [now]
 * @param {number} [horizonDays]
 * @returns {Array<{start: Date, end: Date}>}
 */
export function upcomingWindows(schedule = {}, now = new Date(), horizonDays = DEFAULT_HORIZON_DAYS) {
  const days = Array.isArray(schedule?.days) ? schedule.days : [];
  if (days.length === 0) return [];

  const out = [];
  const live = currentSession(schedule, now);
  if (live) out.push(live);

  const limit = new Date(now.getTime() + horizonDays * 86_400_000);
  let cursor = now;
  for (let i = 0; i < MAX_WINDOWS; i++) {
    const win = nextSession(schedule, cursor);
    if (!win || win.start > limit) break;
    out.push(win);
    // Step just past this window's start so the next call returns the one
    // after it (nextSession's predicate is `start > cursor`).
    cursor = new Date(win.start.getTime() + 1000);
  }
  return out;
}

/**
 * Display name for an activity: the manager's title when set, otherwise
 * derived from the window — "Tuesday · Jul 14".
 *
 * Uses the activity's OWN `timezone` snapshot, never the arena's current one,
 * so relocating a club doesn't retroactively relabel finished nights.
 *
 * @param {{title?:string|null, startsAt: string|Date, timezone?: string}} activity
 */
export function activityTitle(activity) {
  if (activity?.title) return activity.title;
  const startsAt = activity?.startsAt ? new Date(activity.startsAt) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) return 'Activity';
  const timeZone = safeZone(activity?.timezone);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(startsAt);
  const date = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(startsAt);
  return `${weekday} · ${date}`;
}

/**
 * "6:00 PM – 10:00 PM" for an activity's window, in its own timezone.
 * Returns null when either bound is missing/unparseable.
 */
export function activityTimeRange(activity) {
  const start = activity?.startsAt ? new Date(activity.startsAt) : null;
  const end = activity?.endsAt ? new Date(activity.endsAt) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const timeZone = safeZone(activity?.timezone);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/**
 * Never let a corrupted/legacy timezone throw a RangeError out of Intl —
 * same defensive posture as `safeTimeZone` in sessions.js.
 */
function safeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Asia/Manila';
  }
}

/**
 * Convert a local wall-clock date + time in `timeZone` to the matching UTC
 * instant. Two passes correct for any offset change at the boundary (DST-safe).
 *
 * Exists because `new Date('2026-03-15T18:00')` resolves in the RUNTIME's zone.
 * For a manager creating a one-off session that runtime is their browser, so a
 * 6 PM session for a Manila club entered from a New York laptop would be stored
 * as 6 PM Eastern and then rendered — using the arena's timezone snapshot — as
 * 7 AM the next day. The wall time a manager types is a wall time in the
 * ARENA's zone, always.
 *
 * @param {string} date - "YYYY-MM-DD"
 * @param {string} time - "HH:MM"
 * @param {string} timeZone - IANA zone
 * @returns {Date|null} null when either field is malformed
 */
export function wallClockToUtc(date, time, timeZone) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  const t = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!d || !t) return null;
  const [year, month, day] = [+d[1], +d[2], +d[3]];
  const [hour, minute] = [+t[1], +t[2]];
  if (hour > 23 || minute > 59) return null;

  const zone = safeZone(timeZone);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsetAt = (ms) => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

/**
 * Where an activity sits relative to `now`, for list grouping and badges.
 *
 * Driven by `status` first — a manager who explicitly opened or cancelled a
 * night outranks the clock — and falls back to the window only for rows still
 * sitting at SCHEDULED.
 *
 * @returns {'cancelled'|'live'|'past'|'upcoming'}
 */
export function deriveActivityState(activity, now = new Date()) {
  if (activity?.status === 'CANCELLED') return 'cancelled';
  if (activity?.status === 'LIVE') return 'live';
  if (activity?.status === 'COMPLETED') return 'past';
  const end = activity?.endsAt ? new Date(activity.endsAt) : null;
  if (end && end <= now) return 'past';
  return 'upcoming';
}

/**
 * Tally games / wins / losses per player for ONE activity.
 *
 * The successor to `computeSessionStats`, which filtered by `timestamp >=
 * lastSessionResetAt`. Matching on `activityId` instead of a timestamp cutoff
 * means a match finished either side of a boundary lands where it actually
 * belongs, and — unlike the old scalar — past activities stay computable
 * forever.
 *
 * A null `activityId` means "count everything", preserving the old
 * null-boundary behaviour for arenas that have no activity open.
 *
 * Ties (score1 === score2) give every participant a game but no win and no
 * loss — the same convention `computeWeeklyLeaderboard` uses.
 *
 * @param {Array<{team1:Array<{id:string}>, team2:Array<{id:string}>, score1:number, score2:number, activityId?:string|null}>} matches
 * @param {string|null} [activityId]
 * @returns {Map<string, {games:number, wins:number, losses:number}>}
 */
export function computeActivityStats(matches = [], activityId = null) {
  const tally = new Map();

  for (const m of matches) {
    if (activityId && m.activityId !== activityId) continue;

    const isTie = m.score1 === m.score2;
    const winningTeam = isTie ? null : m.score1 > m.score2 ? m.team1 : m.team2;
    const winnerIds = new Set((winningTeam ?? []).map((p) => p.id));

    for (const player of [...m.team1, ...m.team2]) {
      const entry = tally.get(player.id) ?? { games: 0, wins: 0, losses: 0 };
      entry.games += 1;
      if (!isTie) {
        if (winnerIds.has(player.id)) entry.wins += 1;
        else entry.losses += 1;
      }
      tally.set(player.id, entry);
    }
  }

  return tally;
}

const fullName = (p) => (p?.lastName ? `${p.firstName} ${p.lastName}` : (p?.firstName ?? 'Unknown'));

/**
 * Rank every player who appeared in an activity.
 *
 * Ordering matches `computeWeeklyLeaderboard` (wins desc → win% desc → most
 * recent win desc) so a player's position never flips between the two boards
 * for the same games. One deliberate difference: the weekly board filters to
 * players with at least one win because it crowns a Player of the Week, while
 * an activity's standings are the night's full scoreboard — everyone who
 * played gets a row, winless or not.
 *
 * @param {{matches:Array, activityId?:string|null, limit?:number}} input
 * @returns {{standings:Array<{rank:number, playerId:string, name:string, games:number, wins:number, losses:number, winPct:number}>, playerCount:number, gameCount:number, hasData:boolean}}
 */
export function computeActivityStandings({ matches = [], activityId = null, limit = Infinity } = {}) {
  const scoped = activityId ? matches.filter((m) => m.activityId === activityId) : matches;
  const tally = new Map(); // playerId -> { name, games, wins, losses, lastWinAt }

  for (const m of scoped) {
    const when = new Date(m.timestamp).getTime();
    const isTie = m.score1 === m.score2;
    const winningTeam = isTie ? null : m.score1 > m.score2 ? m.team1 : m.team2;
    const winnerIds = new Set((winningTeam ?? []).map((p) => p.id));

    for (const player of [...m.team1, ...m.team2]) {
      const entry = tally.get(player.id) ?? { name: fullName(player), games: 0, wins: 0, losses: 0, lastWinAt: 0 };
      entry.name = fullName(player); // latest snapshot wins
      entry.games += 1;
      if (!isTie) {
        if (winnerIds.has(player.id)) {
          entry.wins += 1;
          entry.lastWinAt = Math.max(entry.lastWinAt, when);
        } else {
          entry.losses += 1;
        }
      }
      tally.set(player.id, entry);
    }
  }

  const ranked = [...tally.entries()]
    .map(([playerId, e]) => ({
      playerId,
      name: e.name,
      games: e.games,
      wins: e.wins,
      losses: e.losses,
      winPct: e.games ? e.wins / e.games : 0,
      lastWinAt: e.lastWinAt,
    }))
    .sort((a, b) => b.wins - a.wins || b.winPct - a.winPct || b.lastWinAt - a.lastWinAt);

  return {
    standings: ranked.slice(0, limit).map((p, i) => ({
      rank: i + 1,
      playerId: p.playerId,
      name: p.name,
      games: p.games,
      wins: p.wins,
      losses: p.losses,
      winPct: Math.round(p.winPct * 100),
    })),
    playerCount: ranked.length,
    gameCount: scoped.length,
    hasData: ranked.length > 0,
  };
}

/**
 * Which waitlisted attendees should be promoted to GOING.
 *
 * First-come-first-serve on `position`, matching Reclub's behaviour: when a
 * confirmed player drops, the top of the waitlist moves up automatically. An
 * activity with no `capacity` is uncapped, so the whole waitlist clears.
 *
 * Pure so the promotion decision is unit-testable away from the transaction
 * that applies it.
 *
 * @param {Array<{id:string, status:string, position?:number|null}>} attendees
 * @param {number|null} capacity
 * @returns {string[]} attendee ids to promote, in promotion order
 */
export function promoteFromWaitlist(attendees = [], capacity = null) {
  const waitlisted = attendees
    .filter((a) => a.status === 'WAITLIST')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (waitlisted.length === 0) return [];

  if (capacity === null || capacity === undefined) return waitlisted.map((a) => a.id);

  // CHECKED_IN counts against capacity too — someone already on site is
  // occupying a slot just as much as someone who only RSVP'd.
  const confirmed = attendees.filter((a) => a.status === 'GOING' || a.status === 'CHECKED_IN').length;
  const openSlots = Math.max(0, capacity - confirmed);
  return waitlisted.slice(0, openSlots).map((a) => a.id);
}
