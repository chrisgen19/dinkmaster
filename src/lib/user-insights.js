/**
 * Pure aggregations powering the /profile insights row + recent-matches feed.
 *
 * Each `MatchPlayerRow` is one row from `prisma.matchPlayer.findMany` with
 * `{ match: { players, arena } }` included. The viewer is the user identified
 * by `viewerPlayerIds` — the set of player ids that belong to them across
 * arenas (one per arena they've ever joined).
 *
 * The helpers don't touch the DB so they can be unit-tested with plain object
 * fixtures.
 */

/**
 * Enrich a recent-matches slice with partner + opponent rosters and the
 * viewer's score/outcome. Pass newest-first; output stays in input order.
 *
 * @param {object[]} matchPlayerRows - viewer's `matchPlayer` rows newest-first
 * @param {Set<string>} viewerPlayerIds - all of the viewer's player ids
 * @returns {object[]} ready to feed to `toMatch()` in player shape
 */
export function enrichRecentMatches(matchPlayerRows, viewerPlayerIds) {
  return matchPlayerRows.map((mp) => {
    const m = mp.match;
    const scoreFor = mp.team === 1 ? m.score1 : m.score2;
    const scoreAgainst = mp.team === 1 ? m.score2 : m.score1;
    const partners = (m.players ?? [])
      .filter((p) => p.team === mp.team && !viewerPlayerIds.has(p.playerId))
      .map(toName);
    const opponents = (m.players ?? [])
      .filter((p) => p.team !== mp.team)
      .map(toName);
    // Outcome is intentionally omitted — `winnerSide(toMatch(m))` in the UI
    // layer is the single source of truth and correctly treats ties as a
    // distinct third state instead of a loss.
    return {
      matchId: m.id,
      arenaName: m.arena?.name,
      courtName: m.courtName,
      scoreFor,
      scoreAgainst,
      partners,
      opponents,
      timestamp: new Date(m.createdAt).toISOString(),
    };
  });
}

/**
 * Across every match the viewer has played, find the partner they've played
 * with most often (ties broken by win rate, then alphabetically). Returns
 * `null` if the viewer has no decided matches.
 *
 * Tied matches (rare under the scoring rules) are excluded from the tally so
 * the partner's win % only reflects decided games — otherwise a tie would be
 * silently counted as a non-win and pull the rate down.
 *
 * @param {object[]} matchPlayerRows - viewer's `matchPlayer` rows
 * @param {Set<string>} viewerPlayerIds
 * @returns {{name: string, games: number, wins: number, winPct: number}|null}
 */
export function bestPartner(matchPlayerRows, viewerPlayerIds) {
  // Aggregate per partner playerId. Walk-ins keep stable ids per arena so
  // they aggregate correctly within an arena (and just don't roll up across
  // arenas, which is fine — walk-ins don't span arenas).
  const tally = new Map();
  for (const mp of matchPlayerRows) {
    const m = mp.match;
    const scoreFor = mp.team === 1 ? m.score1 : m.score2;
    const scoreAgainst = mp.team === 1 ? m.score2 : m.score1;
    if (scoreFor === scoreAgainst) continue; // skip undecided (tie) matches
    const viewerWon = scoreFor > scoreAgainst;
    for (const p of m.players ?? []) {
      if (p.team !== mp.team) continue; // opponents skipped
      if (viewerPlayerIds.has(p.playerId)) continue; // viewer themselves
      const key = p.playerId;
      const entry = tally.get(key) ?? {
        name: nameFromRow(p),
        games: 0,
        wins: 0,
      };
      entry.games += 1;
      if (viewerWon) entry.wins += 1;
      tally.set(key, entry);
    }
  }
  if (tally.size === 0) return null;
  const ranked = [...tally.values()]
    .map((e) => ({ ...e, winPct: e.games > 0 ? Math.round((e.wins / e.games) * 100) : 0 }))
    .sort((a, b) =>
      b.games - a.games
      || b.winPct - a.winPct
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  return ranked[0];
}

/**
 * Most-frequent court name across the viewer's matches. Ties broken
 * alphabetically. Returns `null` when no matches yet.
 *
 * @param {object[]} matchPlayerRows
 * @returns {{name: string, games: number}|null}
 */
export function favoriteCourt(matchPlayerRows) {
  const tally = new Map();
  for (const mp of matchPlayerRows) {
    const name = mp.match?.courtName;
    if (!name) continue;
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  const ranked = [...tally.entries()]
    .map(([name, games]) => ({ name, games }))
    .sort((a, b) =>
      b.games - a.games
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
  return ranked[0];
}

/**
 * Current head-streak across the viewer's matches (newest-first). Returns
 * `null` if there are no matches.
 *
 * @param {object[]} matchPlayerRows - newest-first
 * @returns {{kind: 'W'|'L', count: number}|null}
 */
export function currentStreak(matchPlayerRows) {
  if (matchPlayerRows.length === 0) return null;
  const wonAt = (mp) => {
    const m = mp.match;
    const f = mp.team === 1 ? m.score1 : m.score2;
    const a = mp.team === 1 ? m.score2 : m.score1;
    if (f === a) return null; // skip rare ties
    return f > a;
  };
  // Skip leading ties so we anchor on a decided match.
  let i = 0;
  while (i < matchPlayerRows.length && wonAt(matchPlayerRows[i]) === null) i += 1;
  if (i === matchPlayerRows.length) return null;
  const kind = wonAt(matchPlayerRows[i]) ? 'W' : 'L';
  let count = 0;
  for (let j = i; j < matchPlayerRows.length; j += 1) {
    const w = wonAt(matchPlayerRows[j]);
    // Break (not continue) on a mid-streak tie so the count matches
    // `summarise()` in match-history.js — otherwise two streak displays on
    // the same page can show different numbers when a tie interrupts.
    if (w === null) break;
    if ((w && kind === 'W') || (!w && kind === 'L')) count += 1;
    else break;
  }
  return { kind, count };
}

/** Display name "First L." (initial only when last name is set). Same rule
 *  as the rest of the app for compact rosters. */
function toName(row) {
  return { firstName: row.playerFirstName, lastName: row.playerLastName ?? null };
}

function nameFromRow(row) {
  if (row.playerLastName) {
    return `${row.playerFirstName} ${row.playerLastName.charAt(0).toUpperCase()}.`;
  }
  return row.playerFirstName;
}

/** Initial-monogram for an avatar tile: "Christian Genesis Diomampo" → "CD".
 *  Falls back to "?" for empty/missing input. */
export function monogram(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
