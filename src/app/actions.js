'use server';

import { prisma } from '@/lib/prisma';
import { getState } from '@/lib/data';
import { requireUser, requireArenaOwner } from '@/lib/session';
import { STARVE_THRESHOLD, EMERGENCY_WAIT } from '@/lib/matchmaking';

/** Canonical (sorted) pair so each partnership has exactly one row. */
function canonicalPair(x, y) {
  return x < y ? [x, y] : [y, x];
}

/** Increment the partnership count for a pair, creating the row if absent. */
async function bumpPartnership(tx, arenaId, x, y) {
  const [playerA, playerB] = canonicalPair(x, y);
  await tx.partnership.upsert({
    where: { playerA_playerB: { playerA, playerB } },
    create: { arenaId, playerA, playerB, count: 1 },
    update: { count: { increment: 1 } },
  });
}

/** Highest queueOrder currently assigned in an arena, or 0 if the rack is empty. */
async function maxQueueOrder(tx, arenaId) {
  const top = await tx.player.aggregate({ where: { arenaId }, _max: { queueOrder: true } });
  return top._max.queueOrder ?? 0;
}

// App-wide key for a transaction-scoped Postgres advisory lock. Every
// transaction that assigns queueOrder positions takes this lock first, so
// concurrent finishes/adds/shuffles are serialized and can never read the
// same maxQueueOrder and write duplicate positions. The lock is keyed per
// arena (second key) so unrelated arenas never block each other. Released
// on commit/rollback.
const QUEUE_LOCK_KEY = 920425;
function lockQueue(tx, arenaId) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUEUE_LOCK_KEY}, hashtext(${arenaId}))`;
}

/** Unbiased Fisher-Yates shuffle (returns a new array). */
function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- Arena management -----------------------------------------------------

/** Create a new arena owned by the current user, seeded with two courts. */
export async function createArena(nameInput) {
  const guard = await requireUser();
  if (guard.error) return { error: guard.error };

  const name = (nameInput ?? '').trim();
  if (name.length === 0) return { error: 'Please enter an arena name.' };
  if (name.length > 80) return { error: 'Arena name is too long (max 80 characters).' };

  const arena = await prisma.arena.create({
    data: {
      name,
      ownerId: guard.user.id,
      courts: {
        create: [
          { name: 'Court 1', position: 1 },
          { name: 'Court 2', position: 2 },
        ],
      },
    },
  });

  return { arena: { id: arena.id, name: arena.name } };
}

/** Rename an arena (owner only). */
export async function renameArena(arenaId, nameInput) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error };

  const name = (nameInput ?? '').trim();
  if (name.length === 0) return { error: 'Please enter an arena name.' };
  if (name.length > 80) return { error: 'Arena name is too long (max 80 characters).' };

  await prisma.arena.update({ where: { id: arenaId }, data: { name } });
  return { arena: { id: arenaId, name } };
}

// --- Arena play (owner-gated, scoped by arenaId) --------------------------

/** Add players (comma-separated names) to the bottom of the rack. */
export async function addPlayers(arenaId, namesString) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  const names = (namesString ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (names.length === 0) return { state: await getState(arenaId) };

  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // Credit new players the current group's average ordering metric so they
    // slot in as peers (no catch-up advantage for games they weren't here for).
    const existing = await tx.player.findMany({
      where: { arenaId },
      select: { gamesPlayed: true, gamesOffset: true },
    });
    const gamesOffset = existing.length
      ? Math.round(existing.reduce((sum, p) => sum + p.gamesPlayed + p.gamesOffset, 0) / existing.length)
      : 0;
    let order = await maxQueueOrder(tx, arenaId);
    for (const name of names) {
      await tx.player.create({ data: { arenaId, name, queueOrder: ++order, gamesOffset } });
    }
  });

  return { state: await getState(arenaId) };
}

/** Remove a player, unless they are mid-match on a court. */
export async function removePlayer(arenaId, playerId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  let blocked = false;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // Re-check under the lock: a concurrent fillCourt can't slip this player
    // onto a court between the check and the delete (which would cascade the
    // new slot and leave the court with three players).
    const slot = await tx.courtSlot.findFirst({
      where: { playerId, player: { arenaId }, court: { status: 'playing' } },
    });
    if (slot) {
      blocked = true;
      return;
    }
    // Delete the player and their partnership rows together (no FK to cascade
    // these). Both are scoped deleteMany calls: a playerId from another arena —
    // or one already removed by a concurrent call — simply matches zero rows,
    // so there is no P2025 to catch.
    await tx.partnership.deleteMany({
      where: { arenaId, OR: [{ playerA: playerId }, { playerB: playerId }] },
    });
    await tx.player.deleteMany({ where: { id: playerId, arenaId } });
  });

  if (blocked) {
    return {
      error: 'Cannot remove a player currently playing on court! Finish their match first.',
      state: await getState(arenaId),
    };
  }
  return { state: await getState(arenaId) };
}

/** Randomly reorder everyone currently waiting in the rack. */
export async function shuffleQueue(arenaId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  let shuffledAny = false;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // Read the queued set under the lock so we never write a position onto a
    // player a concurrent fillCourt just moved onto a court.
    const queued = await tx.player.findMany({
      where: { arenaId, queueOrder: { not: null } },
      select: { id: true },
    });
    if (queued.length < 2) return;
    const shuffled = shuffle(queued);
    for (let i = 0; i < shuffled.length; i++) {
      await tx.player.update({ where: { id: shuffled[i].id }, data: { queueOrder: i + 1 } });
    }
    shuffledAny = true;
  });

  return {
    notification: shuffledAny
      ? '🔀 Manual Queue Shuffle: All waiting players mixed successfully!'
      : '',
    state: await getState(arenaId),
  };
}

/** Stack the top 4 waiting players onto a court using the lowest-partnership matchup. */
export async function fillCourt(arenaId, courtId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);
      // Atomically claim the court only if it is still vacant (row-locks it).
      // The arenaId guard also rejects a courtId from another arena.
      const claimed = await tx.court.updateMany({
        where: { id: courtId, arenaId, status: 'vacant' },
        data: { status: 'playing' },
      });
      if (claimed.count !== 1) throw new Error('COURT_UNAVAILABLE');

      // Select the current top 4 inside the tx so we never act on a stale snapshot.
      const queued = await tx.player.findMany({
        where: { arenaId, queueOrder: { not: null } },
        orderBy: { queueOrder: 'asc' },
        take: 4,
        select: { id: true },
      });
      if (queued.length < 4) throw new Error('NOT_ENOUGH');

      const [p0, p1, p2, p3] = queued.map((p) => p.id);

      // Remove exactly these four from the rack; bail if any slipped away meanwhile.
      const dequeued = await tx.player.updateMany({
        where: { id: { in: [p0, p1, p2, p3] }, queueOrder: { not: null } },
        data: { gamesPlayed: { increment: 1 }, queueOrder: null, waitRounds: 0 },
      });
      if (dequeued.count !== 4) throw new Error('QUEUE_CHANGED');

      // Everyone still waiting in this arena was skipped this round.
      await tx.player.updateMany({
        where: { arenaId, queueOrder: { not: null } },
        data: { waitRounds: { increment: 1 } },
      });

      // Pick the matchup with the fewest prior partnerships (random tie-break).
      const rows = await tx.partnership.findMany({
        where: { arenaId, playerA: { in: [p0, p1, p2, p3] }, playerB: { in: [p0, p1, p2, p3] } },
      });
      const countFor = (x, y) => {
        const [a, b] = canonicalPair(x, y);
        return rows.find((r) => r.playerA === a && r.playerB === b)?.count ?? 0;
      };
      const matchups = [
        { team1: [p0, p1], team2: [p2, p3], weight: countFor(p0, p1) + countFor(p2, p3) },
        { team1: [p0, p2], team2: [p1, p3], weight: countFor(p0, p2) + countFor(p1, p3) },
        { team1: [p0, p3], team2: [p1, p2], weight: countFor(p0, p3) + countFor(p1, p2) },
      ];
      const minWeight = Math.min(...matchups.map((m) => m.weight));
      const best = shuffle(matchups.filter((m) => m.weight === minWeight))[0];

      await tx.courtSlot.createMany({
        data: [
          ...best.team1.map((playerId) => ({ courtId, playerId, team: 1 })),
          ...best.team2.map((playerId) => ({ courtId, playerId, team: 2 })),
        ],
      });
      await bumpPartnership(tx, arenaId, best.team1[0], best.team1[1]);
      await bumpPartnership(tx, arenaId, best.team2[0], best.team2[1]);
    });
  } catch (err) {
    if (err?.message === 'NOT_ENOUGH') {
      return {
        error: 'Need at least 4 players stacked in the queue to load a court!',
        state: await getState(arenaId),
      };
    }
    // Court taken, queue shifted, or a unique violation (P2002) from a concurrent fill.
    if (err?.code === 'P2002' || ['COURT_UNAVAILABLE', 'QUEUE_CHANGED'].includes(err?.message)) {
      return {
        error: 'The court or queue changed while loading. Please try again.',
        state: await getState(arenaId),
      };
    }
    throw err;
  }

  return { state: await getState(arenaId) };
}

/** Record a finished match's score, update records, and recycle players to the rack. */
export async function endMatch(arenaId, courtId, score1, score2, autoMix) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  const s1 = parseInt(score1, 10) || 0;
  const s2 = parseInt(score2, 10) || 0;
  const team1Won = s1 > s2;
  const team2Won = s2 > s1;

  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);
      // Atomically claim the finish: only one caller can flip playing -> vacant,
      // so concurrent endMatch calls for the same court can't double-record.
      const claimed = await tx.court.updateMany({
        where: { id: courtId, arenaId, status: 'playing' },
        data: { status: 'vacant' },
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
      // Recycle finished players back into the rack in randomized order.
      const recycled = shuffle(slots);

      await tx.match.create({
        data: {
          arenaId,
          courtName: court.name,
          score1: s1,
          score2: s2,
          players: {
            create: slots.map((s) => ({
              playerId: s.playerId,
              playerName: s.player.name,
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

      await tx.courtSlot.deleteMany({ where: { courtId } });

      for (let i = 0; i < recycled.length; i++) {
        await tx.player.update({
          where: { id: recycled[i].playerId },
          data: { queueOrder: base + i + 1 },
        });
      }
    });
  } catch (err) {
    // Court was already finished/vacant (a concurrent or duplicate call won) — no-op.
    if (err?.message === 'ALREADY_FINISHED') return { state: await getState(arenaId) };
    throw err;
  }

  // Decide whether to auto-mix (Silo-Buster) based on the other courts' state.
  const otherCourts = await prisma.court.findMany({
    where: { arenaId, id: { not: courtId } },
  });
  const otherPlaying = otherCourts.filter((c) => c.status === 'playing').length;
  const queuedCount = await prisma.player.count({
    where: { arenaId, queueOrder: { not: null } },
  });

  let notification = '';
  // Mix the whole rack on every finish (when enabled and more than one court's
  // worth of players are waiting, so the next four can actually differ) — this
  // stops the same group of four from locking together every round.
  if (autoMix && queuedCount > 4) {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);
      // Read the queued set under the lock so a concurrent fillCourt can't make
      // us reassign a position to a player who is now on a court.
      const queued = await tx.player.findMany({
        where: { arenaId, queueOrder: { not: null } },
        select: { id: true, gamesPlayed: true, gamesOffset: true, waitRounds: true },
      });
      if (queued.length === 0) return;
      // Sort lexicographically: band first (emergency > protected > fresh),
      // then in the emergency band strictly by wait, then by FEWEST games
      // played-since-joining (gamesPlayed + gamesOffset, so a player who has
      // played less goes ahead but a late joiner can't hog), then a random
      // tie-break for variety among equals.
      const bandOf = (w) =>
        w >= EMERGENCY_WAIT ? 2 : w >= STARVE_THRESHOLD ? 1 : 0;
      const scored = queued
        .map((p) => ({
          id: p.id,
          band: bandOf(p.waitRounds),
          waitRounds: p.waitRounds,
          games: p.gamesPlayed + p.gamesOffset,
          rand: Math.random(),
        }))
        .sort((a, b) => {
          if (a.band !== b.band) return b.band - a.band; // emergency > protected > fresh
          if (a.band === 2 && a.waitRounds !== b.waitRounds) return b.waitRounds - a.waitRounds; // strict longest-first
          if (a.games !== b.games) return a.games - b.games; // fewest games-since-joining first
          return a.rand - b.rand; // random tie-break among equals
        });
      for (let i = 0; i < scored.length; i++) {
        await tx.player.update({ where: { id: scored[i].id }, data: { queueOrder: i + 1 } });
      }
    });
    notification = '⚡ Silo-Buster: Mixed the rack (longest-waiting up next) to keep matchups fresh and fair!';
  } else if (otherPlaying > 0) {
    notification = '💡 Recommended: Wait for other courts to finish before stacking again, to allow a complete mix of player pools!';
  }

  return { notification, state: await getState(arenaId) };
}

/** Add a new vacant court at the end. */
export async function addCourt(arenaId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  // Serialize under the queue lock so concurrent adds can't read the same
  // count/position and create duplicate court names/positions.
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    const count = await tx.court.count({ where: { arenaId } });
    const position =
      (await tx.court.aggregate({ where: { arenaId }, _max: { position: true } }))._max.position ?? 0;
    await tx.court.create({
      data: { arenaId, name: `Court ${count + 1}`, position: position + 1 },
    });
  });
  return { state: await getState(arenaId) };
}

/** Remove a court, unless a game is in progress on it. */
export async function removeCourt(arenaId, courtId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  let blocked = false;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // Conditional delete under the lock: only remove the court if it is still
    // vacant, so it can't race a concurrent fillCourt that just claimed it
    // (which would cascade-delete the new slots and strand its players).
    const deleted = await tx.court.deleteMany({
      where: { id: courtId, arenaId, status: 'vacant' },
    });
    if (deleted.count === 0) {
      // Nothing deleted: either it's now playing, or already gone. Scope the
      // lookup to this arena so a courtId from another arena reports as gone
      // (not as a misleading "active game").
      const stillThere = await tx.court.findFirst({
        where: { id: courtId, arenaId },
        select: { id: true },
      });
      if (stillThere) blocked = true; // exists but not vacant -> active game
    }
  });

  if (blocked) {
    return { error: 'Cannot remove a court with an active game!', state: await getState(arenaId) };
  }
  return { state: await getState(arenaId) };
}

/**
 * Reset the arena session: clear match history, partnership counts, and live
 * court assignments, and send every player back to the rack with fresh stats.
 * Players and courts themselves are kept.
 */
export async function resetArena(arenaId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // Wipe history and live state for this arena only.
    await tx.match.deleteMany({ where: { arenaId } }); // cascades MatchPlayer
    await tx.courtSlot.deleteMany({ where: { court: { arenaId } } });
    await tx.partnership.deleteMany({ where: { arenaId } });
    await tx.court.updateMany({ where: { arenaId }, data: { status: 'vacant' } });

    // Send every player back to the rack with cleared stats.
    const players = await tx.player.findMany({
      where: { arenaId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    for (let i = 0; i < players.length; i++) {
      await tx.player.update({
        where: { id: players[i].id },
        data: { gamesPlayed: 0, wins: 0, losses: 0, waitRounds: 0, gamesOffset: 0, queueOrder: i + 1 },
      });
    }
  });

  return { state: await getState(arenaId) };
}
