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
