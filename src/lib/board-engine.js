import { ON_DECK_SIZE, bandOf } from '@/lib/matchmaking';
import { bestMatchups, rankMatchups, recentResults } from '@/lib/pairing';
import {
  DECK_LOSE,
  DECK_WIN,
  assembleDeck,
  bucketFor,
  deckChallenge,
  deckOf,
  nextDeck,
  pinnedIn,
  splitDecks,
} from '@/lib/decks';
import { RATING_BASELINE, computeMatchRatings } from '@/lib/rating';
import { validateMatchScore } from '@/lib/scoring';
import { diffLineup, validateLineup } from '@/lib/court-lineup';

/**
 * Pure, client-side board engine for offline session mode.
 *
 * Operates on the exact state shape `getState` returns (players, queue,
 * courts, matchHistory, history) and mirrors the server-side semantics in
 * `src/lib/board-apply.js`. Two entry points:
 *
 *   - `resolveCommand(state, settings, command, opts)`: turns a user action
 *     into an EVENT, resolving every nondeterministic choice (shuffles,
 *     tie-breaks) with the injectable `opts.rng`, then applies it. The event
 *     records the resolved outcome so the server replay reproduces the exact
 *     same board (see the plan's "commands with recorded outcomes" decision).
 *   - `applyEvent(state, settings, event)`: deterministically applies an
 *     already-resolved event. Used to rebuild local state from a pending
 *     event log (offline board boot) and mirrored server-side in Phase 3.
 *
 * The engine NEVER mutates its input state; every path returns fresh objects.
 * Local state produced here intentionally carries no `fetchedAt` stamp: it
 * must never compete with server snapshots in the freshness guard.
 *
 * Queue positions are implicit here (array index) while the server persists
 * explicit `queueOrder` values that may carry gaps. Relative order, which is
 * all the UI and the fairness rules consume, is identical.
 */

/** Commands the offline engine supports (everything else stays online-only). */
export const OFFLINE_COMMANDS = [
  'addPlayer',
  'checkIn',
  'checkOut',
  'shuffleQueue',
  'fillCourt',
  'cancelFill',
  'editCourtLineup',
  'endMatch',
  'skipPlayer',
  'pinToDeck',
  'unpinFromDeck',
  'resolveDeckChallenge',
];

// User-facing failure copy, kept identical to the messages the online server
// actions return so offline mode never invents new wording.
const MSG_NOT_ENOUGH = 'Need at least 4 players stacked in the queue to load a court!';
const MSG_COURT_CHANGED = 'The court or queue changed while loading. Please try again.';
const MSG_NOT_PLAYING = 'This court is no longer active — it was already finished or cancelled.';
// editCourtLineup uses its own NOT_PLAYING / INVALID_COURT / QUEUE_CHANGED copy.
const MSG_EDIT_NOT_PLAYING = 'This court is no longer active — it was finished or cancelled.';
const MSG_EDIT_INVALID = "This court is in an unexpected state and can't be edited — finish or cancel the match instead.";
const MSG_EDIT_QUEUE_CHANGED = 'A chosen player is no longer available — the rack changed. Please try again.';
const MSG_EDIT_INVALID_LINEUP = 'Pick exactly four different players, two per team.';
const MSG_REPLACEMENT_GONE = 'That replacement is no longer available. Pick again.';
const MSG_REPLACEMENT_ON_DECK = 'That player is already on deck — pick a waiting paddle.';
const MSG_PIN_INVALID = 'That paddle can no longer be added to this deck. Please try again.';

/** Retiring a pin always clears both columns. Mirrors `CLEAR_PIN` server-side. */
const CLEAR_PIN = { draftedDeck: null, draftedLocked: false };

/**
 * The organizer's deck pins, in the map `@/lib/decks` consumes. Read off the
 * player rows so an offline board assembles its decks exactly as the server
 * would, and a synced replay lands on the same four.
 */
function pinsOf(state) {
  const pins = new Map();
  for (const p of state.players ?? []) {
    if (p.draftedDeck === DECK_WIN || p.draftedDeck === DECK_LOSE) {
      pins.set(p.id, { deck: p.draftedDeck, locked: Boolean(p.draftedLocked) });
    }
  }
  return pins;
}

const defaultMakeId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

