/**
 * Canonical fingerprint of an arena's board, used by offline sync to detect
 * divergence: the client stamps its pending log with the fingerprint of the
 * state it forked from, and `syncOfflineEvents` recomputes the same
 * fingerprint from the database under the queue lock. A mismatch means the
 * board (or the arena's play settings) changed while the device was away,
 * and the batch needs the manager's divergence decision instead of a silent
 * replay.
 *
 * Pure and shared verbatim by both sides, so the canonical form is the
 * contract. It hashes only what replay correctness depends on:
 *   - queue membership and RELATIVE order (positions, not raw `queueOrder`
 *     values: the server keeps gaps the client never sees);
 *   - per-player rotation/stat fields the engine reads or writes;
 *   - court status and slot assignments;
 *   - partnership counts (zero-count entries excluded: a cancel round-trip
 *     leaves explicit zeros client-side where the server may have no row);
 *   - the play settings the events were resolved under.
 *
 * Deliberately excluded: match history (its board effects already show in
 * players/queue), display names, `lastSessionResetAt`, and slot restore
 * snapshots (they can only change when slots change).
 */

/** 32-bit FNV-1a over a string; returned as 8-char zero-padded hex. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // hash *= 16777619, in 32-bit space via shifts (JS bitwise is 32-bit).
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const bit = (value) => (value ? 1 : 0);

/**
 * Build the canonical string for a board + settings. Exported for tests
 * (asserting WHAT is hashed, not just that hashes differ).
 *
 * @param {object} state - getState shape: { players, queue, courts, history }
 * @param {object} settings - { targetScore, starveThreshold, emergencyWait,
 *   skipRestoresPriority, skipPickReplacement, balancedPairing }
 */
export function canonicalBoardString(state, settings) {
  const players = [...state.players]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(
      (p) =>
        `${p.id}|${p.waitRounds}|${p.gamesPlayed}|${p.gamesOffset}|${p.wins}|${p.losses}|${p.rating}|${bit(p.skipBoosted)}`,
    )
    .join(';');

  const queue = state.queue.join(',');

  const courts = [...state.courts]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((c) => {
      const slots = [...(c.slots ?? [])]
        .sort((a, b) => (a.playerId < b.playerId ? -1 : 1))
        .map((s) => `${s.playerId}:${s.team}`)
        .join(',');
      return `${c.id}|${c.status}|${slots}`;
    })
    .join(';');

  // history is the symmetric matrix getState expands; reduce it back to
  // canonical (a<b) pairs and drop zero counts.
  const pairs = [];
  for (const [a, row] of Object.entries(state.history ?? {})) {
    for (const [b, count] of Object.entries(row)) {
      if (a < b && count > 0) pairs.push(`${a}~${b}=${count}`);
    }
  }
  const partnerships = pairs.sort().join(';');

  // `balancedPairing` belongs here: it changes which team split a fill picks,
  // so a device that ran a session under the old value produced a board the
  // server would not have produced. Absent (a snapshot predating the setting)
  // hashes as ON, matching the column default.
  const rules = `${settings.targetScore}|${settings.starveThreshold}|${settings.emergencyWait}|${bit(settings.skipRestoresPriority)}|${bit(settings.skipPickReplacement)}|${bit(settings.balancedPairing !== false)}`;

  return `p:${players}\nq:${queue}\nc:${courts}\nh:${partnerships}\ns:${rules}`;
}

/** Fingerprint = FNV-1a of the canonical board string. */
export function boardFingerprint(state, settings) {
  return fnv1a(canonicalBoardString(state, settings));
}
