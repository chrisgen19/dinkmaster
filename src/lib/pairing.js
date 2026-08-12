// Team-split logic for a filled court: given the four paddles pulled off the
// top of the rack, decide who partners whom.
//
// The rule is "losers partner winners": pair each player who LOST their most
// recent game with one who WON theirs, so a beaten pair is never sent back out
// together against a pair that just rolled them. Among splits that satisfy it
// equally well, the closer-rated split wins, then the one that repeats the
// fewest prior partnerships (preserving the Silo-Buster anti-clique property),
// then a random tie-break.
//
// Everything here is PURE so the two callers can never drift:
//   - `applyFillCourtTx` (src/lib/board-apply.js) — the online server action
//   - `resolveCommand` (src/lib/board-engine.js) — the offline board engine
// Both normalize their own data into the shapes below and get the identical
// ranking. Offline records the chosen split in the event `outcome`, so a
// synced replay reproduces it exactly.

import { RATING_BASELINE } from '@/lib/rating';

/**
 * How many recent matches to scan for "who just won / who just lost". A player
 * whose last game falls outside this window counts as having no recent result
 * (neither winner nor loser) and pairs freely — which is also what happens to
 * someone who has not played yet this session.
 */
export const RECENT_MATCH_WINDOW = 20;

/**
 * Each player's most recent win/loss within the recent-match window.
 *
 * @param {Array<{team1: string[], team2: string[], score1: number, score2: number}>} recentMatches
 *   newest-first; ties (score1 === score2) are skipped as neither result
 * @param {string[]} ids - the players to resolve
 * @param {number} [window] - how many matches to scan
 * @returns {Map<string, 'W'|'L'|null>}
 */
export function recentResults(recentMatches, ids, window = RECENT_MATCH_WINDOW) {
  const out = new Map(ids.map((id) => [id, null]));
  let remaining = ids.length;

  for (const match of recentMatches.slice(0, window)) {
    if (remaining === 0) break;
    if (match.score1 === match.score2) continue; // no ties in pickleball, but never trust the data
    const winners = match.score1 > match.score2 ? match.team1 : match.team2;
    const losers = match.score1 > match.score2 ? match.team2 : match.team1;
    for (const id of winners) {
      if (out.has(id) && out.get(id) === null) {
        out.set(id, 'W');
        remaining -= 1;
      }
    }
    for (const id of losers) {
      if (out.has(id) && out.get(id) === null) {
        out.set(id, 'L');
        remaining -= 1;
      }
    }
  }
  return out;
}

/** A team is "crossed" when it pairs a recent loser with a recent winner. */
function isCrossed(pair, results) {
  const [a, b] = pair.map((id) => results.get(id) ?? null);
  return (a === 'W' && b === 'L') || (a === 'L' && b === 'W');
}

/**
 * Score all three ways to split four players into two teams.
 *
 * Ranking precedence, best first:
 *   1. `crossCount` desc — sides pairing a recent loser with a recent winner
 *      (2 = both sides crossed, 1 = one side, 0 = neither)
 *   2. `ratingGap` asc — Elo distance between the two sides' averages
 *   3. `repeats` asc — prior partnerships the split would repeat
 *
 * When `balanced` is false the arena has opted out (Settings → Matchmaking):
 * both skill keys score 0 for every split, so the ranking — and
 * {@link bestMatchups} — falls through to `repeats` alone, reproducing the
 * pre-toggle lowest-partnership rule exactly. Keeping legacy mode in this same
 * function is deliberate: it's the only way both engines can be sure their two
 * modes stay identical to each other.
 *
 * @param {string[]} ids - exactly four player ids, in rack order
 * @param {object} ctx
 * @param {Map<string, 'W'|'L'|null>} ctx.results - from {@link recentResults}
 * @param {Map<string, number>} ctx.ratings - playerId -> Elo
 * @param {(a: string, b: string) => number} ctx.pairCount - prior partnership count
 * @param {boolean} [ctx.balanced=true] - false = legacy lowest-partnership rule
 * @returns {Array<{team1: string[], team2: string[], crossCount: number, ratingGap: number, repeats: number}>}
 *   all three splits, best first
 */
export function rankMatchups(ids, { results, ratings, pairCount, balanced = true }) {
  const [p0, p1, p2, p3] = ids;
  // Fall back to the baseline for a player whose rating is missing (a stale
  // offline snapshot predating Phase 6). Letting `undefined` through would
  // make every gap NaN, and NaN !== NaN would then empty `bestMatchups`.
  const ratingOf = (id) => ratings.get(id) ?? RATING_BASELINE;
  const avg = (pair) => (ratingOf(pair[0]) + ratingOf(pair[1])) / 2;

  return [
    { team1: [p0, p1], team2: [p2, p3] },
    { team1: [p0, p2], team2: [p1, p3] },
    { team1: [p0, p3], team2: [p1, p2] },
  ]
    .map((split) => ({
      ...split,
      crossCount: balanced
        ? (isCrossed(split.team1, results) ? 1 : 0) + (isCrossed(split.team2, results) ? 1 : 0)
        : 0,
      ratingGap: balanced ? Math.abs(avg(split.team1) - avg(split.team2)) : 0,
      repeats: pairCount(...split.team1) + pairCount(...split.team2),
    }))
    .sort(
      (a, b) =>
        b.crossCount - a.crossCount || a.ratingGap - b.ratingGap || a.repeats - b.repeats,
    );
}

/**
 * The subset of {@link rankMatchups} output that ties for best on every key.
 * Callers shuffle this and take the first, so the random tie-break stays with
 * the caller's own RNG (injectable offline, so replay reproduces the choice).
 *
 * @param {ReturnType<typeof rankMatchups>} ranked
 */
export function bestMatchups(ranked) {
  const [top] = ranked;
  return ranked.filter(
    (m) =>
      m.crossCount === top.crossCount &&
      m.ratingGap === top.ratingGap &&
      m.repeats === top.repeats,
  );
}