/** Unbiased Fisher-Yates shuffle driven by the injected rng (returns a new array). */
function shuffleWith(rng, items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const playerById = (state, id) => state.players.find((p) => p.id === id);

/** Return a new players array with `patch` merged into the matching player. */
function patchPlayers(players, patches) {
  return players.map((p) => (patches[p.id] ? { ...p, ...patches[p.id] } : p));
}

/** Group-average ordering metric, mirroring `groupAverageMetric` in board-apply. */
function groupAverage(players) {
  return players.length
    ? Math.round(players.reduce((sum, p) => sum + p.gamesPlayed + p.gamesOffset, 0) / players.length)
    : 0;
}

const pairCount = (history, a, b) => history[a]?.[b] ?? 0;

/** Symmetric partnership count adjustment, floored at zero. */
function adjustPair(history, a, b, delta) {
  const next = { ...history };
  const value = Math.max(0, pairCount(history, a, b) + delta);
  next[a] = { ...(next[a] ?? {}), [b]: value };
  next[b] = { ...(next[b] ?? {}), [a]: value };
  return next;
}

/** Whether the player currently occupies a slot on a playing court. */
function isOnPlayingCourt(state, playerId) {
  return state.courts.some(
    (c) => c.status === 'playing' && (c.team1.includes(playerId) || c.team2.includes(playerId)),
  );
}

// ---------------------------------------------------------------------------
// Per-event appliers. Each returns { state, changed } or { error }.
// ---------------------------------------------------------------------------

function applyAddPlayer(state, event) {
  const { playerId, firstName, lastName } = event.payload;
  if (playerById(state, playerId)) return { error: 'STATE_MISMATCH' };
  const player = {
    id: playerId,
    userId: null,
    firstName,
    lastName: lastName || null,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    waitRounds: 0,
    rating: RATING_BASELINE,
    skipBoosted: false,
    gamesOffset: groupAverage(state.players),
  };
  return {
    state: { ...state, players: [...state.players, player], queue: [...state.queue, playerId] },
    changed: true,
  };
}

function applyCheckIn(state, event) {
  const { playerId } = event.payload;
  const player = playerById(state, playerId);
  if (!player) return { state, changed: false };
  if (state.queue.includes(playerId)) return { state, changed: false };
  if (isOnPlayingCourt(state, playerId)) return { state, changed: false };
  const avg = groupAverage(state.players);
  return {
    state: {
      ...state,
      players: patchPlayers(state.players, {
        [playerId]: { waitRounds: 0, skipBoosted: false, gamesOffset: avg - player.gamesPlayed },
      }),
      queue: [...state.queue, playerId],
    },
    changed: true,
  };
}

function applyCheckOut(state, event) {
  const { playerId } = event.payload;
  if (!state.queue.includes(playerId)) return { state, changed: false };
  return {
    state: {
      ...state,
      players: patchPlayers(state.players, { [playerId]: { waitRounds: 0, skipBoosted: false } }),
      queue: state.queue.filter((id) => id !== playerId),
    },
    changed: true,
  };
}

function applyShuffleQueue(state, event) {
  const order = event.outcome?.order;
  if (state.queue.length < 2) return { state, changed: false };
  // The recorded order must be exactly the current queue's members.
  if (!order || !sameMembers(order, state.queue)) return { error: 'STATE_MISMATCH' };
  return { state: { ...state, queue: order }, changed: true };
}

function applyFillCourt(state, settings, event) {
  const { courtId } = event.payload;
  const outcome = event.outcome;
  const court = state.courts.find((c) => c.id === courtId);
  if (!court || court.status !== 'vacant') return { error: MSG_COURT_CHANGED };
  if (state.queue.length < 4) return { error: MSG_NOT_ENOUGH };

  // Mirrors `applyFillCourtTx`'s validation exactly. In deck mode the recorded
  // four came from the front of a deck, not the front of the rack, so they only
  // have to be four distinct paddles that are all still racked; classic mode
  // keeps the strict "must be the top four" check. A settings snapshot taken
  // before this feature has no flag at all — treat that as OFF, matching the
  // column default.
  const deckMode = settings?.splitDeckByResult === true;
  const filled = outcome?.players ?? [];
  const selectionValid = deckMode
    ? filled.length === 4 &&
      new Set(filled).size === 4 &&
      filled.every((id) => state.queue.includes(id))
    : sameMembers(filled, state.queue.slice(0, 4));
  // The recorded deck becomes `state.lastDeckFilled`, which drives the next
  // fill's alternation and is hashed into the sync fingerprint — so constrain
  // it to the documented domain here too, or a corrupted stored log quietly
  // poisons both. Server-side twin in `applyFillCourtTx`.
  const deckValid =
    outcome?.deck === undefined ||
    outcome?.deck === null ||
    outcome?.deck === DECK_WIN ||
    outcome?.deck === DECK_LOSE;
  if (
    !outcome ||
    !selectionValid ||
    !deckValid ||
    !sameMembers([...outcome.team1, ...outcome.team2], filled)
  ) {
    return { error: 'STATE_MISMATCH' };
  }

  const remaining = state.queue.filter((id) => !filled.includes(id));
  const patches = {};
  filled.forEach((id) => {
    const p = playerById(state, id);
    patches[id] = { gamesPlayed: p.gamesPlayed + 1, waitRounds: 0, skipBoosted: false };
    // Only touch the pin columns on a paddle that actually carries a pin, so
    // an unpinned board's player rows keep the exact shape they arrived with.
    if (p.draftedDeck) patches[id] = { ...patches[id], ...CLEAR_PIN };
  });
  remaining.forEach((id) => {
    const p = playerById(state, id);
    patches[id] = { waitRounds: p.waitRounds + 1 };
  });
  // Retire the stacked deck's remaining pins, and ONLY that deck's — the other
  // deck's placements are still unspent. Server twin in `applyFillCourtTx`.
  if (deckMode && outcome.deck) {
    remaining.forEach((id) => {
      if (playerById(state, id)?.draftedDeck === outcome.deck) {
        patches[id] = { ...patches[id], ...CLEAR_PIN };
      }
    });
  }

  // Slot snapshots let cancelFill restore the exact pre-fill rack state.
  const snapshotFor = (id) => ({
    prevQueueOrder: state.queue.indexOf(id) + 1,
    prevWaitRounds: playerById(state, id).waitRounds,
  });
  const slots = [
    ...outcome.team1.map((playerId) => ({ playerId, team: 1, ...snapshotFor(playerId) })),
    ...outcome.team2.map((playerId) => ({ playerId, team: 2, ...snapshotFor(playerId) })),
  ];

  let history = adjustPair(state.history, outcome.team1[0], outcome.team1[1], +1);
  history = adjustPair(history, outcome.team2[0], outcome.team2[1], +1);

  return {
    state: {
      ...state,
      players: patchPlayers(state.players, patches),
      queue: remaining,
      courts: state.courts.map((c) =>
        c.id === courtId
          ? {
              ...c,
              status: 'playing',
              team1: outcome.team1,
              team2: outcome.team2,
              fillBumpedPlayerIds: remaining,
              // Alternation pointer as it stood before this fill, so
              // `applyCancelFill` can rewind it — mirrors `Court.fillPrevDeck`.
              fillPrevDeck: state.lastDeckFilled ?? null,
              slots,
            }
          : c,
      ),
      // Advance the W -> L -> W alternation. Only in deck mode, so an arena
      // that isn't running decks never carries a stale pointer.
      ...(deckMode ? { lastDeckFilled: outcome.deck ?? null } : {}),
      history,
    },
    changed: true,
  };
}

function applyCancelFill(state, event) {
  const { courtId } = event.payload;
  const court = state.courts.find((c) => c.id === courtId);
  if (!court || court.status !== 'playing') return { error: MSG_NOT_PLAYING };
  const slots = court.slots ?? [];
  if (slots.length !== 4 || slots.some((s) => s.prevQueueOrder == null || s.prevWaitRounds == null)) {
    return { error: MSG_NOT_PLAYING };
  }

  const patches = {};
  // Reverse the fill's "+1 wait" for exactly the players it bumped that are
  // still waiting, mirroring the server's guarded decrement.
  (court.fillBumpedPlayerIds ?? []).forEach((id) => {
    const p = playerById(state, id);
    if (p && state.queue.includes(id) && p.waitRounds > 0) {
      patches[id] = { waitRounds: p.waitRounds - 1 };
    }
  });
  slots.forEach((s) => {
    const p = playerById(state, s.playerId);
    patches[s.playerId] = {
      waitRounds: s.prevWaitRounds,
      gamesPlayed: Math.max(0, p.gamesPlayed - 1),
    };
  });

  const restored = [...slots].sort((a, b) => a.prevQueueOrder - b.prevQueueOrder).map((s) => s.playerId);

  const team1 = slots.filter((s) => s.team === 1).map((s) => s.playerId);
  const team2 = slots.filter((s) => s.team === 2).map((s) => s.playerId);
  let history = state.history;
  if (team1.length === 2) history = adjustPair(history, team1[0], team1[1], -1);
  if (team2.length === 2) history = adjustPair(history, team2[0], team2[1], -1);

  return {
    state: {
      ...state,
      players: patchPlayers(state.players, patches),
      queue: [...restored, ...state.queue],
      courts: state.courts.map((c) =>
        c.id === courtId
          ? {
              ...c,
              status: 'vacant',
              team1: [],
              team2: [],
              fillBumpedPlayerIds: [],
              fillPrevDeck: null,
              slots: [],
            }
          : c,
      ),
      // Rewind the deck alternation to where the cancelled fill found it, so
      // an undone stack doesn't cost the other deck its turn (see
      // `applyCancelFillTx`).
      lastDeckFilled: court.fillPrevDeck ?? null,
      history,
    },
    changed: true,
  };
}

function applyEditCourtLineup(state, settings, event) {
  const { courtId, team1Ids, team2Ids } = event.payload;
  const court = state.courts.find((c) => c.id === courtId);
  if (!court || court.status !== 'playing') return { error: MSG_EDIT_NOT_PLAYING };

  const slots = court.slots ?? [];
  if (slots.length !== 4) return { error: MSG_EDIT_INVALID };
  const current = {
    team1: slots.filter((s) => s.team === 1).map((s) => s.playerId),
    team2: slots.filter((s) => s.team === 2).map((s) => s.playerId),
  };
  if (current.team1.length !== 2 || current.team2.length !== 2) return { error: MSG_EDIT_INVALID };

  const diff = diffLineup(current, { team1: team1Ids, team2: team2Ids });
  if (!diff.changed) return { state, changed: false };

  // Slot snapshots keyed by player id (mirrors applyEditCourtLineupTx): a
  // stayed player keeps their existing slot snapshot; an incoming player's is
  // built below so cancelFill can still restore them.
  const stayedSnap = new Map(
    slots.map((s) => [s.playerId, { prevQueueOrder: s.prevQueueOrder, prevWaitRounds: s.prevWaitRounds }]),
  );
  const incomingSnap = new Map();
  const patches = {};
  let queue = state.queue;
  let fillBumpedPlayerIds = court.fillBumpedPlayerIds ?? [];

  // An incoming waiter's `prevQueueOrder` must sort AFTER the players staying
  // on court, matching the server: `applyEditCourtLineupTx` records the
  // waiter's real (persisted) queueOrder, which is behind the on-court four
  // after a fresh fill. The offline queue is truncated (on-court players
  // aren't in it), so a raw 1-based index would collide with the slot range
  // and make a later cancelFill restore a different order than the server
  // replay does. Placing the waiter at maxSlot + 1 + (their queue index)
  // reproduces the server's exact value in the common fresh-fill case.
  //
  // KNOWN BOUNDED EDGE: the server's fillCourt leaves the rack gappy while any
  // edit renumbers it dense, and the array-based offline queue can't tell the
  // two apart. So a re-substitution before a cancel (sub a player out, then
  // back in, then cancelFill the court, all offline) can restore a different
  // rack ORDER than the server. It self-heals on sync (the authoritative state
  // is applied) and is inert for later actions (fills/end-matches validate by
  // set, and cancel returns the same four to the front either way). A fully
  // exact fix means modeling persisted queueOrder through the engine, which is
  // disproportionate to this contrived, self-healing case.
  const maxSlotOrder = Math.max(0, ...slots.map((s) => s.prevQueueOrder ?? 0));

  // Subbed-in players must be active, waiting in this arena, and not already
  // on any court. (added and removed are always equal length: four on court.)
  if (diff.added.length > 0) {
    for (const id of diff.added) {
      if (!state.queue.includes(id) || isOnPlayingCourt(state, id)) {
        return { error: MSG_EDIT_QUEUE_CHANGED };
      }
    }
    const bumpedSet = new Set(court.fillBumpedPlayerIds ?? []);
    for (const id of diff.added) {
      const p = playerById(state, id);
      // A subbed-in paddle the original fill bumped still carries that +1;
      // snapshot the pre-bump value so a later cancelFill restores it exactly.
      const prevWaitRounds = bumpedSet.has(id) ? Math.max(0, p.waitRounds - 1) : p.waitRounds;
      incomingSnap.set(id, {
        prevQueueOrder: maxSlotOrder + 1 + state.queue.indexOf(id),
        prevWaitRounds,
      });
      patches[id] = { gamesPlayed: p.gamesPlayed + 1, waitRounds: 0, skipBoosted: false };
    }
    const addedSet = new Set(diff.added);
    queue = queue.filter((id) => !addedSet.has(id));
    fillBumpedPlayerIds = fillBumpedPlayerIds.filter((id) => !addedSet.has(id));
  }

  // Subbed-out players: undo the game credit and return them to the FRONT of
  // the rack (queued waiters keep their order, so wait fairness is preserved).
  // Same skip-restores-priority toggle that governs skipPlayer.
  if (diff.removed.length > 0) {
    for (const id of diff.removed) {
      const p = playerById(state, id);
      const base = { gamesPlayed: Math.max(0, p.gamesPlayed - 1) };
      patches[id] = settings.skipRestoresPriority
        ? { ...base, waitRounds: stayedSnap.get(id)?.prevWaitRounds ?? 0, skipBoosted: true }
        : { ...base, waitRounds: 0, skipBoosted: false };
    }
    queue = [...diff.removed, ...queue];
  }

  const slotSnap = (id) => incomingSnap.get(id) ?? stayedSnap.get(id) ?? { prevQueueOrder: null, prevWaitRounds: null };
  const newSlots = [
    ...team1Ids.map((playerId) => ({ playerId, team: 1, ...slotSnap(playerId) })),
    ...team2Ids.map((playerId) => ({ playerId, team: 2, ...slotSnap(playerId) })),
  ];

  let history = state.history;
  for (const [x, y] of diff.pairsToUnbump) history = adjustPair(history, x, y, -1);
  for (const [x, y] of diff.pairsToBump) history = adjustPair(history, x, y, +1);

  return {
    state: {
      ...state,
      players: patchPlayers(state.players, patches),
      queue,
      courts: state.courts.map((c) =>
        c.id === courtId ? { ...c, team1: team1Ids, team2: team2Ids, fillBumpedPlayerIds, slots: newSlots } : c,
      ),
      history,
    },
    changed: true,
  };
}

function applyEndMatch(state, settings, event) {
  const { courtId, score1, score2, autoMix, matchId } = event.payload;
  const outcome = event.outcome ?? {};
  const court = state.courts.find((c) => c.id === courtId);
  if (!court || court.status !== 'playing') return { error: MSG_NOT_PLAYING };

  const check = validateMatchScore(score1, score2, settings.targetScore);
  if (!check.ok) return { error: check.reason || 'Both scores are required.' };
  const s1 = parseInt(score1, 10);
  const s2 = parseInt(score2, 10);
  const team1Won = s1 > s2;
  const team2Won = s2 > s1;

  const slots = court.slots ?? [];
  const slotIds = slots.map((s) => s.playerId);
  if (!outcome.recycleOrder || !sameMembers(outcome.recycleOrder, slotIds)) {
    return { error: 'STATE_MISMATCH' };
  }
  const team1 = slots.filter((s) => s.team === 1).map((s) => playerById(state, s.playerId));
  const team2 = slots.filter((s) => s.team === 2).map((s) => playerById(state, s.playerId));

  const nameOf = (p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName });
  const match = {
    id: matchId,
    courtName: court.name,
    team1: team1.map(nameOf),
    team2: team2.map(nameOf),
    score1: s1,
    score2: s2,
    // Mirrors what `applyEndMatchTx` persists on sync, so a match played
    // offline reads back with the target it was played under rather than
    // appearing to predate the column.
    targetScore: settings.targetScore,
    timestamp: event.occurredAt,
  };

  const patches = {};
  if (team1Won || team2Won) {
    const winners = team1Won ? team1 : team2;
    const losers = team1Won ? team2 : team1;
    winners.forEach((p) => (patches[p.id] = { ...(patches[p.id] ?? {}), wins: p.wins + 1 }));
    losers.forEach((p) => (patches[p.id] = { ...(patches[p.id] ?? {}), losses: p.losses + 1 }));
  }
  if (team1.length === 2 && team2.length === 2) {
    const next = computeMatchRatings({
      team1: [team1[0].rating, team1[1].rating],
      team2: [team2[0].rating, team2[1].rating],
      outcome: team1Won ? 1 : team2Won ? 2 : 0,
    });
    patches[team1[0].id] = { ...(patches[team1[0].id] ?? {}), rating: next.team1[0] };
    patches[team1[1].id] = { ...(patches[team1[1].id] ?? {}), rating: next.team1[1] };
    patches[team2[0].id] = { ...(patches[team2[0].id] ?? {}), rating: next.team2[0] };
    patches[team2[1].id] = { ...(patches[team2[1].id] ?? {}), rating: next.team2[1] };
  }

  let queue = [...state.queue, ...outcome.recycleOrder];
  let players = patchPlayers(state.players, patches);

  // Silo-Buster auto-mix, mirroring `applyAutoMixTx`: only when requested and
  // more than one court's worth of paddles are waiting after the recycle.
  let notification = '';
  if (autoMix && queue.length > 4) {
    if (!outcome.mixedOrder || !sameMembers(outcome.mixedOrder, queue)) {
      return { error: 'STATE_MISMATCH' };
    }
    queue = outcome.mixedOrder;
    players = players.map((p) => (queue.includes(p.id) && p.skipBoosted ? { ...p, skipBoosted: false } : p));
    notification = '⚡ Silo-Buster: Mixed the rack (longest-waiting up next) to keep matchups fresh and fair!';
  } else if (state.courts.some((c) => c.id !== courtId && c.status === 'playing')) {
    notification = '💡 Recommended: Wait for other courts to finish before stacking again, to allow a complete mix of player pools!';
  }

  return {
    state: {
      ...state,
      players,
      queue,
      courts: state.courts.map((c) =>
        c.id === courtId
          ? {
              ...c,
              status: 'vacant',
              team1: [],
              team2: [],
              fillBumpedPlayerIds: [],
              // A finished game does NOT rewind the deck alternation — that
              // turn was played. Just drop the cancel bookkeeping.
              fillPrevDeck: null,
              slots: [],
            }
          : c,
      ),
      matchHistory: [match, ...state.matchHistory],
    },
    changed: true,
    notification,
  };
}

