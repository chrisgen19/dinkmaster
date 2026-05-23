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
 * Validate a pickleball match scoreline against the arena's target score.
 * Standard rules: the winner reaches the target, must win by 2, no ties; no
 * upper cap (deuce can extend to 12-10, 15-13, 21-19, etc.).
 *
 * Returns `{ ok, complete, reason }`. `complete` is true once both fields have
 * a digits-only value — the UI stays quiet while the organizer is still
 * typing, and only shows an error chip once both sides are filled in.
 */
export const validateMatchScore = (s1, s2, targetScore) => {
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
  if (winner - loser < 2) {
    return { ok: false, complete: true, reason: 'A game must be won by 2.' };
  }
  return { ok: true, complete: true, reason: '' };
};
