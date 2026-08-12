import { ON_DECK_SIZE, bandOf } from '@/lib/matchmaking';
import { RECENT_MATCH_WINDOW, bestMatchups, rankMatchups, recentResults } from '@/lib/pairing';
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
import { computeMatchRatings } from '@/lib/rating';
import { validateMatchScore } from '@/lib/scoring';
import { diffLineup, validateLineup } from '@/lib/court-lineup';

/**
 * Board mutation appliers: the transaction bodies of the arena's rack/court
 * actions, extracted from `src/app/actions.js` so the same logic can serve two
 * callers:
 *
 *   - the online server actions (which wrap each applier in
 *     `prisma.$transaction` + `lockQueue` exactly as before), and
 *   - the offline sync replay (Phase 3), which applies a recorded event log
 *     inside ONE transaction.
 *
 * Every function takes the transaction client `tx` as its first argument and
 * never imports Prisma itself. Where a mutation makes a nondeterministic
 * choice (`Math.random()` via {@link shuffle}), it accepts an optional
 * pre-resolved `outcome` so a replayed offline event reproduces the exact
 * choice the offline device made; when `outcome` is absent the behavior is
 * byte-for-byte the original random pick.
 *
 * Typed failures are thrown as `Error(CODE)` (e.g. `COURT_UNAVAILABLE`,
 * `NOT_ENOUGH`) and mapped to user-facing messages by the calling action,
 * unchanged from the pre-extraction code.
 */

/** Canonical (sorted) pair so each partnership has exactly one row. */
export function canonicalPair(x, y) {
  return x < y ? [x, y] : [y, x];
}

/** Increment the partnership count for a pair, creating the row if absent. */
export async function bumpPartnership(tx, arenaId, x, y) {
  const [playerA, playerB] = canonicalPair(x, y);
  await tx.partnership.upsert({
    where: { playerA_playerB: { playerA, playerB } },
    create: { arenaId, playerA, playerB, count: 1 },
    update: { count: { increment: 1 } },
  });
}

/** Decrement a partnership count (floored at 0); no-op if the row is absent. Reverses {@link bumpPartnership}. */
export async function unbumpPartnership(tx, x, y) {
  const [playerA, playerB] = canonicalPair(x, y);
  await tx.partnership.updateMany({
    where: { playerA, playerB, count: { gt: 0 } },
    data: { count: { decrement: 1 } },
  });
}

/**
 * This session's recent matches, normalized into the shape `src/lib/pairing.js`
 * and `src/lib/decks.js` consume (newest first, capped at the recent window).
 *
 * Scoped to the current session: `prepareNextSession` keeps Match rows but
 * wipes `Partnership` so a fill "starts the new session unbiased by last week's
 * pairings" — the same reasoning applies to the OTHER input to that split, and
 * to which deck a player lands in. Without the cutoff, the first fills of a new
 * session would classify tonight's arrivals off results from a week ago. The
 * offline engine applies the same cutoff (see `board-engine.js`); match history
 * is not part of the sync fingerprint, so a one-sided change here would
 * silently diverge the two paths.
 *
 * The `id` tie-break matters for the same reason it does in `getState`: rows
 * synced from an older offline batch can share a `createdAt`. `recentResults`
 * keeps each player's FIRST hit walking newest-first, so on tied rows a
 * different order can yield a different W/L — and therefore a different deck
 * from the one the client displayed, rejecting its `expected` four. The client
 * reads `getState`'s ordering and the offline engine reads the same array, so
 * this query is the only one of the three that could disagree.
 */