/**
 * Each racked player's most recent result, scoped to the current session —
 * the same input `applyFillCourtTx` reads from the database. `matchHistory` is
 * newest-first and `applyEndMatch` prepends to it, so an offline session's own
 * games classify its players immediately.
 */
function sessionResults(state, ids) {
  const sessionStart = state.lastSessionResetAt ? Date.parse(state.lastSessionResetAt) : null;
  const recentMatches = (state.matchHistory ?? [])
    .filter((m) => sessionStart === null || Date.parse(m.timestamp) >= sessionStart)
    .map((m) => ({
      score1: m.score1,
      score2: m.score2,
      team1: m.team1.map((p) => p.id),
      team2: m.team2.map((p) => p.id),
    }));
  return recentResults(recentMatches, ids);
}

function applySkipPlayer(state, settings, event) {
  const { playerId, replacementId, isManager } = event.payload;
  const rack = state.queue;

  // In deck mode "on deck" means the front four of the paddle's OWN deck, and
  // the replacement must come from that same deck — promoting a loser into the
  // winners' game would defeat the mode. The classic rack is the single-bucket
  // case of the same rule. Mirrors `applySkipPlayerTx`.
  let bucket = rack;
  if (settings.splitDeckByResult === true) {
    const decks = splitDecks(rack, sessionResults(state, rack));
    bucket = bucketFor(deckOf(playerId, decks), decks);
  }

  const index = bucket.indexOf(playerId);
  if (index === -1 || index >= ON_DECK_SIZE || bucket.length <= ON_DECK_SIZE) {
    return { state, changed: false };
  }

  let replacementIdx = ON_DECK_SIZE; // auto: first waiting in this deck
  if (replacementId && isManager && settings.skipPickReplacement) {
    const idx = bucket.indexOf(replacementId);
    if (idx === -1) return { error: MSG_REPLACEMENT_GONE };
    if (idx < ON_DECK_SIZE) return { error: MSG_REPLACEMENT_ON_DECK };
    replacementIdx = idx;
  }

  if (settings.skipRestoresPriority) {
    const onDeckMinusSkipped = bucket.slice(0, ON_DECK_SIZE).filter((_, k) => k !== index);
    const replacement = bucket[replacementIdx];
    const waitingMinusReplacement = bucket.slice(ON_DECK_SIZE).filter((id) => id !== replacement);
    const reorderedBucket = [
      ...onDeckMinusSkipped,
      replacement,
      playerId,
      ...waitingMinusReplacement,
    ];
    // Write the bucket's new member order back into the rack positions it
    // already occupied, leaving the other deck's paddles exactly where they
    // are. In classic mode the bucket IS the rack, so this is a plain reorder.
    const reordered = [...rack];
    bucket.forEach((id, k) => {
      reordered[rack.indexOf(id)] = reorderedBucket[k];
    });
    return {
      state: {
        ...state,
        players: patchPlayers(state.players, { [playerId]: { skipBoosted: true } }),
        queue: reordered,
      },
      changed: true,
      notification: 'Marked Next in Line — top priority on the next mix.',
    };
  }

  // Legacy mode: replacement (if manually picked) takes the freed slot, the
  // skipped paddle goes to the back with wait fairness reset. The freed slot is
  // a RACK position, so resolve it from the rack rather than the bucket.
  const withoutSkipped = rack.filter((id) => id !== playerId);
  const isManualPick = replacementIdx !== ON_DECK_SIZE;
  let reordered;
  if (isManualPick) {
    const replacement = bucket[replacementIdx];
    const rest = withoutSkipped.filter((id) => id !== replacement);
    const freed = rack.indexOf(playerId);
    reordered = [...rest.slice(0, freed), replacement, ...rest.slice(freed), playerId];
  } else {
    reordered = [...withoutSkipped, playerId];
  }
  return {
    state: {
      ...state,
      players: patchPlayers(state.players, {
        [playerId]: { waitRounds: 0, skipBoosted: false },
      }),
      queue: reordered,
    },
    changed: true,
    notification: 'Paddle sent to the back of the rack.',
  };
}

