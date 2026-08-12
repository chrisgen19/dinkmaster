/**
 * Pure helpers for the reusable <MatchHistory> component.
 *
 * Two raw shapes flow through the app today:
 *
 *   neutral (arena-wide): { id, timestamp, courtName, team1, team2, score1, score2 }
 *   player  (perspective): { id|matchId, timestamp, courtName, won, scoreFor, scoreAgainst, partners?, arenaName? }
 *
 * `toMatch()` normalises either into a single `Match` so the UI never branches
 * on shape. `groupByDay()` clusters them into "Today", "Yesterday", weekday,
 * or absolute-date buckets. `summarise()` collapses a list into W/L/streak.
 */

/**
 * @typedef {{firstName: string}} MatchPlayer
 * @typedef {{
 *   id: string,
 *   timestamp: string,
 *   courtName: string,
 *   arenaName?: string,
 *   teams: { a: { players: MatchPlayer[], score: number }, b: { players: MatchPlayer[], score: number } },
 *   youOn: 'a' | 'b' | null,
 * }} Match
 */

/**
 * Normalise either raw shape into the unified `Match`.
 *
 * @param {object} raw - The match record in either neutral or player shape.
 * @param {object} [options]
 * @param {string} [options.viewerPlayerId] - When supplied and `raw` is in
 *   neutral shape, marks which side (`a`/`b`) the viewer was on. Pass `null`
 *   to keep the match neutral even with team rosters.
 * @returns {Match}
 */
export function toMatch(raw, options = {}) {
  if (!raw) throw new Error('toMatch: raw match required');

  // Player-shape: explicit `won`/`scoreFor`/`scoreAgainst`, viewer always on side A.
  if (typeof raw.scoreFor === 'number' && typeof raw.scoreAgainst === 'number') {
    return {
      id: requireId(raw.id ?? raw.matchId),
      timestamp: raw.timestamp,
      courtName: raw.courtName,
      arenaName: raw.arenaName,
      teams: {
        a: { players: raw.partners ?? [], score: raw.scoreFor },
        b: { players: raw.opponents ?? [], score: raw.scoreAgainst },
      },
      youOn: 'a',
    };
  }

  // Neutral shape: full Team A/B rosters with absolute scores.
  if (Array.isArray(raw.team1) && Array.isArray(raw.team2)) {
    const viewerId = options.viewerPlayerId ?? null;
    const onA = viewerId ? raw.team1.some((p) => p?.id === viewerId) : false;
    const onB = viewerId ? raw.team2.some((p) => p?.id === viewerId) : false;
    return {
      id: requireId(raw.id),
      timestamp: raw.timestamp,
      courtName: raw.courtName,
      arenaName: raw.arenaName,
      teams: {
        a: { players: raw.team1, score: raw.score1 },
        b: { players: raw.team2, score: raw.score2 },
      },
      // Carried through for the arena's correction dialog, which must state
      // the target this match was played under (null = unknown, caller falls
      // back to the arena's current setting). Absent from player-shape rows,
      // which are read-only everywhere they're rendered.
      targetScore: raw.targetScore ?? null,
      youOn: onA ? 'a' : onB ? 'b' : null,
    };
  }

  throw new Error('toMatch: unrecognised raw match shape');
}

/** Fail fast on missing ids — silently stringifying `undefined` would create
 *  duplicate React keys and break list reconciliation downstream. */
function requireId(value) {
  if (value === undefined || value === null || value === '') {
    throw new Error('toMatch: match id required');
  }
  return String(value);
}

/**
 * Tell us who won a normalised match. Returns 'a', 'b', or 'tie' for the rare
 * legacy tie record (real games never tie under the scoring rules).
 *
 * @param {Match} m
 * @returns {'a' | 'b' | 'tie'}
 */
export function winnerSide(m) {
  if (m.teams.a.score > m.teams.b.score) return 'a';
  if (m.teams.b.score > m.teams.a.score) return 'b';
  return 'tie';
}

/**
 * Did the viewer win? Returns `null` in neutral mode AND for the rare tie
 * record — so ties are treated as undecided (skipped in win/loss tallies and
 * filter buckets) rather than silently counted as losses.
 *
 * @param {Match} m
 * @returns {boolean | null}
 */
export function viewerWon(m) {
  if (!m.youOn) return null;
  const w = winnerSide(m);
  if (w === 'tie') return null;
  return w === m.youOn;
}

/**
 * Signed score differential from the viewer's perspective in player mode, or
 * from Team A's perspective in neutral mode. Always returns the absolute spread
 * with a sign — useful for "+5" / "-3" pills.
 *
 * @param {Match} m
 * @returns {number}
 */