async function sessionRecentMatches(tx, arenaId, lastSessionResetAt) {
  const recent = await tx.match.findMany({
    where: {
      arenaId,
      ...(lastSessionResetAt ? { createdAt: { gte: lastSessionResetAt } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: RECENT_MATCH_WINDOW,
    select: { score1: true, score2: true, players: { select: { playerId: true, team: true } } },
  });
  return recent.map((m) => ({
    score1: m.score1,
    score2: m.score2,
    team1: m.players.filter((mp) => mp.team === 1).map((mp) => mp.playerId),
    team2: m.players.filter((mp) => mp.team === 2).map((mp) => mp.playerId),
  }));
}

/** Highest queueOrder currently assigned to an active player, or 0 if the rack is empty. */
export async function maxQueueOrder(tx, arenaId) {
  const top = await tx.player.aggregate({
    where: { arenaId, leftAt: null },
    _max: { queueOrder: true },
  });
  return top._max.queueOrder ?? 0;
}

// App-wide key for a transaction-scoped Postgres advisory lock. Every
// transaction that assigns queueOrder positions takes this lock first, so
// concurrent finishes/adds/shuffles are serialized and can never read the
// same maxQueueOrder and write duplicate positions. The lock is keyed per
// arena (second key) so unrelated arenas never block each other. Released
// on commit/rollback.
const QUEUE_LOCK_KEY = 920425;
export function lockQueue(tx, arenaId) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUEUE_LOCK_KEY}, hashtext(${arenaId}))`;
}

/**
 * Set equality for id arrays (order-insensitive, duplicates rejected). Used
 * to validate recorded offline outcomes: a replayed ordering may only
 * REORDER the members the live transaction sees, never add or drop any.
 */
function sameMembers(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === a.length && b.every((id) => set.has(id));
}

/** Unbiased Fisher-Yates shuffle (returns a new array). */
export function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * The current group's average ordering metric (gamesPlayed + gamesOffset over
 * active players), used to slot a joiner in as a peer rather than giving them a
 * catch-up advantage for games they weren't here for.
 */
export async function groupAverageMetric(tx, arenaId) {
  const active = await tx.player.findMany({
    where: { arenaId, leftAt: null },
    select: { gamesPlayed: true, gamesOffset: true },
  });
  return active.length
    ? Math.round(active.reduce((sum, p) => sum + p.gamesPlayed + p.gamesOffset, 0) / active.length)
    : 0;
}

/**
 * Create a player on an arena's rack inside a transaction: credit the current
 * group-average `gamesOffset` (so a latecomer rotates as a peer, not catch-up)
 * and append them to the bottom of the queue. The caller must hold `lockQueue`.
 */
export async function addArenaPlayer(tx, arenaId, { id, userId = null, firstName, lastName }) {
  const gamesOffset = await groupAverageMetric(tx, arenaId);
  const order = (await maxQueueOrder(tx, arenaId)) + 1;
  return tx.player.create({
    data: {
      // Offline replay supplies the client-generated `off_...` id so events
      // recorded after the add (check-ins, fills, match snapshots) resolve
      // to the same row; online creation keeps the cuid() default.
      ...(id ? { id } : {}),
      arenaId,
      userId,
      firstName,
      lastName: lastName || null,
      queueOrder: order,
      gamesOffset,
    },
  });
}

/**
 * Retiring a deck pin always clears BOTH columns. A lock without a pin is
 * state the `Player_draftedLocked_requires_deck_chk` constraint refuses, and
 * would otherwise silently suppress the next organizer's first challenge.
 */
const CLEAR_PIN = { draftedDeck: null, draftedLocked: false };

/**
 * Read an arena's deck pins as the map `src/lib/decks.js` consumes.
 *
 * Reads under whatever lock the caller holds, so a pin written by a concurrent
 * request can't land between the rack read and the deck assembly.
 *
 * @returns {Promise<Map<string, {deck:'W'|'L', locked:boolean}>>}
 */
export async function readDeckPins(tx, arenaId) {
  const rows = await tx.player.findMany({
    where: { arenaId, leftAt: null, draftedDeck: { not: null } },
    select: { id: true, draftedDeck: true, draftedLocked: true },
  });
  return new Map(rows.map((r) => [r.id, { deck: r.draftedDeck, locked: r.draftedLocked }]));
}

/**
 * Pin a racked paddle into one of the win/lose decks, so a deck short of four
 * can still send a court out.
 *
 * Refuses (`PIN_INVALID`) rather than silently no-op'ing when the paddle isn't
 * racked or the deck is already at four, because both mean the organizer was
 * looking at a board that has since moved and their tap would land somewhere
 * they didn't intend. The pool the picker offers is WAITING paddles only —
 * topping up a short deck must not break a group that was ready to play to
 * patch one that wasn't — and that is re-derived here rather than trusted.
 *
 * @param {object} opts
 * @param {string} opts.playerId
 * @param {'W'|'L'} opts.deck
 */
export async function applyPinToDeckTx(tx, arenaId, { playerId, deck }) {
  if (deck !== DECK_WIN && deck !== DECK_LOSE) throw new Error('PIN_INVALID');

  const arena = await tx.arena.findUnique({
    where: { id: arenaId },
    select: { splitDeckByResult: true, lastSessionResetAt: true },
  });
  if (!arena?.splitDeckByResult) throw new Error('PIN_INVALID');

  const queued = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    orderBy: { queueOrder: 'asc' },
    select: { id: true },
  });
  const rack = queued.map((p) => p.id);
  if (!rack.includes(playerId)) throw new Error('PIN_INVALID');

  const pins = await readDeckPins(tx, arenaId);
  const decks = splitDecks(
    rack,
    recentResults(await sessionRecentMatches(tx, arenaId, arena.lastSessionResetAt), rack),
  );

  // Already on deck somewhere — either deck's four — means there is nothing to
  // top up with this paddle.
  const onDeck = new Set([
    ...assembleDeck(DECK_WIN, rack, decks, pins).four,
    ...assembleDeck(DECK_LOSE, rack, decks, pins).four,
  ]);
  if (onDeck.has(playerId)) throw new Error('PIN_INVALID');
  if (assembleDeck(deck, rack, decks, pins).four.length >= ON_DECK_SIZE) {
    throw new Error('PIN_INVALID');
  }

  // A fresh pin is never locked: the organizer hasn't been asked anything yet.
  await tx.player.updateMany({
    where: { id: playerId, arenaId, leftAt: null },
    data: { draftedDeck: deck, draftedLocked: false },
  });
}

/**
 * Take a hand-placed paddle back out of its deck. Idempotent, and needs no
 * validation beyond arena scope: removing a pin can only ever return the board
 * to its natural derivation, which is always a legal state.
 */
export async function applyUnpinFromDeckTx(tx, arenaId, { playerId }) {
  await tx.player.updateMany({
    where: { id: playerId, arenaId, leftAt: null, draftedDeck: { not: null } },
    data: CLEAR_PIN,
  });
}

/**
 * Answer the contest between a deck's pins and the natural members those pins
 * displaced (see `deckChallenge` in src/lib/decks.js).
 *
 * `yieldIds` are the pins the organizer gave up; they are unpinned and the
 * challengers take those slots by ordinary derivation. Everything still pinned
 * is LOCKED, which is what stops the same question being re-asked every time
 * another game returns a winner. An empty `yieldIds` is the "keep my picks"
 * answer and locks the lot.
 *
 * Re-derives the challenge under the lock and refuses (`CHALLENGE_STALE`) if
 * the board has moved on: the organizer is answering a question about four
 * specific paddles, and a stale answer would unpin someone over a contest that
 * no longer exists.
 *
 * @param {object} opts
 * @param {'W'|'L'} opts.deck
 * @param {string[]} opts.yieldIds - pinned paddles to give up, possibly empty
 */
export async function applyResolveDeckChallengeTx(tx, arenaId, { deck, yieldIds }) {
  if (deck !== DECK_WIN && deck !== DECK_LOSE) throw new Error('CHALLENGE_STALE');
  const ids = Array.isArray(yieldIds) ? yieldIds : [];

  const arena = await tx.arena.findUnique({
    where: { id: arenaId },
    select: { splitDeckByResult: true, lastSessionResetAt: true },
  });
  if (!arena?.splitDeckByResult) throw new Error('CHALLENGE_STALE');

  const queued = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    orderBy: { queueOrder: 'asc' },
    select: { id: true },
  });
  const rack = queued.map((p) => p.id);
  const pins = await readDeckPins(tx, arenaId);
  const decks = splitDecks(
    rack,
    recentResults(await sessionRecentMatches(tx, arenaId, arena.lastSessionResetAt), rack),
  );

  const challenge = deckChallenge(deck, rack, decks, pins);
  if (!challenge) throw new Error('CHALLENGE_STALE');
  // Every id must be a pin this challenge actually offered, and the organizer
  // cannot free more slots than there are winners to seat in them.
  const offered = new Set(challenge.pins);
  if (ids.length > challenge.challengers.length || !ids.every((id) => offered.has(id))) {
    throw new Error('CHALLENGE_STALE');
  }

  if (ids.length > 0) {
    await tx.player.updateMany({
      where: { id: { in: ids }, arenaId, leftAt: null, draftedDeck: deck },
      data: CLEAR_PIN,
    });
  }
  // Lock whatever the organizer kept — including pins they never yielded in an
  // earlier round, which are already locked and unaffected.
  const kept = pinnedIn(deck, rack, pins).filter((id) => !ids.includes(id));
  if (kept.length > 0) {
    await tx.player.updateMany({
      where: { id: { in: kept }, arenaId, leftAt: null, draftedDeck: deck },
      data: { draftedLocked: true },
    });
  }
}

/**
 * Shuffle the waiting rack. Returns whether anything actually moved (a queue
 * of fewer than two paddles is a no-op).
 *
 * @param {object} [opts]
 * @param {{order: string[]}} [opts.outcome] - pre-resolved shuffled order
 *   (offline replay); when absent a fresh random shuffle is taken.
 */
export async function applyShuffleQueueTx(tx, arenaId, { outcome } = {}) {
  // Read the queued set under the lock so we never write a position onto a
  // player a concurrent fillCourt just moved onto a court.
  const queued = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    select: { id: true },
  });
  if (queued.length < 2) return false;
  if (outcome && !sameMembers(outcome.order, queued.map((p) => p.id))) {
    throw new Error('OUTCOME_MISMATCH');
  }
  const orderedIds = outcome?.order ?? shuffle(queued).map((p) => p.id);
  for (let i = 0; i < orderedIds.length; i++) {
    await tx.player.update({ where: { id: orderedIds[i] }, data: { queueOrder: i + 1 } });
  }
  return true;
}

/**
 * Stack the top 4 waiting players onto a court using the lowest-partnership
 * matchup. Throws `COURT_UNAVAILABLE`, `NOT_ENOUGH`, or `QUEUE_CHANGED`.
 *
 * When the arena runs `splitDeckByResult`, the four are NOT the rack's top four
 * but the front of the winners or losers deck, alternating between the two —
 * see `src/lib/decks.js`. Everything downstream of the selection (the wait
 * bump, the team split, the slot snapshot) is identical either way.
 *
 * @param {object} opts
 * @param {string} opts.courtId
 * @param {{players: string[], team1: string[], team2: string[], deck?: 'W'|'L'|null}} [opts.outcome] -
 *   pre-resolved matchup (offline replay); when absent the lowest-partnership
 *   split is picked with a random tie-break. `deck` records which deck the
 *   offline device stacked, so replay rewinds the alternation to the same spot.
 * @param {string[]} [opts.expected] - the four the CALLER was looking at when
 *   they asked for the fill. When given, the stack only proceeds if those are
 *   still the four this transaction would pick; otherwise `QUEUE_CHANGED`.
 *   Without it a fill silently stacks whoever reached the front in the
 *   meantime — an auto-mix, a sub-out, a skip, or another manager's fill can
 *   all reorder the rack between the manager's last repaint and their tap.
 *   Order-insensitive: the team split is decided here, so only the membership
 *   of the four is the caller's claim.
 * @param {{players: string[], deck: 'W'|'L'}} [opts.manual] - a hand-assembled
 *   four. When a deck is short of players (two recent winners, say), the
 *   organizer can top it up from anyone still racked and stack that; `deck`
 *   says which deck they were filling, so the alternation still advances as if
 *   that deck took its turn. Deck mode only, and it replaces the automatic
 *   selection entirely — but every downstream rule (dequeue, wait bump, team
 *   split, slot snapshot) is unchanged, and the four must still all be racked.
 */
export async function applyFillCourtTx(tx, arenaId, { courtId, outcome, expected, manual }) {
  // Atomically claim the court only if it is still vacant (row-locks it).
  // The arenaId guard also rejects a courtId from another arena.
  const claimed = await tx.court.updateMany({
    where: { id: courtId, arenaId, status: 'vacant' },
    data: { status: 'playing' },
  });
  if (claimed.count !== 1) throw new Error('COURT_UNAVAILABLE');

  // Read the arena's play settings under the queue lock, mirroring
  // `applyAutoMixTx`, so a concurrent settings save can't land between the read
  // and the fill. This has to happen BEFORE the rack read now: deck mode
  // decides which four we even select, not just how they're split. A
  // torn/missing row falls back to the column defaults rather than failing a
  // fill the court claim already committed to.
  const arena = await tx.arena.findUnique({
    where: { id: arenaId },
    select: {
      balancedPairing: true,
      lastSessionResetAt: true,
      splitDeckByResult: true,
      lastDeckFilled: true,
    },
  });
  const balanced = arena?.balancedPairing ?? true;
  const deckMode = arena?.splitDeckByResult ?? false;
  const prevDeck = arena?.lastDeckFilled ?? null;

  // Read the whole rack inside the tx so we never act on a stale snapshot. It
  // used to `take: 4`, but a deck fill draws from anywhere in the rack, so the
  // slice has to happen after the deck split rather than in the query. A rack
  // is at most a few dozen rows. Pull queueOrder/waitRounds too so we can
  // snapshot each player's pre-fill rack state onto their slot (lets cancelFill
  // restore them precisely).
  const queued = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    orderBy: { queueOrder: 'asc' },
    // `rating` feeds the closer-rated tie-break in the team split below.
    // The pin columns ride along rather than costing a second query: a pin on
    // someone off the rack is inert anyway, so the racked rows are the whole
    // input `assembleDeck` needs.
    select: {
      id: true,
      queueOrder: true,
      waitRounds: true,
      rating: true,
      draftedDeck: true,
      draftedLocked: true,
    },
  });
  if (queued.length < ON_DECK_SIZE) throw new Error('NOT_ENOUGH');
  const rack = queued.map((p) => p.id);
  // The organizer's pins, derived from the rows just read rather than a second
  // query: a pin on someone off the rack is inert, so the racked rows are the
  // whole input `assembleDeck` needs.
  const pins = new Map(
    queued
      .filter((p) => p.draftedDeck === DECK_WIN || p.draftedDeck === DECK_LOSE)
      .map((p) => [p.id, { deck: p.draftedDeck, locked: p.draftedLocked }]),
  );

  // Recent results drive BOTH the deck split and the balanced team split, so
  // one query serves both. A replayed outcome already records the four AND the
  // split, so it needs neither — skipping the query matters because a sync
  // batch replays many fills inside ONE transaction, each holding the queue
  // lock. Legacy pairing with no deck mode ignores results entirely.
  const needsResults = !outcome && (deckMode || balanced);
  const recentMatches = needsResults
    ? await sessionRecentMatches(tx, arenaId, arena?.lastSessionResetAt)
    : [];

  // Deck mode picks the front of the winners or losers deck, alternating;
  // classic mode is the rack's top four. `nextDeck` always yields four when the
  // rack holds four (it falls back to the classic top four), which the
  // NOT_ENOUGH guard above has already established.
  let deck = null;
  let players;
  if (manual && deckMode) {
    // A hand-topped deck: the organizer named all four, so there is nothing to
    // derive. Validated exactly like a replayed deck outcome — four distinct
    // paddles, all still racked — because it makes the same class of claim
    // (these four, not necessarily the rack's front four). Anything else is a
    // stale or crafted request and must not stack.
    const valid =
      Array.isArray(manual.players) &&
      manual.players.length === ON_DECK_SIZE &&
      new Set(manual.players).size === ON_DECK_SIZE &&
      manual.players.every((id) => rack.includes(id)) &&
      (manual.deck === DECK_WIN || manual.deck === DECK_LOSE);
    if (!valid) throw new Error('QUEUE_CHANGED');
    players = manual.players;
    // The organizer pressed that deck's button, so the rotation moves on as if
    // it took its turn — however the four were assembled. Anything else lets
    // the same deck go out twice running.
    deck = manual.deck;
  } else if (deckMode && !outcome) {
    // Pins ride into the selection so the automatic stack sends the four the
    // organizer assembled, not the four the natural split would have picked.
    // Read under the same lock as the rack.
    const picked = nextDeck(rack, recentResults(recentMatches, rack), prevDeck, pins);
    deck = picked.deck;
    players = picked.players;
  } else {
    // Placeholder for the replayed-outcome path, which replaces both below.
    players = rack.slice(0, ON_DECK_SIZE);
  }

  // A recorded outcome names the four the offline device stacked; validate it,
  // then stack exactly those rather than re-deriving.
  if (outcome) {
    const teamsCoverPlayers =
      outcome.team1?.length === 2 &&
      outcome.team2?.length === 2 &&
      sameMembers([...outcome.team1, ...outcome.team2], outcome.players ?? []);
    // In deck mode the recorded four were chosen against the DEVICE's own
    // alternation pointer, so they are not required to be the rack's top four —
    // only four distinct paddles that are all still racked. That is a weaker
    // claim than classic mode's equality check, deliberately: the sync
    // fingerprint is what catches a genuinely divergent board, and the
    // `dequeued.count` guard below still refuses if any of the four slipped
    // away. Classic mode keeps the original strict check unchanged.
    const selectionValid = deckMode
      ? Array.isArray(outcome.players) &&
        outcome.players.length === ON_DECK_SIZE &&
        new Set(outcome.players).size === ON_DECK_SIZE &&
        outcome.players.every((id) => rack.includes(id))
      : sameMembers(outcome.players, rack.slice(0, ON_DECK_SIZE));
    // The recorded deck is written straight into `Arena.lastDeckFilled`, which
    // then drives `nextDeck` and the sync fingerprint — so it has to be in the
    // documented domain, exactly as the `manual` path above requires. A
    // corrupted stored event log otherwise sets an arbitrary pointer, and
    // `nextDeck` silently degrades to "always prefer winners".
    const deckValid =
      outcome.deck === undefined ||
      outcome.deck === null ||
      outcome.deck === DECK_WIN ||
      outcome.deck === DECK_LOSE;
    if (!selectionValid || !teamsCoverPlayers || !deckValid) {
      throw new Error('OUTCOME_MISMATCH');
    }
    players = outcome.players;
    deck = outcome.deck ?? null;
  }

  // The caller's claim about who is going on must still hold under the lock.
  // Same class of check as `editCourtLineup`'s QUEUE_CHANGED and the recorded
  // `outcome` validation above — a fill is the one board mutation that used to
  // name no players at all, so a stale rack view produced a wrong stack with
  // no error. Refusing sends the manager a repainted rack to tap again.
  if (expected && !sameMembers(expected, players)) throw new Error('QUEUE_CHANGED');

  // playerId -> { prevQueueOrder, prevWaitRounds } for the slot snapshot below.
  const snapshot = new Map(
    queued.map((p) => [p.id, { prevQueueOrder: p.queueOrder, prevWaitRounds: p.waitRounds }]),
  );

  // Remove exactly these four from the rack; bail if any slipped away meanwhile.
  // Clear `skipBoosted` too — once a paddle is actually playing, the
  // "Next in Line" stamp has served its purpose. Same for a deck pin: the
  // organizer placed them for a stack, and this is that stack.
  const dequeued = await tx.player.updateMany({
    where: { id: { in: players }, queueOrder: { not: null } },
    data: {
      gamesPlayed: { increment: 1 },
      queueOrder: null,
      waitRounds: 0,
      skipBoosted: false,
      ...CLEAR_PIN,
    },
  });
  if (dequeued.count !== ON_DECK_SIZE) throw new Error('QUEUE_CHANGED');

  // Retire the rest of the stacked deck's pins. Usually a no-op — pins are
  // seated first, so they were all in the four just dequeued — but the
  // classic-fallback fill (`deck: null`) and a replayed outcome can stack a
  // four that leaves one behind, and a pin whose stack has happened must not
  // linger into the next one.
  //
  // Deliberately scoped to the deck that filled. The OTHER deck's pins are
  // still valid: those paddles are all still racked, none of them played, so
  // nothing about the organizer's placement has been spent. Clearing both was
  // the bug that made a hand-added winner jump decks when the losers stacked.
  const strandedPins = deckMode && deck ? pinnedIn(deck, rack, pins).filter((id) => !players.includes(id)) : [];
  if (strandedPins.length > 0) {
    await tx.player.updateMany({ where: { id: { in: strandedPins } }, data: CLEAR_PIN });
  }

  // Everyone still waiting in this arena was skipped this round. Capture
  // exactly who gets the +1 (the four are already dequeued, so excluded) and
  // record it on the court, so cancelFill can reverse the bump for precisely
  // these players — not whoever happens to be queued at cancel time.
  const bumped = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    select: { id: true },
  });
  await tx.player.updateMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    data: { waitRounds: { increment: 1 } },
  });
  await tx.court.update({
    where: { id: courtId },
    // `fillPrevDeck` is the alternation pointer as it stood before this fill,
    // so cancelFill can rewind it — same lifecycle as the bumped-player list.
    data: { fillBumpedPlayerIds: bumped.map((p) => p.id), fillPrevDeck: prevDeck },
  });

  // Advance (or, on the classic fallback, clear) the deck alternation. Only in
  // deck mode: an arena that isn't running decks must never have a stale
  // pointer written, so switching the mode on later starts from a clean null.
  // `updateMany` rather than `update` so a torn/missing arena row can't fail a
  // fill the court claim already committed to.
  if (deckMode) {
    await tx.arena.updateMany({ where: { id: arenaId }, data: { lastDeckFilled: deck } });
  }

  // Pair recent losers with recent winners, breaking ties by the closer-rated
  // and then least-repeated split (see src/lib/pairing.js), unless a replayed
  // event already recorded the choice. In deck mode the four usually share a
  // result, so no split can cross a winner with a loser: `crossCount` ties at 0
  // and the ranking falls through to the closer-rated, least-repeated split on
  // its own. That is the intended behaviour, not a degenerate case — within a
  // deck, balance and partner variety are all that's left to optimize.
  const rows = await tx.partnership.findMany({
    where: { arenaId, playerA: { in: players }, playerB: { in: players } },
  });
  const countFor = (x, y) => {
    const [a, b] = canonicalPair(x, y);
    return rows.find((r) => r.playerA === a && r.playerB === b)?.count ?? 0;
  };

  let best;
  if (outcome) {
    best = { team1: outcome.team1, team2: outcome.team2 };
  } else {
    // `recentMatches` was already read above (one query serves the deck split
    // and this one) and is empty in legacy pairing mode, where results are
    // ignored anyway. This ranks identically to the offline engine's own fill.
    const ranked = rankMatchups(players, {
      results: recentResults(recentMatches, players),
      ratings: new Map(queued.map((p) => [p.id, p.rating])),
      pairCount: countFor,
      balanced,
    });
    best = shuffle(bestMatchups(ranked))[0];
  }

  await tx.courtSlot.createMany({
    data: [
      ...best.team1.map((playerId) => ({ courtId, playerId, team: 1, ...snapshot.get(playerId) })),
      ...best.team2.map((playerId) => ({ courtId, playerId, team: 2, ...snapshot.get(playerId) })),
    ],
  });
  await bumpPartnership(tx, arenaId, best.team1[0], best.team1[1]);
  await bumpPartnership(tx, arenaId, best.team2[0], best.team2[1]);
}

/**
 * Cancel a live court's fill: send its four players back to the FRONT of the
 * rack in their original relative order and undo every side effect of
 * {@link applyFillCourtTx}, WITHOUT recording a match or touching
 * wins/losses/Elo. Throws `NOT_PLAYING`, `INVALID_COURT`, or `NO_SNAPSHOT`.
 * Fully deterministic (no outcome parameter).
 */
export async function applyCancelFillTx(tx, arenaId, { courtId }) {
  // Read the fill's bookkeeping under the queue lock, BEFORE the atomic
  // claim clears it — we need the exact set of players the fill bumped.
  const courtRow = await tx.court.findFirst({
    where: { id: courtId, arenaId },
    select: { fillBumpedPlayerIds: true, fillPrevDeck: true },
  });
  const bumpedIds = courtRow?.fillBumpedPlayerIds ?? [];

  // Atomically claim the cancel: only flip playing -> vacant, so a
  // concurrent endMatch/cancelFill for the same court can't double-process.
  // Also clear the fill's bookkeeping so a vacant court never carries the
  // previous fill's state into a future debug session.
  const claimed = await tx.court.updateMany({
    where: { id: courtId, arenaId, status: 'playing' },
    data: { status: 'vacant', fillBumpedPlayerIds: [], fillPrevDeck: null },
  });
  if (claimed.count !== 1) throw new Error('NOT_PLAYING');

  // Rewind the win/lose deck alternation to where it stood before this fill,
  // so a cancelled stack doesn't cost the other deck its turn — cancel is an
  // "undo what I just did" affordance, and without this the deck that was
  // stacked-then-unstacked would silently lose its turn.
  //
  // Unconditional, and deliberately not mode-gated: outside deck mode
  // `fillPrevDeck` is always null and `lastDeckFilled` is never written, so
  // this writes null over null. Cancelling the OLDER of two live fills rewinds
  // to that fill's pointer rather than the newer one's, which can repeat a
  // deck once; the alternation self-corrects on the next fill, and paying for
  // a second column to disambiguate a rare case isn't worth it.
  await tx.arena.updateMany({
    where: { id: arenaId },
    data: { lastDeckFilled: courtRow?.fillPrevDeck ?? null },
  });

  const slots = await tx.courtSlot.findMany({ where: { courtId } });
  // fillCourt always writes four slots — anything else means the court row
  // is corrupt and a partial restore would unbump the wrong teams. Throwing
  // here aborts the transaction, so the atomic `playing -> vacant` claim
  // above rolls back along with it and the court returns to `playing`.
  if (slots.length !== 4) throw new Error('INVALID_COURT');
  // Need both snapshot fields to restore order + wait fairness exactly;
  // a partial/absent snapshot (pre-feature slot) is non-cancellable.
  if (slots.some((s) => s.prevQueueOrder === null || s.prevWaitRounds === null)) {
    throw new Error('NO_SNAPSHOT');
  }

  // Reverse the fill's "+1 wait" for exactly the players it bumped, skipping
  // any who have since left or re-entered a court — so a concurrent finish
  // elsewhere can't get a decrement it never earned. Floor at 0.
  if (bumpedIds.length > 0) {
    await tx.player.updateMany({
      where: {
        id: { in: bumpedIds },
        arenaId,
        leftAt: null,
        queueOrder: { not: null },
        waitRounds: { gt: 0 },
      },
      data: { waitRounds: { decrement: 1 } },
    });
  }

  // Restore each player's pre-fill wait fairness and undo the games bump.
  // The waitRounds restore uses `update` (the row exists; we just read it).
  // The gamesPlayed decrement is guarded by `updateMany` with `gt: 0` so an
  // inconsistent counter can't go negative.
  for (const s of slots) {
    await tx.player.update({
      where: { id: s.playerId },
      data: { waitRounds: s.prevWaitRounds },
    });
    await tx.player.updateMany({
      where: { id: s.playerId, gamesPlayed: { gt: 0 } },
      data: { gamesPlayed: { decrement: 1 } },
    });
  }

  // Reinsert the four at the front in their original relative order, then
  // renumber the whole rack so positions can't collide with players the
  // queue gained/recycled/shuffled while this court was live.
  const restored = [...slots]
    .sort((a, b) => a.prevQueueOrder - b.prevQueueOrder)
    .map((s) => s.playerId);
  const others = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null }, id: { notIn: restored } },
    orderBy: { queueOrder: 'asc' },
    select: { id: true },
  });
  const ordered = [...restored, ...others.map((p) => p.id)];
  for (let i = 0; i < ordered.length; i++) {
    await tx.player.update({ where: { id: ordered[i] }, data: { queueOrder: i + 1 } });
  }

  // Undo the two partnership bumps from the fill (one per team).
  const team1 = slots.filter((s) => s.team === 1).map((s) => s.playerId);
  const team2 = slots.filter((s) => s.team === 2).map((s) => s.playerId);
  if (team1.length === 2) await unbumpPartnership(tx, team1[0], team1[1]);
  if (team2.length === 2) await unbumpPartnership(tx, team2[0], team2[1]);

  // Slots last, so the player restores above still read the snapshot.
  await tx.courtSlot.deleteMany({ where: { courtId } });
}

/**
 * Manually edit a live court's lineup: swap partners and/or substitute
 * players in from the rack. Deterministic (the manager picks the exact
 * teams, so there is no random choice to record). The lineup must already be
 * validated by the caller. Throws `NOT_PLAYING`, `INVALID_COURT`, or
 * `QUEUE_CHANGED`.
 *
 * @param {object} opts
 * @param {string} opts.courtId
 * @param {string[]} opts.team1Ids
 * @param {string[]} opts.team2Ids
 */
export async function applyEditCourtLineupTx(tx, arenaId, { courtId, team1Ids, team2Ids }) {
  // Court must still be live and in this arena. Read its current slots to
  // derive the lineup we're diffing against.
  const court = await tx.court.findFirst({
    where: { id: courtId, arenaId, status: 'playing' },
    select: { id: true, fillBumpedPlayerIds: true },
  });
  if (!court) throw new Error('NOT_PLAYING');

  const slots = await tx.courtSlot.findMany({ where: { courtId } });
  if (slots.length !== 4) throw new Error('INVALID_COURT');

  const current = {
    team1: slots.filter((s) => s.team === 1).map((s) => s.playerId),
    team2: slots.filter((s) => s.team === 2).map((s) => s.playerId),
  };
  // Guard against a malformed split (e.g. 3/1) slipping past the count check —
  // diffLineup's pair logic assumes exactly two players per team.
  if (current.team1.length !== 2 || current.team2.length !== 2) {
    throw new Error('INVALID_COURT');
  }
  const next = { team1: team1Ids, team2: team2Ids };
  const diff = diffLineup(current, next);
  if (!diff.changed) return; // nothing to do

  // Pre-stack rack snapshot for everyone currently on court (the original
  // four). Used to restore a subbed-OUT paddle's pre-stack waitRounds when
  // returning them to the rack as Next-in-Line, and to preserve a stayed
  // player's slot snapshot when the slots are rewritten below.
  const stayedSnap = new Map(
    slots.map((s) => [s.playerId, { prevQueueOrder: s.prevQueueOrder, prevWaitRounds: s.prevWaitRounds }]),
  );

  // Pre-edit rack snapshot for each subbed-in player, captured BEFORE the
  // dequeue so a later cancelFill can restore them precisely.
  const incomingSnap = new Map();

  // Validate subbed-in players under the lock: each must be an active,
  // waiting paddle in THIS arena and not already on any court.
  if (diff.added.length > 0) {
    const incoming = await tx.player.findMany({
      where: {
        id: { in: diff.added },
        arenaId,
        leftAt: null,
        queueOrder: { not: null },
      },
      select: { id: true, queueOrder: true, waitRounds: true },
    });
    if (incoming.length !== diff.added.length) throw new Error('QUEUE_CHANGED');
    const onCourt = await tx.courtSlot.findFirst({
      where: { playerId: { in: diff.added } },
    });
    if (onCourt) throw new Error('QUEUE_CHANGED');

    // A subbed-in paddle that the ORIGINAL fill bumped (+1 waitRounds) still
    // carries that +1 in its current waitRounds. Snapshot the PRE-bump value
    // so a later cancelFill restores their true pre-fill fairness, not the
    // inflated one — and drop them from the court's bump set so, if they are
    // later subbed back out, cancelFill won't reverse a wait credit they
    // since earned elsewhere. Both keep the fill/cancel bookkeeping exact.
    const bumpedSet = new Set(court.fillBumpedPlayerIds ?? []);
    for (const p of incoming) {
      const prevWaitRounds = bumpedSet.has(p.id) ? Math.max(0, p.waitRounds - 1) : p.waitRounds;
      incomingSnap.set(p.id, { prevQueueOrder: p.queueOrder, prevWaitRounds });
    }
    // Dequeue them onto the court (same accounting as fillCourt's dequeue).
    await tx.player.updateMany({
      where: { id: { in: diff.added } },
      data: {
        gamesPlayed: { increment: 1 },
        queueOrder: null,
        waitRounds: 0,
        skipBoosted: false,
        ...CLEAR_PIN,
      },
    });
    const addedSet = new Set(diff.added);
    if ((court.fillBumpedPlayerIds ?? []).some((id) => addedSet.has(id))) {
      await tx.court.update({
        where: { id: courtId },
        data: { fillBumpedPlayerIds: court.fillBumpedPlayerIds.filter((id) => !addedSet.has(id)) },
      });
    }
  }

  // Subbed-out players: undo their game credit and return them to the rack.
  if (diff.removed.length > 0) {
    // A sub-out is the same event class as a Skip-with-replacement (a paddle
    // yields its spot, the manager picks who fills it), so honour the same
    // arena toggle that governs `skipPlayer`. ON (default) ⇒ returned paddle
    // is Next-in-Line: `skipBoosted` set and pre-stack `waitRounds` restored
    // (from the slot snapshot) so the next auto-mix elevates them above the
    // emergency band. OFF ⇒ legacy reset (waitRounds 0, no boost). Read
    // inside the tx so a concurrent settings save can't slip between read
    // and write — mirrors skipPlayer.
    const arena = await tx.arena.findUnique({
      where: { id: arenaId },
      select: { skipRestoresPriority: true },
    });
    const restoresPriority = arena?.skipRestoresPriority ?? true;

    await tx.player.updateMany({
      where: { id: { in: diff.removed }, gamesPlayed: { gt: 0 } },
      data: { gamesPlayed: { decrement: 1 } },
    });
    // Front-of-rack: renumber the whole active rack with removed first, then
    // the existing waiters in their current order. Only the RETURNING players
    // get waitRounds touched; everyone else keeps their wait fairness (so a
    // substitution can't wipe the rack's starvation protection).
    const others = await tx.player.findMany({
      where: { arenaId, leftAt: null, queueOrder: { not: null }, id: { notIn: diff.removed } },
      orderBy: { queueOrder: 'asc' },
      select: { id: true },
    });
    const removedSet = new Set(diff.removed);
    const ordered = [...diff.removed, ...others.map((p) => p.id)];
    for (let i = 0; i < ordered.length; i++) {
      const id = ordered[i];
      let data;
      if (!removedSet.has(id)) {
        data = { queueOrder: i + 1 };
      } else if (restoresPriority) {
        const snap = stayedSnap.get(id);
        data = {
          queueOrder: i + 1,
          waitRounds: snap?.prevWaitRounds ?? 0,
          skipBoosted: true,
        };
      } else {
        data = { queueOrder: i + 1, waitRounds: 0, skipBoosted: false };
      }
      await tx.player.update({ where: { id }, data });
    }
  }

  // Rewrite the four slots to the desired lineup. Wipe and recreate so team
  // assignments and substitutions land in one consistent shape: carry the
  // fresh snapshot for incoming players, and preserve the existing snapshot
  // (built above) for players who stayed on court so cancelFill keeps
  // working for them.
  const slotSnap = (playerId) => incomingSnap.get(playerId) ?? stayedSnap.get(playerId) ?? {};

  await tx.courtSlot.deleteMany({ where: { courtId } });
  await tx.courtSlot.createMany({
    data: [
      ...team1Ids.map((playerId) => ({ courtId, playerId, team: 1, ...slotSnap(playerId) })),
      ...team2Ids.map((playerId) => ({ courtId, playerId, team: 2, ...slotSnap(playerId) })),
    ],
  });

  // Partnership delta: only pairs that actually changed.
  for (const [x, y] of diff.pairsToUnbump) await unbumpPartnership(tx, x, y);
  for (const [x, y] of diff.pairsToBump) await bumpPartnership(tx, arenaId, x, y);
}

/**
 * Finish a match: record it (snapshot names + score), update wins/losses and
 * Elo, and recycle the four players to the back of the rack. Throws
 * `ALREADY_FINISHED` when the court is no longer playing. The score must
 * already be validated by the caller.
 *
 * @param {object} opts
 * @param {string} opts.courtId
 * @param {number} opts.s1
 * @param {number} opts.s2
 * @param {{recycleOrder: string[]}} [opts.outcome] - pre-resolved recycle
 *   order (offline replay); when absent a fresh random shuffle is taken.
 * @param {string|Date} [opts.occurredAt] - when the match actually finished;
 *   written as `Match.createdAt` on offline replay so leaderboards/session
 *   stats key off court time, not sync time. Absent online (DB default now()).
 * @param {number} [opts.targetScore] - the target the scoreline was validated
 *   against, persisted as `Match.targetScore` so a later correction is judged
 *   by the rules this game was played under rather than the arena's current
 *   setting. Callers pass the SAME value they validated with; omitted leaves
 *   the column null ("unknown").
 */
export async function applyEndMatchTx(tx, arenaId, { courtId, s1, s2, outcome, occurredAt, targetScore }) {
  const team1Won = s1 > s2;
  const team2Won = s2 > s1;

  // Atomically claim the finish: only one caller can flip playing -> vacant,
  // so concurrent endMatch calls for the same court can't double-record.
  // Also clear the cancel-bookkeeping (`fillBumpedPlayerIds`, `fillPrevDeck`)
  // so a vacant court never carries the previous fill's metadata. A finished
  // game does NOT rewind the deck alternation — that turn was played.
  const claimed = await tx.court.updateMany({
    where: { id: courtId, arenaId, status: 'playing' },
    data: { status: 'vacant', fillBumpedPlayerIds: [], fillPrevDeck: null },
  });
  if (claimed.count !== 1) throw new Error('ALREADY_FINISHED');

  // Read the authoritative slot snapshot inside the transaction.
  const court = await tx.court.findUnique({ where: { id: courtId } });
  const slots = await tx.courtSlot.findMany({
    where: { courtId },
    include: { player: true },
  });
  const team1 = slots.filter((s) => s.team === 1);
  const team2 = slots.filter((s) => s.team === 2);

  const base = await maxQueueOrder(tx, arenaId);
  // Recycle finished players back into the rack in randomized order (or the
  // order a replayed offline event recorded; that order may only permute the
  // players actually on this court).
  if (outcome?.recycleOrder && !sameMembers(outcome.recycleOrder, slots.map((s) => s.playerId))) {
    throw new Error('OUTCOME_MISMATCH');
  }
  const recycled = outcome?.recycleOrder
    ? outcome.recycleOrder.map((playerId) => slots.find((s) => s.playerId === playerId))
    : shuffle(slots);

  // Elo is computed BEFORE the match row so its delta can be stored on it. A
  // filled court is always two players per team; guard anyway so a malformed
  // court can't crash a finish — it just records no delta (null = unknown).
  let next = null;
  let ratingDelta = null;
  if (team1.length === 2 && team2.length === 2) {
    next = computeMatchRatings({
      team1: [team1[0].player.rating, team1[1].player.rating],
      team2: [team2[0].player.rating, team2[1].player.rating],
      outcome: team1Won ? 1 : team2Won ? 2 : 0,
    });
    // Zero-sum with a fixed K, and both teammates share their team's move, so
    // team 1's swing is the whole story: team 2 moved by exactly its negative.
    // One integer therefore makes this match's rating effect reversible.
    ratingDelta = next.team1[0] - team1[0].player.rating;
  }

  await tx.match.create({
    data: {
      arenaId,
      courtName: court.name,
      score1: s1,
      score2: s2,
      ratingDelta,
      // Null when the caller didn't say; readers fall back to the arena's
      // current target rather than treating the absence as a value.
      targetScore: targetScore ?? null,
      ...(occurredAt ? { createdAt: occurredAt } : {}),
      players: {
        create: slots.map((s) => ({
          playerId: s.playerId,
          playerFirstName: s.player.firstName,
          playerLastName: s.player.lastName,
          team: s.team,
        })),
      },
    },
  });

  if (team1Won || team2Won) {
    const winners = (team1Won ? team1 : team2).map((s) => s.playerId);
    const losers = (team1Won ? team2 : team1).map((s) => s.playerId);
    await tx.player.updateMany({ where: { id: { in: winners } }, data: { wins: { increment: 1 } } });
    await tx.player.updateMany({ where: { id: { in: losers } }, data: { losses: { increment: 1 } } });
  }

  // Persist the ratings computed above (Phase 6).
  if (next) {
    await tx.player.update({ where: { id: team1[0].playerId }, data: { rating: next.team1[0] } });
    await tx.player.update({ where: { id: team1[1].playerId }, data: { rating: next.team1[1] } });
    await tx.player.update({ where: { id: team2[0].playerId }, data: { rating: next.team2[0] } });
    await tx.player.update({ where: { id: team2[1].playerId }, data: { rating: next.team2[1] } });
  }

  await tx.courtSlot.deleteMany({ where: { courtId } });

  for (let i = 0; i < recycled.length; i++) {
    await tx.player.update({
      where: { id: recycled[i].playerId },
      data: { queueOrder: base + i + 1 },
    });
  }
}

/**
 * Undo a recorded match's effect on its four participants' records, then
 * (optionally) re-apply it under a new outcome. The reversal half is what a
 * winner-flipping correction and a match deletion both need.
 *
 * Elo comes back out via the stored `Match.ratingDelta`:
 * `computeMatchRatings` is zero-sum with a fixed K and both teammates share
 * their team's move, so subtracting the delta from team 1 and adding it to
 * team 2 is the exact inverse of the finish — integer arithmetic, no rounding
 * drift, no replay.
 *
 * EXACTNESS: the ratings this restores are the true pre-match ones when the
 * match is the last those four played, which is the ordinary case (a swapped
 * scoreline gets noticed immediately). If they have played since, it recovers
 * "current minus this match" instead, and the replacement delta is computed
 * from strengths that are off by however far the four have since moved.
 *
 * That residual is small and, more importantly, BOUNDED. A correction only
 * ever swaps one match's contribution, and `computeMatchRatings` keeps any
 * single delta inside ±K (32), so no player moves by more than 2K no matter
 * how stale the match is — measured: ~1 Elo of error after one extra game per
 * player, ~8 after a 200-point drift, ~16 at an implausible 400. It is also
 * zero-sum: points move between the four, none are invented or destroyed, and
 * nothing compounds across corrections. Both invariants are pinned by tests.
 *
 * Elo is path-dependent, so only replaying every later match would reproduce
 * the history the arena "should" have had — and a replay cannot survive the
 * rating blending a player merge does (see `linkPlayerToMember`), nor the
 * participant rows it deletes. A bounded, zero-sum adjustment is the honest
 * ceiling here.
 *
 * @param {object} opts
 * @param {object} opts.match - the `Match` row, including `ratingDelta`.
 * @param {{s1: number, s2: number}} [opts.rescore] - the corrected scoreline.
 *   Omitted reverses only, leaving the four as if the match never counted.
 * @returns {Promise<{ratingDelta: number|null}>} the delta now in force
 *   (`null` when the match was reversed and not re-applied).
 * @throws {Error} `NO_RATING_DELTA` when the match predates the column, so its
 *   Elo effect was never recorded and cannot be recovered.
 * @throws {Error} `INCOMPLETE_ROSTER` when the snapshot no longer resolves to
 *   two live players a side — a merge can delete a duplicate participant row
 *   (see `linkPlayerToMember`), and reversing a partial roster would move some
 *   ratings and not others.
 */
export async function applyMatchReversalTx(tx, arenaId, { match, rescore }) {
  if (match.ratingDelta === null || match.ratingDelta === undefined) {
    throw new Error('NO_RATING_DELTA');
  }

  const snapshots = await tx.matchPlayer.findMany({
    where: { matchId: match.id },
    select: { playerId: true, team: true },
  });
  const ids = snapshots.map((mp) => mp.playerId);
  // Departed players keep their row (`leftAt` set), so they still reverse
  // correctly; only a genuinely missing row breaks the arithmetic.
  const players = await tx.player.findMany({
    where: { id: { in: ids }, arenaId },
    select: { id: true, rating: true },
  });
  const ratingOf = new Map(players.map((p) => [p.id, p.rating]));

  const team1 = snapshots.filter((mp) => mp.team === 1).map((mp) => mp.playerId);
  const team2 = snapshots.filter((mp) => mp.team === 2).map((mp) => mp.playerId);
  if (team1.length !== 2 || team2.length !== 2 || players.length !== 4) {
    throw new Error('INCOMPLETE_ROSTER');
  }

  // Back out this match's swing to recover the ratings it was computed from.
  const before = new Map([
    ...team1.map((id) => [id, ratingOf.get(id) - match.ratingDelta]),
    ...team2.map((id) => [id, ratingOf.get(id) + match.ratingDelta]),
  ]);

  let nextDelta = null;
  if (rescore) {
    const next = computeMatchRatings({
      team1: [before.get(team1[0]), before.get(team1[1])],
      team2: [before.get(team2[0]), before.get(team2[1])],
      outcome: rescore.s1 > rescore.s2 ? 1 : rescore.s2 > rescore.s1 ? 2 : 0,
    });
    nextDelta = next.team1[0] - before.get(team1[0]);
  }

  for (const id of team1) {
    await tx.player.update({
      where: { id },
      data: { rating: before.get(id) + (nextDelta ?? 0) },
    });
  }
  for (const id of team2) {
    await tx.player.update({
      where: { id },
      data: { rating: before.get(id) - (nextDelta ?? 0) },
    });
  }

  // Win/loss counters. The finish banked one apiece only for a decided match,
  // so a reversal of a (legacy) tie has nothing to take back. Decrements are
  // guarded by `gt: 0` — the same defence `applyCancelFillTx` uses — so a
  // counter that was already reconciled by hand can't go negative.
  const oldWinners = match.score1 > match.score2 ? team1 : match.score2 > match.score1 ? team2 : null;
  const oldLosers = oldWinners === null ? null : oldWinners === team1 ? team2 : team1;
  if (oldWinners) {
    await tx.player.updateMany({
      where: { id: { in: oldWinners }, wins: { gt: 0 } },
      data: { wins: { decrement: 1 } },
    });
    await tx.player.updateMany({
      where: { id: { in: oldLosers }, losses: { gt: 0 } },
      data: { losses: { decrement: 1 } },
    });
  }

  const newWinners = !rescore
    ? null
    : rescore.s1 > rescore.s2
      ? team1
      : rescore.s2 > rescore.s1
        ? team2
        : null;
  if (newWinners) {
    const newLosers = newWinners === team1 ? team2 : team1;
    await tx.player.updateMany({
      where: { id: { in: newWinners } },
      data: { wins: { increment: 1 } },
    });
    await tx.player.updateMany({
      where: { id: { in: newLosers } },
      data: { losses: { increment: 1 } },
    });
  }

  return { ratingDelta: nextDelta };
}

/**
 * Delete a recorded match and undo everything it counted for.
 *
 * A correction reverses only what the FINISH banked (Elo, wins/losses),
 * because the game still happened. A deletion says the game never should have
 * been recorded at all, so it also unwinds what the FILL banked: the
 * `gamesPlayed` bump and the partnership counts. That half mirrors
 * {@link applyCancelFillTx}, which is the existing "this fill shouldn't have
 * counted" path — same `gt: 0` guard so an already-reconciled counter can't
 * go negative, same `unbumpPartnership`.
 *
 * The row itself is hard-deleted (`MatchPlayer` cascades). Nothing here
 * touches the rack or the courts: the four went back to the rack when the
 * match finished and may be mid-game elsewhere by now.
 *
 * KNOWN LIMITS (tracked in #167). Both come from the same gap: a `Match`
 * records WHEN it was played, not where it sits in the chain of mutations
 * that produced the current ratings and partnership counts.
 *
 *   - A participant whose rating was BLENDED by `linkPlayerToMember` after
 *     this match no longer holds a rating this delta can be subtracted from.
 *     Blending a one-game 1016 row into a nine-game 1000 row gives 1002;
 *     deleting the match then lands on 986 instead of the 1000 it should.
 *     The roster check can't see it — the merge only drops a `MatchPlayer`
 *     row when BOTH players were in the same match. Bounded by the delta.
 *   - The partnership guard below compares the match's FINISH time to the
 *     session boundary, but the bump it reverses happened at FILL time.
 *     `prepareNextSession` leaves live courts playing, so a fill from before
 *     a reset can finish after it — its bump already wiped, yet the match
 *     reads as this session's. Costs one pairing count.
 *
 * @param {object} opts
 * @param {object} opts.match - the `Match` row, including `ratingDelta`.
 * @throws {Error} `NO_RATING_DELTA` / `INCOMPLETE_ROSTER` — see
 *   {@link applyMatchReversalTx}.
 * @throws {Error} `RACED` when the row is already gone.
 */
export async function applyMatchDeletionTx(tx, arenaId, { match }) {
  const snapshots = await tx.matchPlayer.findMany({
    where: { matchId: match.id },
    select: { playerId: true, team: true },
  });

  // Reverse the finish first: it validates the roster and the stored delta,
  // so a match it refuses is left completely untouched.
  await applyMatchReversalTx(tx, arenaId, { match });

  // Now the fill's side of the ledger. `gamesPlayed` is cumulative across
  // sessions — `prepareNextSession` deliberately leaves it alone — so it comes
  // back out whatever session the match belongs to.
  const ids = snapshots.map((mp) => mp.playerId);
  await tx.player.updateMany({
    where: { id: { in: ids }, arenaId, gamesPlayed: { gt: 0 } },
    data: { gamesPlayed: { decrement: 1 } },
  });

  // Partnerships are NOT cumulative: a session reset wipes the table so the
  // variety algorithm starts unbiased by last week. So a match from before the
  // boundary no longer has a contribution in the current ledger — decrementing
  // for it would eat a pairing THIS session's fills recorded, and tell
  // matchmaking two players have partnered one time fewer than they have.
  const arena = await tx.arena.findUnique({
    where: { id: arenaId },
    select: { lastSessionResetAt: true },
  });
  const boundary = arena?.lastSessionResetAt ?? null;
  const countedThisSession = !boundary || new Date(match.createdAt) >= new Date(boundary);
  if (countedThisSession) {
    const team1 = snapshots.filter((mp) => mp.team === 1).map((mp) => mp.playerId);
    const team2 = snapshots.filter((mp) => mp.team === 2).map((mp) => mp.playerId);
    await unbumpPartnership(tx, team1[0], team1[1]);
    await unbumpPartnership(tx, team2[0], team2[1]);
  }

  // deleteMany (not delete) so a row that vanished under us is a clean
  // count===0 rather than a thrown P2025, and scoped to the arena so a match
  // id from elsewhere can't be removed through this path.
  const removed = await tx.match.deleteMany({ where: { id: match.id, arenaId } });
  if (removed.count === 0) throw new Error('RACED');
}

/**
 * Silo-Buster auto-mix: re-sort the whole waiting rack by fairness band, wait,
 * games, then a random tie-break, and consume any `skipBoosted` flags.
 * Returns whether anything was mixed. Throws `ARENA_GONE` when the arena was
 * deleted concurrently.
 *
 * @param {object} [opts]
 * @param {{mixedOrder: string[]}} [opts.outcome] - pre-resolved mixed order
 *   (offline replay); when absent the random tie-break applies.
 */
export async function applyAutoMixTx(tx, arenaId, { outcome } = {}) {
  // Read the thresholds inside the transaction so a concurrent settings
  // save can't slip in between read and reorder, and so the row is
  // null-checked explicitly rather than crashing on destructure.
  const arena = await tx.arena.findUnique({
    where: { id: arenaId },
    select: { starveThreshold: true, emergencyWait: true, skipRestoresPriority: true },
  });
  if (!arena) throw new Error('ARENA_GONE');
  const { starveThreshold, emergencyWait, skipRestoresPriority } = arena;

  // Read the queued set under the lock so a concurrent fillCourt can't make
  // us reassign a position to a player who is now on a court.
  const queued = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    select: { id: true, gamesPlayed: true, gamesOffset: true, waitRounds: true, skipBoosted: true },
  });
  if (queued.length === 0) return false;
  if (outcome && !sameMembers(outcome.mixedOrder, queued.map((p) => p.id))) {
    throw new Error('OUTCOME_MISMATCH');
  }
  // Sort lexicographically: band first (next-line > emergency > protected
  // > fresh), then in the strict-wait bands (next-line, emergency) by
  // longest-waiting first, then by FEWEST games played-since-joining
  // (gamesPlayed + gamesOffset, so a player who has played less goes
  // ahead but a late joiner can't hog), then a random tie-break for
  // variety among equals.
  const orderedIds =
    outcome?.mixedOrder ??
    queued
      .map((p) => ({
        id: p.id,
        // Gate the boost on the arena setting under the queue lock: a
        // stale `Player.skipBoosted` (set during a race with a
        // toggle-off — skipPlayer reads the old `true` value under its
        // own lock, then commits after `updateArenaMatchmaking`'s wipe
        // outside the lock) must not elevate the paddle once the arena
        // is in legacy mode. Treating the arena setting as
        // authoritative here is simpler than locking the settings save.
        band: bandOf(p.waitRounds, {
          starveThreshold,
          emergencyWait,
          skipBoosted: p.skipBoosted && skipRestoresPriority,
        }),
        waitRounds: p.waitRounds,
        games: p.gamesPlayed + p.gamesOffset,
        rand: Math.random(),
      }))
      .sort((a, b) => {
        if (a.band !== b.band) return b.band - a.band; // next-line > emergency > protected > fresh
        // Both next-line and emergency bands are strictly longest-first.
        if ((a.band === 3 || a.band === 2) && a.waitRounds !== b.waitRounds) return b.waitRounds - a.waitRounds;
        if (a.games !== b.games) return a.games - b.games; // fewest games-since-joining first
        return a.rand - b.rand; // random tie-break among equals
      })
      .map((p) => p.id);
  for (let i = 0; i < orderedIds.length; i++) {
    await tx.player.update({ where: { id: orderedIds[i] }, data: { queueOrder: i + 1 } });
  }
  // One-shot semantic: the next-line boost is consumed by the mix that
  // elevated them. Clear the flag for anyone in the rack so a paddle
  // can't surf the boost across multiple mixes.
  await tx.player.updateMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null }, skipBoosted: true },
    data: { skipBoosted: false },
  });
  return true;
}

/**
 * Check a player into the rack (append to the queue) with a fresh
 * group-average `gamesOffset` re-anchor. No-op when the player is missing,
 * already queued, or mid-match. Idempotent and deterministic.
 */
export async function applyCheckInTx(tx, arenaId, { playerId }) {
  const player = await tx.player.findFirst({
    where: { id: playerId, arenaId, leftAt: null },
    select: { id: true, queueOrder: true, gamesPlayed: true },
  });
  if (!player) return;
  if (player.queueOrder !== null) return;
  // Skip if the player is currently on a court — they'll return to the rack
  // when `endMatch` fires, and double-queueing would put them in two places.
  const onCourt = await tx.courtSlot.findFirst({
    where: { playerId: player.id, court: { status: 'playing' } },
  });
  if (onCourt) return;
  const avg = await groupAverageMetric(tx, arenaId);
  const order = (await maxQueueOrder(tx, arenaId)) + 1;
  await tx.player.update({
    where: { id: player.id },
    data: { queueOrder: order, waitRounds: 0, skipBoosted: false, gamesOffset: avg - player.gamesPlayed },
  });
}

/**
 * Check a player out of the rack — clears `queueOrder` so they don't get
 * stacked onto the next court. A player currently mid-match is left alone
 * (their `queueOrder` is already null while playing). Idempotent.
 */
export async function applyCheckOutTx(tx, arenaId, { playerId }) {
  await tx.player.updateMany({
    where: { id: playerId, arenaId, leftAt: null, queueOrder: { not: null } },
    data: { queueOrder: null, waitRounds: 0, skipBoosted: false, ...CLEAR_PIN },
  });
}

/**
 * Skip an on-deck paddle (see `skipPlayer` in actions.js for the full
 * behavioral contract: both arena settings, self vs manager, replacement
 * picking). Deterministic given its inputs.
 *
 * @param {object} opts
 * @param {string} opts.playerId
 * @param {string|null} [opts.replacementId] - manager-picked replacement.
 * @param {boolean} opts.isManager - whether the caller may manual-pick.
 * @returns {Promise<{moved: boolean, restoresPriority: boolean, replacementError: string}>}
 */
export async function applySkipPlayerTx(tx, arenaId, { playerId, replacementId = null, isManager }) {
  let moved = false;
  let restoresPriority = false;
  let replacementError = '';

  // Read every relevant arena setting inside the tx so a concurrent settings
  // save can't slip between read and write.
  const arena = await tx.arena.findUnique({
    where: { id: arenaId },
    select: {
      skipRestoresPriority: true,
      skipPickReplacement: true,
      splitDeckByResult: true,
      lastSessionResetAt: true,
    },
  });
  if (!arena) return { moved, restoresPriority, replacementError };
  restoresPriority = arena.skipRestoresPriority;

  // Enforce the same eligibility the UI gates on (deriveRackRow.canSkip),
  // server-authoritatively: skip is only valid for an ON-DECK paddle AND only
  // when someone is waiting behind to take the freed spot. Re-checked under
  // the lock so a direct POST can't skip an off-deck paddle and dodge the
  // fairness rules.
  const queued = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    orderBy: { queueOrder: 'asc' },
    select: { id: true, queueOrder: true },
  });
  const rack = queued.map((p) => p.id);

  // In deck mode "on deck" means the front four of the paddle's OWN deck, and
  // the paddle that takes the freed spot must come from that same deck —
  // promoting a loser into the winners' game would defeat the whole mode. The
  // classic rack is the single-bucket case of exactly the same rule, so both
  // modes run the identical arithmetic over a `bucket` array below.
  let bucket = rack;
  if (arena.splitDeckByResult) {
    const recentMatches = await sessionRecentMatches(tx, arenaId, arena.lastSessionResetAt);
    const decks = splitDecks(rack, recentResults(recentMatches, rack));
    bucket = bucketFor(deckOf(playerId, decks), decks);
  }

  const index = bucket.indexOf(playerId);
  if (index === -1 || index >= ON_DECK_SIZE || bucket.length <= ON_DECK_SIZE) {
    return { moved, restoresPriority, replacementError };
  }

  // Manual replacement picking is gated on caller (manager-only), the arena
  // setting, and a valid waiting target. Anything that fails the gate falls
  // back to auto-pick (first waiting in the same deck). Two distinct failure
  // modes return clean (no-op) errors so the cause is debuggable and the
  // manager knows whether to retry:
  //   - replacement gone from the deck (left, pulled to a court, or moved to
  //     the other deck by a finish): a genuine race → "no longer available"
  //     (the UI keeps the picker open so they pick again from the refreshed
  //     list).
  //   - replacement is on deck, not waiting: only reachable via a malformed
  //     POST (the picker never lists on-deck rows) → "invalid replacement".
  let replacementIdx = ON_DECK_SIZE; // auto: first waiting in this deck
  if (replacementId && isManager && arena.skipPickReplacement) {
    const idx = bucket.indexOf(replacementId);
    if (idx === -1) {
      replacementError = 'That replacement is no longer available. Pick again.';
      return { moved, restoresPriority, replacementError };
    }
    if (idx < ON_DECK_SIZE) {
      replacementError = 'That player is already on deck — pick a waiting paddle.';
      return { moved, restoresPriority, replacementError };
    }
    replacementIdx = idx;
  }
  // A pick of the first-waiting paddle is identical to auto-pick; collapse
  // them so both take the cheap path below.
  const isManualPick = replacementIdx !== ON_DECK_SIZE;

  const rowFor = (id) => queued.find((p) => p.id === id);

  if (restoresPriority) {
    // On-mode "Next in Line" — the skipped paddle lands just PAST the front
    // four of its own deck, the picked replacement fills the freed on-deck
    // slot, and the next auto-mix elevates the skipped paddle via
    // `skipBoosted`. Reordering the BUCKET (rather than the whole rack) is
    // what keeps a deck skip from disturbing the other deck: the bucket's
    // members are rewritten into the rack positions the bucket already
    // occupied, so every other paddle keeps its exact slot.
    const onDeckMinusSkipped = bucket.slice(0, ON_DECK_SIZE).filter((_, k) => k !== index);
    const replacement = bucket[replacementIdx];
    const waitingMinusReplacement = bucket
      .slice(ON_DECK_SIZE)
      .filter((id) => id !== replacement);
    const reorderedBucket = [
      ...onDeckMinusSkipped,
      replacement,
      bucket[index],
      ...waitingMinusReplacement,
    ];
    // Map the bucket's new member order back onto the rack, leaving the other
    // deck's paddles exactly where they are. In classic mode the bucket IS the
    // rack, so this collapses to the original whole-rack renumber.
    const bucketPositions = bucket.map((id) => rack.indexOf(id));
    const nextRack = [...rack];
    bucketPositions.forEach((pos, k) => {
      nextRack[pos] = reorderedBucket[k];
    });
    const reordered = nextRack.map((id) => rowFor(id));
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].queueOrder !== i + 1) {
        await tx.player.update({ where: { id: reordered[i].id }, data: { queueOrder: i + 1 } });
      }
    }
    await tx.player.update({ where: { id: playerId }, data: { skipBoosted: true } });
  } else {
    // Off-mode legacy "back of rack + reset" — minimal writes, no dense
    // renumber (queueOrder is just a sort key, gaps are fine):
    //   - the skipped paddle goes to max+1 and resets `waitRounds`; clears
    //     any lingering boost so it can't surf priority across a mode toggle.
    //   - auto-pick needs no extra write: once the skipped paddle vacates
    //     its on-deck slot, the next paddle in the same deck promotes by
    //     queueOrder on its own.
    //   - a manual pick takes the skipped paddle's freed slot directly (one
    //     write), leaving everyone else untouched.
    // `index`/`replacementIdx` are positions in the BUCKET, so resolve them
    // back to rack rows before touching queueOrder.
    const skippedOrder = rowFor(playerId).queueOrder;
    const backOrder = (await maxQueueOrder(tx, arenaId)) + 1;
    if (isManualPick) {
      await tx.player.update({
        where: { id: bucket[replacementIdx] },
        data: { queueOrder: skippedOrder },
      });
    }
    await tx.player.update({
      where: { id: playerId },
      data: { queueOrder: backOrder, waitRounds: 0, skipBoosted: false },
    });
  }
  moved = true;
  return { moved, restoresPriority, replacementError };
}

// --- Offline replay -------------------------------------------------------

// Client-generated walk-in ids: `off_` + a crypto.randomUUID(). Anything else
// in an addPlayer event is rejected so a crafted batch can't pick ids that
// collide with (or impersonate) server-generated cuids.
const OFFLINE_PLAYER_ID = /^off_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Read the board in the shape `boardFingerprint` (and the client engine)
 * consume, inside the caller's transaction and under its queue lock. Mirrors
 * `getState`'s board fields, minus display-only data the fingerprint ignores.
 */
export async function readBoardStateTx(tx, arenaId) {
  const players = await tx.player.findMany({
    where: { arenaId, leftAt: null },
    select: {
      id: true,
      queueOrder: true,
      waitRounds: true,
      gamesPlayed: true,
      gamesOffset: true,
      wins: true,
      losses: true,
      rating: true,
      skipBoosted: true,
    },
  });
  const courts = await tx.court.findMany({
    where: { arenaId },
    include: { slots: { select: { playerId: true, team: true } } },
  });
  const partnerships = await tx.partnership.findMany({ where: { arenaId } });
  // The win/lose deck alternation pointer is hashed alongside the rules (see
  // `canonicalBoardString`), so it has to travel with the board state.
  const arena = await tx.arena.findUnique({
    where: { id: arenaId },
    select: { lastDeckFilled: true },
  });

  const queue = players
    .filter((p) => p.queueOrder !== null)
    .sort((a, b) => a.queueOrder - b.queueOrder)
    .map((p) => p.id);
  const history = {};
  for (const { playerA, playerB, count } of partnerships) {
    (history[playerA] ??= {})[playerB] = count;
    (history[playerB] ??= {})[playerA] = count;
  }
  return {
    players,
    queue,
    courts: courts.map((c) => ({ id: c.id, status: c.status, slots: c.slots })),
    history,
    lastDeckFilled: arena?.lastDeckFilled ?? null,
  };
}

/**
 * Apply ONE recorded offline event inside the sync transaction. The batch's
 * auth ran once up front (manager), so per-event auth is settled; recorded
 * outcomes are validated by the appliers (set-equality against live reads).
 *
 * Typed failures throw `Error(CODE)`; the sync action maps them to a
 * strict-mode rollback or a best-effort skip. `BAD_EVENT` marks a malformed
 * payload (client bug or tampering), the other codes mean "no longer applies
 * to this board".
 *
 * @param {object} settings - the batch's settings snapshot (score target etc.)
 * @param {object} event - { id, type, payload, outcome }
 * @param {{occurredAt: Date}} meta - server-clamped event time
 */
export async function applyEventTx(tx, arenaId, settings, event, { occurredAt }) {
  const payload = event?.payload ?? {};
  switch (event?.type) {
    case 'addPlayer': {
      const firstName = typeof payload.firstName === 'string' ? payload.firstName.trim() : '';
      const lastName = typeof payload.lastName === 'string' ? payload.lastName.trim() : '';
      if (
        !OFFLINE_PLAYER_ID.test(payload.playerId ?? '') ||
        firstName.length === 0 ||
        firstName.length > 60 ||
        lastName.length > 60
      ) {
        throw new Error('BAD_EVENT');
      }
      await addArenaPlayer(tx, arenaId, { id: payload.playerId, firstName, lastName });
      return;
    }
    case 'checkIn':
      // A missing/blank playerId would let Prisma's dropped `id` filter match
      // an arbitrary queued player, so reject the event rather than guess.
      if (typeof payload.playerId !== 'string' || payload.playerId.length === 0) {
        throw new Error('BAD_EVENT');
      }
      await applyCheckInTx(tx, arenaId, { playerId: payload.playerId });
      return;
    case 'checkOut':
      // Guard before applyCheckOutTx: its `updateMany` would otherwise clear
      // every queued player in the arena when `playerId` is undefined (Prisma
      // drops undefined `where` filters).
      if (typeof payload.playerId !== 'string' || payload.playerId.length === 0) {
        throw new Error('BAD_EVENT');
      }
      await applyCheckOutTx(tx, arenaId, { playerId: payload.playerId });
      return;
    case 'shuffleQueue':
      await applyShuffleQueueTx(tx, arenaId, { outcome: event.outcome });
      return;
    case 'fillCourt':
      await applyFillCourtTx(tx, arenaId, { courtId: payload.courtId, outcome: event.outcome });
      return;
    case 'cancelFill':
      await applyCancelFillTx(tx, arenaId, { courtId: payload.courtId });
      return;
    case 'editCourtLineup':
      // Validate the recorded lineup before applying, like the online action.
      if (!validateLineup(payload.team1Ids, payload.team2Ids).ok) throw new Error('BAD_EVENT');
      await applyEditCourtLineupTx(tx, arenaId, {
        courtId: payload.courtId,
        team1Ids: payload.team1Ids,
        team2Ids: payload.team2Ids,
      });
      return;
    case 'endMatch': {
      // Validate against the BATCH's target score: the score was entered
      // under the rules the manager saw at the court, and a concurrent
      // settings change shows up as divergence, not silent re-validation.
      const check = validateMatchScore(payload.score1, payload.score2, settings.targetScore);
      if (!check.ok) throw new Error('BAD_EVENT');
      await applyEndMatchTx(tx, arenaId, {
        courtId: payload.courtId,
        s1: parseInt(payload.score1, 10),
        s2: parseInt(payload.score2, 10),
        outcome: { recycleOrder: event.outcome?.recycleOrder },
        occurredAt,
        // The batch's own snapshot — the same target this scoreline was just
        // validated against, so a replayed match records the rules it was
        // played under offline, not the arena's setting at sync time.
        targetScore: settings.targetScore,
      });
      if (payload.autoMix && event.outcome?.mixedOrder) {
        await applyAutoMixTx(tx, arenaId, { outcome: { mixedOrder: event.outcome.mixedOrder } });
      }
      return;
    }
    case 'skipPlayer': {
      const { replacementError } = await applySkipPlayerTx(tx, arenaId, {
        playerId: payload.playerId,
        replacementId: payload.replacementId ?? null,
        isManager: true, // the batch is manager-authorized as a whole
      });
      // The client validated the pick when it recorded the event, so a gone
      // replacement here means the board diverged from the batch's base.
      if (replacementError) throw new Error('OUTCOME_MISMATCH');
      return;
    }
    // Deck pins replay as themselves — the organizer named the paddle and the
    // deck, so there is no nondeterministic choice to reproduce. A pin the
    // server would now refuse (the paddle stacked while the device was away)
    // is dropped rather than failing the batch: the divergence fingerprint is
    // what catches a genuinely different board, and a spent pin is harmless.
    case 'pinToDeck': {
      try {
        await applyPinToDeckTx(tx, arenaId, { playerId: payload.playerId, deck: payload.deck });
      } catch (err) {
        if (err?.message !== 'PIN_INVALID') throw err;
      }
      return;
    }
    case 'unpinFromDeck':
      await applyUnpinFromDeckTx(tx, arenaId, { playerId: payload.playerId });
      return;
    case 'resolveDeckChallenge': {
      try {
        await applyResolveDeckChallengeTx(tx, arenaId, {
          deck: payload.deck,
          yieldIds: payload.yieldIds ?? [],
        });
      } catch (err) {
        if (err?.message !== 'CHALLENGE_STALE') throw err;
      }
      return;
    }
    default:
      throw new Error('BAD_EVENT');
  }
}
