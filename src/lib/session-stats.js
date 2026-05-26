// Session-scoped per-player stats — PURE tally from finished-match history,
// no database. The arena view overlays these onto the `players` array so the
// Paddle Rack tile and the My Stats tab show "this session" rather than
// lifetime counters, and stop drifting away from the This Week leaderboard
// after a manager hits "Reset session now". Lifetime counters still live on
// the `Player` row (incremented in `endMatch`) and continue to back /profile.
// Keep this module free of server-only imports so it can run in the browser.

/**
 * Tally games / wins / losses per player from match history, counting only
 * matches at or after the session boundary. A null/undefined boundary means
 * "no reset yet" — every match in `matches` is counted (so a never-reset
 * arena renders the same numbers it always did).
 *
 * Tie matches (score1 === score2) contribute a game to every participant but
 * no win and no loss — same convention `computeWeeklyLeaderboard` uses.
 *
 * @param {Array<{
 *   team1: Array<{id:string}>,
 *   team2: Array<{id:string}>,
 *   score1: number, score2: number, timestamp: string,
 * }>} matches
 * @param {string|Date|null|undefined} sessionStart - ISO string or Date marking the session boundary (inclusive); null/undefined means count everything
 * @returns {Map<string, { games: number, wins: number, losses: number }>}
 */
export function computeSessionStats(matches = [], sessionStart = null) {
  const start = sessionStart ? new Date(sessionStart) : null;
  const tally = new Map();

  for (const m of matches) {
    if (start && new Date(m.timestamp) < start) continue;

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