export function differential(m) {
  const side = m.youOn ?? 'a';
  const me = m.teams[side].score;
  const them = m.teams[side === 'a' ? 'b' : 'a'].score;
  return me - them;
}

/**
 * Day-bucket label: "Today" / "Yesterday" / weekday (within 6 days) / "MMM D"
 * (within current year) / "MMM D, YYYY" (older). Pure: pass `now` for tests.
 *
 * @param {Date} day - Local-midnight date for the match.
 * @param {Date} [now=new Date()] - Reference "today".
 * @returns {string}
 */
export function dayLabel(day, now = new Date()) {
  const today = startOfDay(now);
  const diffMs = today.getTime() - day.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round(diffMs / oneDay);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) {
    return day.toLocaleDateString(undefined, { weekday: 'long' });
  }
  const sameYear = day.getFullYear() === now.getFullYear();
  return day.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * Group matches into day buckets (newest day first, matches inside each group
 * in input order — caller is expected to pass newest-first).
 *
 * @param {Match[]} matches
 * @param {Date} [now=new Date()] - Reference "today" for label resolution.
 * @returns {{key: string, label: string, matches: Match[]}[]}
 */
export function groupByDay(matches, now = new Date()) {
  const buckets = new Map();
  for (const m of matches) {
    const day = startOfDay(new Date(m.timestamp));
    const key = day.toISOString().slice(0, 10);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label: dayLabel(day, now), day, matches: [] };
      buckets.set(key, bucket);
    }
    bucket.matches.push(m);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.day.getTime() - a.day.getTime())
    .map(({ day, ...rest }) => rest); // strip the Date helper
}

/**
 * Roll up a player-perspective list into win/loss totals and the current
 * tail-streak. Pass matches in newest-first order; the streak walks until the
 * outcome flips.
 *
 * @param {Match[]} matches
 * @returns {{
 *   total: number,
 *   wins: number,
 *   losses: number,
 *   winPct: number | null,
 *   streak: { kind: 'W' | 'L', count: number } | null,
 * }}
 */
export function summarise(matches) {
  let wins = 0;
  let losses = 0;
  for (const m of matches) {
    if (viewerWon(m) === true) wins += 1;
    else if (viewerWon(m) === false && m.youOn) losses += 1;
  }
  const decided = wins + losses;

  let streak = null;
  if (matches.length > 0 && matches[0].youOn) {
    const head = viewerWon(matches[0]);
    if (head !== null) {
      const kind = head ? 'W' : 'L';
      let count = 0;
      for (const m of matches) {
        const w = viewerWon(m);
        if (w === null) break;
        if ((w && kind === 'W') || (!w && kind === 'L')) count += 1;
        else break;
      }
      streak = { kind, count };
    }
  }

  return {
    total: matches.length,
    wins,
    losses,
    winPct: decided > 0 ? Math.round((wins / decided) * 100) : null,
    streak,
  };
}

/** Local-midnight start of a given date. Pulled out so `groupByDay` and
 *  `dayLabel` share the same notion of "day" (the viewer's local timezone). */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Resolves the CSS styling class for the scoreboard differential spread badge.
 *
 * @param {boolean} isPos
 * @param {boolean} isNeg
 * @param {string} perspective - 'player' | 'neutral'
 * @returns {string}
 */
export function scoreSpreadClass(isPos, isNeg, perspective) {
  return isPos
    ? 'bg-emerald-500 text-white shadow-xs shadow-emerald-500/15'
    : isNeg
      ? perspective === 'player'
        ? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/50'
        : 'bg-sky-50 text-sky-700 ring-1 ring-sky-200/50'
      : 'bg-slate-50 text-slate-400 ring-1 ring-slate-200/50';
}

/**
 * Resolves the progress bar segment colors for the split balance bar.
 *
 * @param {string} winner - 'a' | 'b' | 'tie'
 * @param {string} perspective - 'player' | 'neutral'
 * @param {boolean | null} youWon
 * @returns {{ leftBarColor: string, rightBarColor: string }}
 */
export function scoreSplitColors(winner, perspective, youWon) {
  let leftBarColor = 'bg-slate-300';
  let rightBarColor = 'bg-slate-300';

  if (winner === 'tie') {
    leftBarColor = 'bg-slate-400';
    rightBarColor = 'bg-slate-400';
  } else if (perspective === 'player') {
    if (youWon === true) {
      leftBarColor = 'bg-emerald-500';
    } else {
      rightBarColor = 'bg-rose-500';
    }
  } else {
    // Neutral perspective
    if (winner === 'a') {
      leftBarColor = 'bg-emerald-500';
    } else {
      rightBarColor = 'bg-sky-500';
    }
  }

  return { leftBarColor, rightBarColor };
}
