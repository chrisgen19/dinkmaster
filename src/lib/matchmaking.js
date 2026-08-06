// Default matchmaking thresholds, imported by the server actions (queue
// ordering) and the UI (the ⏳ waiting badge) as fall-backs when a per-arena
// override is not available. Each arena now persists its own
// `starveThreshold` / `emergencyWait` (see `prisma/schema.prisma`), defaulting
// to these values so existing arenas are unchanged.
//
// Auto-mix ordering bands (see endMatch in app/actions.js):
//   skipBoosted              -> next-line: skipped paddles returning from away,
//                               strictly longest-first (above emergency)
//   wait >= emergencyWait    -> emergency: strictly longest-first
//   wait >= starveThreshold  -> protected (the ⏳ badge): always ahead of fresh
//   otherwise                -> fresh
// Within a band, players are ordered by fewest games played first (so the
// person who has played least goes next), with randomness only breaking ties
// among equal game counts. Starvation is bounded by the wait bands, not games.
export const DEFAULT_STARVE_THRESHOLD = 2;
export const DEFAULT_EMERGENCY_WAIT = 4;

// Size of the "on deck" group — the front-of-rack paddles next in line for a
// court. The rack UI highlights this many, and `skipPlayer` only lets an
// on-deck paddle skip. Equals a doubles court (4), which `fillCourt` pulls
// (its matchup logic is hardwired to 4, so it isn't parameterized by this).
export const ON_DECK_SIZE = 4;

// Reasonable bounds on the per-arena thresholds. Lower bound is 1 (zero would
// mean "everyone is protected" — useless); upper bound stops a typo from
// creating a runaway value. Shared by the server validation and the Settings
// UI so the two stay in sync.
//
// NOTE: if you change this value, also update the matching CHECK constraint in
// `prisma/migrations/20260523133800_add_matchmaking_threshold_constraints/migration.sql`
// (which currently hardcodes `BETWEEN 1 AND 50`) — SQL can't import this
// constant, so the two have to be bumped together.
export const MAX_WAIT_THRESHOLD = 50;

/**
 * Compute the auto-mix priority band for a given wait count.
 *   3 — next-line (skipBoosted; strictly longest-first, above emergency)
 *   2 — emergency (strictly longest-first)
 *   1 — protected (the ⏳ badge; fewest-games-first)
 *   0 — fresh
 * Pure so it can be unit-tested without spinning up Prisma; imported by
 * `endMatch` in `app/actions.js`.
 *
 * @param {number} waitRounds
 * @param {{starveThreshold: number, emergencyWait: number, skipBoosted?: boolean}} thresholds
 */
export function bandOf(waitRounds, { starveThreshold, emergencyWait, skipBoosted = false }) {
  if (skipBoosted) return 3;
  if (waitRounds >= emergencyWait) return 2;
  if (waitRounds >= starveThreshold) return 1;
  return 0;
}

/**
 * Build the sort key for one queued paddle.
 *
 * Extracted here (with {@link compareAutoMix}) because the identical sort ran
 * in two places — `applyAutoMixTx` server-side and `resolveCommand` in the
 * offline engine — and they must produce the same order or an offline session
 * diverges from the board it syncs into. Same rationale as sharing `bandOf`.
 *
 * @param {{id:string, waitRounds:number, gamesPlayed:number, gamesOffset:number, skipBoosted?:boolean}} player
 * @param {object} opts
 * @param {{wins:number, games:number}} [opts.record] - the player's record in the
 *   OPEN activity, for ladder mode. Omit (or pass null) when ladder mode is off.
 * @param {number} [opts.rand] - pre-drawn tie-break, so the caller owns randomness
 *   (the offline engine needs a seeded PRNG to replay deterministically).
 */
export function autoMixKey(player, {
  starveThreshold,
  emergencyWait,
  skipRestoresPriority = true,
  record = null,
  rand = 0,
}) {
  const tally = record ?? { wins: 0, games: 0 };
  return {
    id: player.id,
    band: bandOf(player.waitRounds, {
      starveThreshold,
      emergencyWait,
      skipBoosted: player.skipBoosted && skipRestoresPriority,
    }),
    waitRounds: player.waitRounds,
    // Ladder tier — wins this activity, then win rate. Both are 0 for everyone
    // when ladder mode is off, which makes the two ladder comparisons in
    // `compareAutoMix` no-ops and leaves the ordering byte-identical to the
    // pre-ladder behaviour. That's deliberate: one comparator serves both modes.
    wins: tally.wins,
    winPct: tally.games > 0 ? tally.wins / tally.games : 0,
    // Fairness metric — games played since joining. Distinct from `tally.games`
    // (this activity only); conflating them would let a late joiner's offset
    // leak into the ladder.
    games: player.gamesPlayed + player.gamesOffset,
    rand,
  };
}

/**
 * Order two auto-mix sort keys. Lexicographic, most significant first:
 *
 *   1. band          — next-line > emergency > protected > fresh
 *   2. waitRounds    — longest-first, but ONLY in the two strict bands
 *   3. wins          — ladder tier (no-op when ladder mode is off)
 *   4. winPct        — ladder tie-break, matching `computeActivityStandings`
 *   5. games         — fewest games-since-joining first
 *   6. rand          — random tie-break among equals
 *
 * The wait bands sit ABOVE the ladder on purpose: a player on a losing run
 * groups with other losers, but once they hit `starveThreshold` they still cut
 * the line. Without that, a small losers' pool could leave someone waiting all
 * night — the ladder is a preference, starvation protection is a guarantee.
 */
/**
 * Post-mix notification copy. Shared so the server and the offline engine can't
 * describe the same reorder differently — and so the ladder variant doesn't
 * claim "longest-waiting up next" when the rack was actually sorted by record.
 */
export const MIX_MESSAGE = '⚡ Silo-Buster: Mixed the rack (longest-waiting up next) to keep matchups fresh and fair!';
export const LADDER_MIX_MESSAGE = '🪜 Ladder: Mixed the rack by tonight’s record — winners face winners. Long waits still cut the line.';

export function compareAutoMix(a, b) {
  if (a.band !== b.band) return b.band - a.band;
  if ((a.band === 3 || a.band === 2) && a.waitRounds !== b.waitRounds) return b.waitRounds - a.waitRounds;
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (a.winPct !== b.winPct) return b.winPct - a.winPct;
  if (a.games !== b.games) return a.games - b.games;
  return a.rand - b.rand;
}
