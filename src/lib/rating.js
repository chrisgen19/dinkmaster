// Skill-rating math (Phase 6). Imported by the server action that finishes a
// match (the rating update) and by both stats UIs (the DUPR display), so the
// scale and constants never drift between writing and showing a rating.
//
// Internally ratings are classic integer Elo — robust, well-understood
// constants — and are mapped to a DUPR-style decimal only for display.

/** Elo rating every player starts at (and is reset to). */
export const RATING_BASELINE = 1000;
/** Elo scale constant: a 400-point gap ≈ 10:1 expected odds. */
const RATING_SCALE = 400;
/** Maximum single-match Elo swing (classic chess K-factor). */
const K_FACTOR = 32;

// DUPR-style display: a linear map from integer Elo to a 2.000–8.000 decimal.
// 1000 Elo = 3.500 DUPR; every 100 Elo points = 0.500 DUPR points.
const DUPR_BASELINE = 3.5;
const DUPR_PER_ELO = 0.5 / 100;
const DUPR_MIN = 2.0;
const DUPR_MAX = 8.0;

/**
 * Map an internal Elo rating to its DUPR-style display value, clamped to
 * 2.0–8.0. The clamp only affects display — internal Elo stays unbounded.
 * @param {number} elo
 * @returns {number} DUPR value (caller formats, e.g. `.toFixed(3)`)
 */
export function eloToDupr(elo) {
  const dupr = DUPR_BASELINE + (elo - RATING_BASELINE) * DUPR_PER_ELO;
  return Math.max(DUPR_MIN, Math.min(DUPR_MAX, dupr));
}

/** Expected score (0–1) for a team rated `a` against a team rated `b`. */
function expectedScore(a, b) {
  return 1 / (1 + 10 ** ((b - a) / RATING_SCALE));
}

/**
 * Compute post-match Elo ratings for a finished doubles match. Each team's
 * rating is the average of its two players; both teammates share the team's
 * delta (standard team Elo — see the carrying-problem note in the README).
 *
 * @param {{team1:[number,number], team2:[number,number], outcome:0|1|2}} match
 *   `outcome`: 1 = team1 won, 2 = team2 won, 0 = tie.
 * @returns {{team1:[number,number], team2:[number,number]}} new integer ratings
 */
export function computeMatchRatings({ team1, team2, outcome }) {
  if (outcome !== 0 && outcome !== 1 && outcome !== 2) {
    // Reject invalid input rather than silently scoring it as a tie — a
    // regressed caller must fail loudly, not quietly corrupt persisted Elo.
    throw new RangeError('outcome must be 0 (tie), 1 (team1 win), or 2 (team2 win)');
  }

  const avg1 = (team1[0] + team1[1]) / 2;
  const avg2 = (team2[0] + team2[1]) / 2;
  const expected1 = expectedScore(avg1, avg2);
  const result1 = outcome === 1 ? 1 : outcome === 2 ? 0 : 0.5;
  // Zero-sum: team2's delta is the exact negative of team1's.
  const delta1 = Math.round(K_FACTOR * (result1 - expected1));
  return {
    team1: [team1[0] + delta1, team1[1] + delta1],
    team2: [team2[0] - delta1, team2[1] - delta1],
  };
}
