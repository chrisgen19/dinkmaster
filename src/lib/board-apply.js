import { ON_DECK_SIZE, bandOf } from '@/lib/matchmaking';
import { RECENT_MATCH_WINDOW, bestMatchups, rankMatchups, recentResults } from '@/lib/pairing';
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
 * @param {object} opts
 * @param {string} opts.courtId
 * @param {{players: string[], team1: string[], team2: string[]}} [opts.outcome] -
 *   pre-resolved matchup (offline replay); when absent the lowest-partnership
 *   split is picked with a random tie-break.
 */
export async function applyFillCourtTx(tx, arenaId, { courtId, outcome }) {
  // Atomically claim the court only if it is still vacant (row-locks it).
  // The arenaId guard also rejects a courtId from another arena.
  const claimed = await tx.court.updateMany({
    where: { id: courtId, arenaId, status: 'vacant' },
    data: { status: 'playing' },
  });
  if (claimed.count !== 1) throw new Error('COURT_UNAVAILABLE');

  // Select the current top 4 inside the tx so we never act on a stale snapshot.
  // Pull queueOrder/waitRounds too so we can snapshot each player's pre-fill
  // rack state onto their slot (lets cancelFill restore them precisely).
  const queued = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    orderBy: { queueOrder: 'asc' },
    take: 4,
    // `rating` feeds the closer-rated tie-break in the team split below.
    select: { id: true, queueOrder: true, waitRounds: true, rating: true },
  });
  if (queued.length < 4) throw new Error('NOT_ENOUGH');

  const [p0, p1, p2, p3] = queued.map((p) => p.id);
  // A recorded outcome must stack exactly the four the transaction sees on
  // top of the rack, split two-a-side over those same four.
  if (
    outcome &&
    !(
      sameMembers(outcome.players, [p0, p1, p2, p3]) &&
      outcome.team1?.length === 2 &&
      outcome.team2?.length === 2 &&
      sameMembers([...outcome.team1, ...outcome.team2], [p0, p1, p2, p3])
    )
  ) {
    throw new Error('OUTCOME_MISMATCH');
  }
  // playerId -> { prevQueueOrder, prevWaitRounds } for the slot snapshot below.
  const snapshot = new Map(
    queued.map((p) => [p.id, { prevQueueOrder: p.queueOrder, prevWaitRounds: p.waitRounds }]),
  );

  // Remove exactly these four from the rack; bail if any slipped away meanwhile.
  // Clear `skipBoosted` too — once a paddle is actually playing, the
  // "Next in Line" stamp has served its purpose.
  const dequeued = await tx.player.updateMany({
    where: { id: { in: [p0, p1, p2, p3] }, queueOrder: { not: null } },
    data: { gamesPlayed: { increment: 1 }, queueOrder: null, waitRounds: 0, skipBoosted: false },
  });
  if (dequeued.count !== 4) throw new Error('QUEUE_CHANGED');

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
    data: { fillBumpedPlayerIds: bumped.map((p) => p.id) },
  });

  // Pair recent losers with recent winners, breaking ties by the closer-rated
  // and then least-repeated split (see src/lib/pairing.js), unless a replayed
  // event already recorded the choice.
  const rows = await tx.partnership.findMany({
    where: { arenaId, playerA: { in: [p0, p1, p2, p3] }, playerB: { in: [p0, p1, p2, p3] } },
  });
  const countFor = (x, y) => {
    const [a, b] = canonicalPair(x, y);
    return rows.find((r) => r.playerA === a && r.playerB === b)?.count ?? 0;
  };

  let best;
  if (outcome) {
    best = { team1: outcome.team1, team2: outcome.team2 };
  } else {
    // Read the arena's pairing mode under the queue lock, mirroring
    // `applyAutoMixTx`, so a concurrent settings save can't land between the
    // read and the split. A torn/missing row falls back to the column default
    // rather than failing a fill the court claim already committed to.
    const arena = await tx.arena.findUnique({
      where: { id: arenaId },
      select: { balancedPairing: true, lastSessionResetAt: true },
    });
    const balanced = arena?.balancedPairing ?? true;

    // Normalize the recent matches into the shape src/lib/pairing.js expects,
    // so this ranks identically to the offline engine's own fill. Legacy mode
    // ignores results entirely, so skip the query in that case.
    //
    // Scoped to the current session: `prepareNextSession` keeps Match rows but
    // wipes `Partnership` so the split "starts the new session unbiased by
    // last week's pairings" — the same reasoning applies to the OTHER input to
    // that split. Without this, the first fills of a new session would pair
    // tonight's arrivals off results from a week ago. The offline engine
    // applies the same cutoff (see `board-engine.js`); match history is not
    // part of the sync fingerprint, so a one-sided change here would silently
    // diverge the two paths.
    const recent = balanced
      ? await tx.match.findMany({
          where: {
            arenaId,
            ...(arena?.lastSessionResetAt ? { createdAt: { gte: arena.lastSessionResetAt } } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: RECENT_MATCH_WINDOW,
          select: { score1: true, score2: true, players: { select: { playerId: true, team: true } } },
        })
      : [];
    const recentMatches = recent.map((m) => ({
      score1: m.score1,
      score2: m.score2,
      team1: m.players.filter((mp) => mp.team === 1).map((mp) => mp.playerId),
      team2: m.players.filter((mp) => mp.team === 2).map((mp) => mp.playerId),
    }));
    const ranked = rankMatchups([p0, p1, p2, p3], {
      results: recentResults(recentMatches, [p0, p1, p2, p3]),
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
    select: { fillBumpedPlayerIds: true },
  });
  const bumpedIds = courtRow?.fillBumpedPlayerIds ?? [];

  // Atomically claim the cancel: only flip playing -> vacant, so a
  // concurrent endMatch/cancelFill for the same court can't double-process.
  // Also clear `fillBumpedPlayerIds` so a vacant court never carries the
  // previous fill's bookkeeping into a future debug session.
  const claimed = await tx.court.updateMany({
    where: { id: courtId, arenaId, status: 'playing' },
    data: { status: 'vacant', fillBumpedPlayerIds: [] },
  });
  if (claimed.count !== 1) throw new Error('NOT_PLAYING');

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
      data: { gamesPlayed: { increment: 1 }, queueOrder: null, waitRounds: 0, skipBoosted: false },
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
  // Also clear the cancel-bookkeeping (`fillBumpedPlayerIds`) so a vacant
  // court never carries the previous fill's metadata.
  const claimed = await tx.court.updateMany({
    where: { id: courtId, arenaId, status: 'playing' },
    data: { status: 'vacant', fillBumpedPlayerIds: [] },
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
 * scoreline gets noticed immediately). If they have played since, the result
 * is their current rating minus this match's contribution — a principled,
 * still zero-sum adjustment rather than the ratings history would have
 * produced. Elo is path-dependent; nothing short of a full replay recovers
 * that, and a replay cannot survive the rating blending a player merge does
 * (see `linkPlayerToMember`).
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
    data: { queueOrder: null, waitRounds: 0, skipBoosted: false },
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

  // Read both relevant arena settings inside the tx so a concurrent
  // settings save can't slip between read and write.
  const arena = await tx.arena.findUnique({
    where: { id: arenaId },
    select: { skipRestoresPriority: true, skipPickReplacement: true },
  });
  if (!arena) return { moved, restoresPriority, replacementError };
  restoresPriority = arena.skipRestoresPriority;

  // Enforce the same eligibility the UI gates on (deriveRackRow.canSkip),
  // server-authoritatively: skip is only valid for an ON-DECK paddle (top
  // ON_DECK_SIZE of the rack) AND only when someone is waiting behind to
  // take the freed spot. Re-checked under the lock so a direct POST can't
  // skip an off-deck paddle and dodge the fairness rules.
  const queued = await tx.player.findMany({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
    orderBy: { queueOrder: 'asc' },
    select: { id: true, queueOrder: true },
  });
  const index = queued.findIndex((p) => p.id === playerId);
  if (index === -1 || index >= ON_DECK_SIZE || queued.length <= ON_DECK_SIZE) {
    return { moved, restoresPriority, replacementError };
  }

  // Manual replacement picking is gated on caller (manager-only), the arena
  // setting, and a valid waiting target. Anything that fails the gate falls
  // back to auto-pick (first waiting). Two distinct failure modes return
  // clean (no-op) errors so the cause is debuggable and the manager knows
  // whether to retry:
  //   - replacement gone from the rack entirely (left / pulled to a court):
  //     a genuine race → "no longer available" (the UI keeps the picker open
  //     so they pick again from the refreshed list).
  //   - replacement is on deck, not waiting: only reachable via a malformed
  //     POST (the picker never lists on-deck rows) → "invalid replacement".
  let replacementIdx = ON_DECK_SIZE; // auto: first waiting
  if (replacementId && isManager && arena.skipPickReplacement) {
    const idx = queued.findIndex((p) => p.id === replacementId);
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

  if (restoresPriority) {
    // On-mode "Next in Line" — the skipped paddle lands just PAST on-deck
    // (position ON_DECK_SIZE+1), the picked replacement fills the freed
    // on-deck slot, and the next auto-mix elevates the skipped paddle via
    // `skipBoosted`. Assemble the target order and write only rows whose
    // position changes — for auto-pick this is bounded to the on-deck
    // window; a manual pick of a deep waiting paddle costs writes
    // proportional to how far it travels (inherent to moving them up).
    const onDeckMinusSkipped = queued.slice(0, ON_DECK_SIZE).filter((_, k) => k !== index);
    const replacement = queued[replacementIdx];
    const waitingMinusReplacement = queued
      .slice(ON_DECK_SIZE)
      .filter((p) => p.id !== replacement.id);
    const reordered = [
      ...onDeckMinusSkipped,
      replacement,
      queued[index],
      ...waitingMinusReplacement,
    ];
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
    //     its on-deck slot, the first waiting paddle promotes by queueOrder
    //     on its own.
    //   - a manual pick takes the skipped paddle's freed slot directly (one
    //     write), leaving everyone else untouched.
    const skippedOrder = queued[index].queueOrder;
    const backOrder = (await maxQueueOrder(tx, arenaId)) + 1;
    if (isManualPick) {
      await tx.player.update({
        where: { id: queued[replacementIdx].id },
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
    default:
      throw new Error('BAD_EVENT');
  }
}