/** Set equality for id arrays (order-insensitive, duplicates rejected). */
function sameMembers(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === a.length && b.every((id) => set.has(id));
}

// ---------------------------------------------------------------------------
/**
 * Pin a racked paddle into a short win/lose deck. Deterministic, so the event
 * carries no outcome; validated here exactly as `applyPinToDeckTx` validates
 * it server-side, so a replayed batch reaches the same board.
 */
function applyPinToDeck(state, settings, event) {
  const { playerId, deck } = event.payload;
  if (settings?.splitDeckByResult !== true) return { error: MSG_PIN_INVALID };
  if (deck !== DECK_WIN && deck !== DECK_LOSE) return { error: MSG_PIN_INVALID };
  if (!state.queue.includes(playerId)) return { error: MSG_PIN_INVALID };

  const pins = pinsOf(state);
  const decks = splitDecks(state.queue, sessionResults(state, state.queue));
  const onDeck = new Set([
    ...assembleDeck(DECK_WIN, state.queue, decks, pins).four,
    ...assembleDeck(DECK_LOSE, state.queue, decks, pins).four,
  ]);
  if (onDeck.has(playerId)) return { error: MSG_PIN_INVALID };
  if (assembleDeck(deck, state.queue, decks, pins).four.length >= ON_DECK_SIZE) {
    return { error: MSG_PIN_INVALID };
  }

  return {
    state: {
      ...state,
      players: patchPlayers(state.players, {
        [playerId]: { draftedDeck: deck, draftedLocked: false },
      }),
    },
    changed: true,
  };
}

