// Schedule-aware weekly leaderboard ("This Week" / Player of the Week) — PURE
// ranking math, no database. Shared by the client arena tab (which recomputes
// from `matchHistory` already in state after every score, so the board updates
// live) and the server read in `leaderboard-server.js`, exactly like
// `matchmaking.js`/`rating.js` are shared, so client and server never drift.
// Wins are derived from finished-match history (winning team = higher score).
// Keep this module free of server-only imports so it can run in the browser.

/** Default IANA zone used when an arena has no timezone set. */
export const DEFAULT_TIMEZONE = 'Asia/Manila';
/** How many players the leaderboard surfaces. */
export const LEADERBOARD_SIZE = 5;

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

/** Weekday (0 = Sunday … 6 = Saturday) of an instant in a given timezone. */
function zonedWeekday(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/**
 * Convert a local wall-clock time in `timeZone` to the matching UTC instant.
 * Two passes correct for any offset change at the boundary (DST-safe; the
 * default zone has no DST, so the first pass already lands).
 */
function zonedToUtc(year, month, day, timeZone) {
  const guessUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetAt = (ms) => {
    const p = zonedParts(new Date(ms), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  const firstPass = guessUtc - offsetAt(guessUtc);
  return new Date(guessUtc - offsetAt(firstPass));
}

/**
 * The current calendar week (Monday 00:00 → next Monday 00:00) in `timeZone`,
 * as a `[start, end)` pair of UTC instants.
 * @param {Date} now
 * @param {string} timeZone
 * @returns {{start: Date, end: Date}}
 */
export function weekWindow(now, timeZone) {
  const p = zonedParts(now, timeZone);
  const todayUtc = Date.UTC(p.year, p.month - 1, p.day);
  const dow = new Date(todayUtc).getUTCDay(); // 0 = Sun … 6 = Sat
  const sinceMonday = (dow + 6) % 7; // Mon → 0, Sun → 6
  const monday = new Date(todayUtc - sinceMonday * 86_400_000);
  const nextMonday = new Date(todayUtc + (7 - sinceMonday) * 86_400_000);
  return {
    start: zonedToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone),
    end: zonedToUtc(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate(), timeZone),
  };
}

const fullName = (p) => (p?.lastName ? `${p.firstName} ${p.lastName}` : (p?.firstName ?? 'Unknown'));

/**
 * Rank players by wins this scheduled week. Pure: same input → same output.
 *
 * @param {{
 *   matches: Array<{
 *     team1: Array<{id:string,firstName:string,lastName?:string|null}>,
 *     team2: Array<{id:string,firstName:string,lastName?:string|null}>,
 *     score1: number, score2: number, timestamp: string,
 *   }>,
 *   schedule?: {days?: number[], timezone?: string},
 *   now?: Date|string,
 *   limit?: number,
 * }} input
 * @returns {{
 *   window: {start:string, end:string, timezone:string, days:number[]},
 *   leaders: Array<{rank:number, playerId:string, name:string, wins:number, games:number, winPct:number}>,
 *   playerCount: number,
 *   hasData: boolean,
 * }}
 */
export function computeWeeklyLeaderboard({ matches = [], schedule = {}, now, limit = LEADERBOARD_SIZE } = {}) {
  const timeZone = schedule.timezone || DEFAULT_TIMEZONE;
  const days = Array.isArray(schedule.days) ? schedule.days : [];
  const nowDate = now ? new Date(now) : new Date();
  const { start, end } = weekWindow(nowDate, timeZone);

  // Tally wins/games per player across matches inside the window that fall on a
  // scheduled weekday (all days when no schedule is configured).
  const tally = new Map(); // playerId -> { name, wins, games, lastWinAt }
  for (const m of matches) {
    const when = new Date(m.timestamp);
    if (when < start || when >= end) continue;
    if (days.length > 0 && !days.includes(zonedWeekday(when, timeZone))) continue;

    const winningTeam = m.score1 > m.score2 ? m.team1 : m.score2 > m.score1 ? m.team2 : null;
    const winnerIds = new Set((winningTeam ?? []).map((p) => p.id));
    for (const player of [...m.team1, ...m.team2]) {
      const entry = tally.get(player.id) ?? { name: fullName(player), wins: 0, games: 0, lastWinAt: 0 };
      entry.name = fullName(player); // latest snapshot wins
      entry.games += 1;
      if (winnerIds.has(player.id)) {
        entry.wins += 1;
        entry.lastWinAt = Math.max(entry.lastWinAt, when.getTime());
      }
      tally.set(player.id, entry);
    }
  }

  const ranked = [...tally.entries()]
    .map(([playerId, e]) => ({
      playerId,
      name: e.name,
      wins: e.wins,
      games: e.games,
      winPct: e.games ? e.wins / e.games : 0,
      lastWinAt: e.lastWinAt,
    }))
    .filter((p) => p.wins > 0) // only players with at least one win can place
    .sort(
      (a, b) =>
        b.wins - a.wins || // most wins
        b.winPct - a.winPct || // tie → higher win %
        a.games - b.games || // then fewer games (more efficient)
        b.lastWinAt - a.lastWinAt, // then most recent win
    );

  const leaders = ranked.slice(0, limit).map((p, i) => ({
    rank: i + 1,
    playerId: p.playerId,
    name: p.name,
    wins: p.wins,
    games: p.games,
    winPct: Math.round(p.winPct * 100),
  }));

  return {
    window: { start: start.toISOString(), end: end.toISOString(), timezone: timeZone, days },
    leaders,
    playerCount: ranked.length,
    hasData: leaders.length > 0,
  };
}
