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
 * @param {object} state - getState shape: { players, queue, courts, history,
 *   lastDeckFilled }
 * @param {object} settings - { targetScore, winBy, starveThreshold,
 *   emergencyWait, skipRestoresPriority, skipPickReplacement, balancedPairing,
 *   splitDeckByResult }
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
  // server would not have produced.
  //
  // ON is encoded by ABSENCE, not by a sixth field. A pending log stamped
  // before this setting shipped carries a fingerprint STRING computed by the
  // old five-field code — it can't be recomputed, only matched. Appending a
  // field unconditionally would change the hash of every unchanged board, so
  // every offline session in flight across the deploy would report a phantom
  // divergence. Since the migration backfills every arena to ON, the default
  // must hash exactly as it did before, and only the opt-out adds `|0`.
  const legacyRules = `${settings.targetScore}|${settings.starveThreshold}|${settings.emergencyWait}|${bit(settings.skipRestoresPriority)}|${bit(settings.skipPickReplacement)}`;
  const withPairing = settings.balancedPairing === false ? `${legacyRules}|0` : legacyRules;

  // `splitDeckByResult` and the alternation pointer it drives both change WHICH
  // FOUR a fill stacks, so a device that ran a session under different values
  // produced a board the server would not have produced. Both are appended by
  // ABSENCE for the same reason `balancedPairing` is (see above) — but the
  // defaults are the other way around here: the mode ships OFF, so absence
  // encodes off and only an arena running decks adds anything. The `d`/`k`
  // prefixes keep the two unambiguous next to `balancedPairing`'s bare `|0`.
  //
  // The pointer is board state rather than a rule, but it belongs in the same
  // hash: replaying a batch that forked from "winners went last" onto a server
  // that says "losers went last" alternates the wrong way.
  const deckMode = settings.splitDeckByResult === true;
  const withDeck = deckMode
    ? `${withPairing}|d1${state.lastDeckFilled ? `|k${state.lastDeckFilled}` : ''}`
    : withPairing;

  // Organizer pins decide WHICH FOUR a deck stacks — they beat the natural
  // W/L split for their slot — so a device that forked from a differently
  // pinned board would replay a different court. Hashed here rather than as a
  // per-player field for the reason spelled out above: appending to the player
  // line would change the hash of every unchanged board and report a phantom
  // divergence for every offline session in flight across the deploy. Absence
  // encodes "nothing pinned", which is every pre-feature board.
  //
  // `locked` rides along because it decides whether a challenge exists at all,
  // and `resolveDeckChallenge` replays against that.
  const pins = deckMode
    ? [...state.players]
        .filter((p) => p.draftedDeck === 'W' || p.draftedDeck === 'L')
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((p) => `${p.id}:${p.draftedDeck}${bit(p.draftedLocked)}`)
    : [];
  const withPins = pins.length > 0 ? `${withDeck}|n${pins.join(',')}` : withDeck;

  // `winBy` decides which scorelines `applyEndMatch` accepts, so a device that
  // recorded 11-10 under sudden death forked from rules the server may no
  // longer be running — that must surface as divergence, not a silent replay
  // the server would then reject as BAD_EVENT.
  //
  // Appended by ABSENCE like `balancedPairing` and `splitDeckByResult` above:
  // the migration backfills every arena to 2, so the standard rule must hash
  // exactly as it did before this field shipped, or every offline session in
  // flight across the deploy reports a phantom divergence. Only sudden death
  // adds anything, and the `w` prefix keeps it unambiguous next to `|d1`/`|n`.
  const rules = settings.winBy === 1 ? `${withPins}|w1` : withPins;

  return `p:${players}\nq:${queue}\nc:${courts}\nh:${partnerships}\ns:${rules}`;
}

/** Fingerprint = FNV-1a of the canonical board string. */
export function boardFingerprint(state, settings) {
  return fnv1a(canonicalBoardString(state, settings));
}