/** Take a hand-placed paddle back out of its deck. Always legal, idempotent. */
function applyUnpinFromDeck(state, event) {
  const { playerId } = event.payload;
  if (!playerById(state, playerId)?.draftedDeck) return { state, changed: false };
  return {
    state: { ...state, players: patchPlayers(state.players, { [playerId]: { ...CLEAR_PIN } }) },
    changed: true,
  };
}

/**
 * Answer the pin-vs-winner contest: `yieldIds` are unpinned, everything still
 * pinned in that deck is locked so the question isn't re-asked. Mirrors
 * `applyResolveDeckChallengeTx`.
 */
function applyResolveDeckChallenge(state, settings, event) {
  const { deck, yieldIds } = event.payload;
  if (settings?.splitDeckByResult !== true) return { state, changed: false };
  const ids = Array.isArray(yieldIds) ? yieldIds : [];

  const pins = pinsOf(state);
  const decks = splitDecks(state.queue, sessionResults(state, state.queue));
  const challenge = deckChallenge(deck, state.queue, decks, pins);
  // A stale answer is dropped rather than errored: the contest it referred to
  // is already gone, so there is nothing left to get wrong.
  if (!challenge) return { state, changed: false };
  const offered = new Set(challenge.pins);
  if (ids.length > challenge.challengers.length || !ids.every((id) => offered.has(id))) {
    return { state, changed: false };
  }

  const patches = {};
  for (const id of ids) patches[id] = { ...CLEAR_PIN };
  for (const id of pinnedIn(deck, state.queue, pins)) {
    if (!ids.includes(id)) patches[id] = { draftedLocked: true };
  }
  return { state: { ...state, players: patchPlayers(state.players, patches) }, changed: true };
}

