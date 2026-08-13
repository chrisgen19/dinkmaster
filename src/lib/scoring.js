// Pure validation helpers for pickleball score entry. Used by the score-entry
// modal (`src/app/arena.js`) AND the server action that records a finished
// match (`endMatch` in `src/app/actions.js`), so client and server never
// disagree about what counts as a legal scoreline.

/** True if `s` is a non-empty digits-only value — i.e. a valid score input. */
export const isValidScoreInput = (s) => {
  const t = String(s).trim();
  return t.length > 0 && /^\d+$/.test(t);
};

/** Step a score string by `delta`, clamping at 0. Empty/invalid becomes 0 first. */
export const stepScore = (current, delta) => {
  const n = parseInt(current, 10);
  const base = Number.isNaN(n) ? 0 : n;
  return String(Math.max(0, base + delta));
};

/**
 * Validate a match scoreline against the arena's target score and win-by
 * margin. Two formats, selected by `winBy`:
 *
 *   - `winBy: 2` (default, standard pickleball) — the winner reaches the
 *     target and leads by two, with NO upper cap, so deuce can extend
 *     indefinitely: 12-10, 15-13, 21-19, 99-97.
 *   - `winBy: 1` (sudden death / no deuce) — reaching the target wins
 *     outright, so 11-10 is a legal final. Because play stops the instant the
 *     target is reached, the winner lands on it EXACTLY: 12-3 at a target of
 *     11 is unreachable, and is rejected as a typo rather than accepted as a
 *     score no one could have played.
 *
 * Ties are illegal in both formats. `winBy` defaults to 2 so a caller that
 * predates the setting keeps standard behaviour.
 *
 * Returns `{ ok, complete, reason }`. `complete` is true once both fields have
 * a digits-only value — the UI stays quiet while the organizer is still
 * typing, and only shows an error chip once both sides are filled in.
 */
export const validateMatchScore = (s1, s2, targetScore, winBy = 2) => {
  if (!isValidScoreInput(s1) || !isValidScoreInput(s2)) {
    return { ok: false, complete: false, reason: '' };
  }
  const n1 = parseInt(s1, 10);
  const n2 = parseInt(s2, 10);
  if (n1 === n2) {
    return { ok: false, complete: true, reason: "Pickleball games can't end in a tie." };
  }
  const winner = Math.max(n1, n2);
  const loser = Math.min(n1, n2);
  if (winner < targetScore) {
    return { ok: false, complete: true, reason: `Winner must reach ${targetScore}.` };
  }
  // Sudden death has an exact winning score, since the game ends on the point
  // that reaches the target. Checked before the margin test below, which can
  // never fire at `winBy: 1` (a non-tie always leads by at least one).
  if (winner > targetScore && winBy < 2) {
    return { ok: false, complete: true, reason: `Sudden death ends at ${targetScore} — the winner can't score more.` };
  }
  if (winner - loser < winBy) {
    return { ok: false, complete: true, reason: `A game must be won by ${winBy}.` };
  }
  return { ok: true, complete: true, reason: '' };
};
