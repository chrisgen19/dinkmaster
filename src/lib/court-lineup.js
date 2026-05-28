// Pure helpers for the manual team editor (see `editCourtLineup` in
// `src/app/actions.js` and `CourtEditModal` in `src/app/court-edit-modal.js`).
// Kept Prisma-free so the lineup math can be unit-tested in isolation, mirroring
// the `matchmaking.js` / `matchmaking.test.js` split.

/** Canonical (sorted) pair key so each partnership maps to exactly one string.
 *  Matches the ordering rule used by `canonicalPair` in `app/actions.js`. */
export function pairKey(x, y) {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/**
 * Validate a desired court lineup: exactly four distinct player ids split two
 * per team. Returns `{ ok: true }` or `{ ok: false, reason }` with a stable
 * machine-readable reason the server action maps to a user-facing message.
 *
 * @param {string[]} team1Ids
 * @param {string[]} team2Ids
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateLineup(team1Ids, team2Ids) {
  if (!Array.isArray(team1Ids) || !Array.isArray(team2Ids)) {
    return { ok: false, reason: 'NOT_ARRAYS' };
  }
  if (team1Ids.length !== 2 || team2Ids.length !== 2) {
    return { ok: false, reason: 'WRONG_TEAM_SIZE' };
  }
  const all = [...team1Ids, ...team2Ids];
  if (all.some((id) => typeof id !== 'string' || id.length === 0)) {
    return { ok: false, reason: 'BAD_ID' };
  }
  if (new Set(all).size !== 4) {
    return { ok: false, reason: 'DUPLICATE_PLAYER' };
  }
  return { ok: true };
}

/**
 * Diff a court's current lineup against the desired one. Drives the server
 * action's bookkeeping: `added`/`removed` are the substituted players, and the
 * partnership lists are a strict DELTA (only pairs that actually changed) — a
 * blind unbump+rebump of an unchanged pair could net +1, since `unbumpPartnership`
 * floors at 0.
 *
 * @param {{team1: string[], team2: string[]}} current - lineup read from CourtSlots
 * @param {{team1: string[], team2: string[]}} next - desired lineup
 * @returns {{
 *   added: string[],
 *   removed: string[],
 *   pairsToBump: Array<[string, string]>,
 *   pairsToUnbump: Array<[string, string]>,
 *   changed: boolean,
 * }}
 */
export function diffLineup(current, next) {
  const currentIds = new Set([...current.team1, ...current.team2]);
  const nextIds = new Set([...next.team1, ...next.team2]);
  // Which team number each id sits on, so a pure side swap (Team A ↔ Team B
  // with the same partnerships) still counts as a change — the team number
  // drives score1/score2 attribution in the score modal.
  const teamOf = (lineup) =>
    new Map([...lineup.team1.map((id) => [id, 1]), ...lineup.team2.map((id) => [id, 2])]);
  const currentTeam = teamOf(current);
  const nextTeam = teamOf(next);

  const added = [...nextIds].filter((id) => !currentIds.has(id));
  const removed = [...currentIds].filter((id) => !nextIds.has(id));

  // A retained player whose team number flipped (without their partnership
  // changing) — e.g. both teams swapped wholesale.
  const teamSideChanged = [...nextIds].some(
    (id) => currentIds.has(id) && currentTeam.get(id) !== nextTeam.get(id),
  );

  // Build pair maps keyed canonically so a swap (same two players, opposite
  // order) is recognised as unchanged.
  const currentPairs = new Map([toPair(current.team1), toPair(current.team2)]);
  const nextPairs = new Map([toPair(next.team1), toPair(next.team2)]);

  const pairsToBump = [];
  for (const [key, pair] of nextPairs) {
    if (!currentPairs.has(key)) pairsToBump.push(pair);
  }
  const pairsToUnbump = [];
  for (const [key, pair] of currentPairs) {
    if (!nextPairs.has(key)) pairsToUnbump.push(pair);
  }

  return {
    added,
    removed,
    pairsToBump,
    pairsToUnbump,
    changed:
      added.length > 0 ||
      removed.length > 0 ||
      pairsToBump.length > 0 ||
      teamSideChanged,
  };
}

/** `[key, [a, b]]` entry for a team's two-player pair, canonically ordered. */
function toPair(team) {
  const [x, y] = team;
  const pair = x < y ? [x, y] : [y, x];
  return [pairKey(x, y), pair];
}