// Public API
// ---------------------------------------------------------------------------

/**
 * Deterministically apply an already-resolved event to local state.
 *
 * @param {object} state - extended getState shape (never mutated)
 * @param {object} settings - { targetScore, starveThreshold, emergencyWait,
 *   skipRestoresPriority, skipPickReplacement }
 * @param {object} event - { id, type, occurredAt, payload, outcome }
 * @returns {{state: object, changed: boolean, notification?: string} | {error: string}}
 */
export function applyEvent(state, settings, event) {
  switch (event.type) {
    case 'addPlayer':
      return applyAddPlayer(state, event);
    case 'checkIn':
      return applyCheckIn(state, event);
    case 'checkOut':
      return applyCheckOut(state, event);
    case 'shuffleQueue':
      return applyShuffleQueue(state, event);
    case 'fillCourt':
      return applyFillCourt(state, settings, event);
    case 'cancelFill':
      return applyCancelFill(state, event);
    case 'editCourtLineup':
      return applyEditCourtLineup(state, settings, event);
    case 'endMatch':
      return applyEndMatch(state, settings, event);
    case 'skipPlayer':
      return applySkipPlayer(state, settings, event);
    case 'pinToDeck':
      return applyPinToDeck(state, settings, event);
    case 'unpinFromDeck':
      return applyUnpinFromDeck(state, event);
    case 'resolveDeckChallenge':
      return applyResolveDeckChallenge(state, settings, event);
    default:
      return { error: `Unknown offline event type: ${event.type}` };
  }
}

/**
 * Resolve a user command into a recorded event and apply it.
 *
 * Nondeterministic choices (shuffle orders, matchup tie-breaks, auto-mix
 * tie-breaks) are made HERE, once, with `opts.rng`, and written into the
 * event's `outcome` so both the local pending-log replay and the Phase 3
 * server sync reproduce the identical board.
 *
 * @param {object} state - extended getState shape (never mutated)
 * @param {object} settings - see {@link applyEvent}
 * @param {object} command - { type, ...payload } (see OFFLINE_COMMANDS)
 * @param {object} [opts]
 * @param {() => number} [opts.rng] - random source, injectable for tests
 * @param {() => string} [opts.now] - ISO timestamp source
 * @param {(prefix: string) => string} [opts.makeId] - id factory
 * @returns {{event: object|null, state: object, notification?: string} | {error: string}}
 *   `event: null` means the command was a clean no-op (nothing to record).
 */
export function resolveCommand(state, settings, command, opts = {}) {
  const { rng = Math.random, now = () => new Date().toISOString(), makeId = defaultMakeId } = opts;
  const base = { id: makeId('evt'), type: command.type, occurredAt: now() };

  let event;
  switch (command.type) {
    case 'addPlayer': {
      const firstName = (command.firstName ?? '').trim();
      const lastName = (command.lastName ?? '').trim();
      if (firstName.length === 0) return { event: null, state };
      if (firstName.length > 60 || lastName.length > 60) {
        return { error: 'Player name is too long (max 60 characters).' };
      }
      event = { ...base, payload: { playerId: makeId('off'), firstName, lastName }, outcome: null };
      break;
    }
    case 'checkIn':
    case 'checkOut':
      event = { ...base, payload: { playerId: command.playerId }, outcome: null };
      break;
    case 'shuffleQueue': {
      if (state.queue.length < 2) return { event: null, state };
      event = { ...base, payload: {}, outcome: { order: shuffleWith(rng, state.queue) } };
      break;
    }
    case 'fillCourt': {
      const court = state.courts.find((c) => c.id === command.courtId);
      if (!court || court.status !== 'vacant') return { error: MSG_COURT_CHANGED };
      if (state.queue.length < 4) return { error: MSG_NOT_ENOUGH };
      // Same ranking as the server's `applyFillCourtTx`: recent losers partner
      // recent winners, then closer-rated, then fewest repeat partnerships —
      // or, when the arena has opted out, fewest repeats alone.
      // `state.matchHistory` is newest-first and is updated by `applyEndMatch`,
      // so consecutive offline fills see results from this session's own games.
      // A settings snapshot captured before this feature has no flag at all;
      // treat that as ON, matching the column default.
      const balanced = settings.balancedPairing !== false;
      // Deck mode defaults OFF for a pre-feature snapshot, matching ITS column
      // default (opt-in, unlike balancedPairing).
      const deckMode = settings.splitDeckByResult === true;
      // Session-scoped, mirroring `applyFillCourtTx`: a reset keeps match rows
      // but starts the split's inputs fresh, so results from a previous
      // session must not classify tonight's arrivals. Matches recorded during
      // this offline session are stamped after the boundary and still count.
      // One results map serves both the deck split and the team split, exactly
      // as on the server.
      const results = sessionResults(state, state.queue);
      // A hand-topped deck names its own four (see `applyFillCourtTx`'s
      // `manual`): validated the same way, and the rotation still advances as
      // if that deck took its turn. Deck mode only.
      const manual =
        deckMode &&
        Array.isArray(command.manualPlayers) &&
        command.manualPlayers.length === 4 &&
        new Set(command.manualPlayers).size === 4 &&
        command.manualPlayers.every((id) => state.queue.includes(id)) &&
        (command.manualDeck === DECK_WIN || command.manualDeck === DECK_LOSE)
          ? { deck: command.manualDeck, players: command.manualPlayers }
          : null;
      // Otherwise deck mode draws from the front of the winners or losers deck,
      // alternating; classic mode takes the rack's top four.
      const picked =
        manual ??
        (deckMode
          ? nextDeck(state.queue, results, state.lastDeckFilled ?? null, pinsOf(state))
          : { deck: null, players: state.queue.slice(0, 4) });
      const filled = picked.players;
      const ranked = rankMatchups(filled, {
        results,
        ratings: new Map(state.players.map((p) => [p.id, p.rating])),
        pairCount: (a, b) => pairCount(state.history, a, b),
        balanced,
      });
      const best = shuffleWith(rng, bestMatchups(ranked))[0];
      event = {
        ...base,
        payload: { courtId: command.courtId },
        // `deck` rides along so a synced replay lands the server's alternation
        // pointer on exactly the value this device chose.
        outcome: { players: filled, team1: best.team1, team2: best.team2, deck: picked.deck },
      };
      break;
    }
    case 'cancelFill':
      event = { ...base, payload: { courtId: command.courtId }, outcome: null };
      break;
    case 'editCourtLineup': {
      // Deterministic (the manager picks the exact teams), so no outcome to
      // record. Validate the lineup up front, mirroring the server action.
      if (!validateLineup(command.team1Ids, command.team2Ids).ok) {
        return { error: MSG_EDIT_INVALID_LINEUP };
      }
      event = {
        ...base,
        payload: { courtId: command.courtId, team1Ids: command.team1Ids, team2Ids: command.team2Ids },
        outcome: null,
      };
      break;
    }
    case 'endMatch': {
      const court = state.courts.find((c) => c.id === command.courtId);
      if (!court || court.status !== 'playing') return { error: MSG_NOT_PLAYING };
      const recycleOrder = shuffleWith(rng, (court.slots ?? []).map((s) => s.playerId));
      const queueAfter = [...state.queue, ...recycleOrder];
      // Resolve the auto-mix order against the post-recycle rack. waitRounds,
      // games and boosts are untouched by the finish itself, so the pre-event
      // player rows are the correct sort inputs (matching applyAutoMixTx).
      let mixedOrder = null;
      if (command.autoMix && queueAfter.length > 4) {
        mixedOrder = queueAfter
          .map((id) => {
            const p = playerById(state, id);
            return {
              id,
              band: bandOf(p.waitRounds, {
                starveThreshold: settings.starveThreshold,
                emergencyWait: settings.emergencyWait,
                skipBoosted: p.skipBoosted && settings.skipRestoresPriority,
              }),
              waitRounds: p.waitRounds,
              games: p.gamesPlayed + p.gamesOffset,
              rand: rng(),
            };
          })
          .sort((a, b) => {
            if (a.band !== b.band) return b.band - a.band;
            if ((a.band === 3 || a.band === 2) && a.waitRounds !== b.waitRounds) return b.waitRounds - a.waitRounds;
            if (a.games !== b.games) return a.games - b.games;
            return a.rand - b.rand;
          })
          .map((p) => p.id);
      }
      event = {
        ...base,
        payload: {
          courtId: command.courtId,
          score1: command.score1,
          score2: command.score2,
          autoMix: Boolean(command.autoMix),
          matchId: makeId('off_match'),
        },
        outcome: { recycleOrder, mixedOrder },
      };
      break;
    }
    case 'skipPlayer':
      event = {
        ...base,
        payload: {
          playerId: command.playerId,
          replacementId: command.replacementId ?? null,
          isManager: Boolean(command.isManager),
        },
        outcome: null,
      };
      break;
    // The three deck-pin commands are fully deterministic — the organizer names
    // the paddle and the deck — so none of them records an outcome.
    case 'pinToDeck':
      event = {
        ...base,
        payload: { playerId: command.playerId, deck: command.deck },
        outcome: null,
      };
      break;
    case 'unpinFromDeck':
      event = { ...base, payload: { playerId: command.playerId }, outcome: null };
      break;
    case 'resolveDeckChallenge':
      event = {
        ...base,
        payload: { deck: command.deck, yieldIds: command.yieldIds ?? [] },
        outcome: null,
      };
      break;
    default:
      return { error: `Unknown offline command type: ${command.type}` };
  }

  const result = applyEvent(state, settings, event);
  if (result.error) return { error: result.error };
  if (!result.changed) return { event: null, state };
  return { event, state: result.state, notification: result.notification ?? '' };
}
