'use server';

import { prisma } from '@/lib/prisma';
import { getState } from '@/lib/data';

/** Default roster used on first load and when the arena is reset. */
const DEFAULT_PLAYERS = [
  { id: 'p1', name: 'Alex Thompson', gamesPlayed: 3, wins: 2, losses: 1 },
  { id: 'p2', name: 'Sarah Miller', gamesPlayed: 3, wins: 1, losses: 2 },
  { id: 'p3', name: 'Dave Chappell', gamesPlayed: 2, wins: 1, losses: 1 },
  { id: 'p4', name: 'Emma Watson', gamesPlayed: 2, wins: 2, losses: 0 },
  { id: 'p5', name: 'Chris Evans', gamesPlayed: 1, wins: 0, losses: 1 },
  { id: 'p6', name: 'Jessica Alba', gamesPlayed: 1, wins: 1, losses: 0 },
  { id: 'p7', name: 'John Doe', gamesPlayed: 0, wins: 0, losses: 0 },
  { id: 'p8', name: 'Jane Smith', gamesPlayed: 0, wins: 0, losses: 0 },
  { id: 'p9', name: 'Michael Jordan', gamesPlayed: 0, wins: 0, losses: 0 },
  { id: 'p10', name: 'Serena Williams', gamesPlayed: 0, wins: 0, losses: 0 },
];

const DEFAULT_COURTS = [
  { id: 'c1', name: 'Court 1 (Championship)', position: 1 },
  { id: 'c2', name: 'Court 2 (North)', position: 2 },
];

const DEFAULT_PARTNERSHIPS = [
  { playerA: 'p1', playerB: 'p2', count: 2 },
  { playerA: 'p1', playerB: 'p3', count: 1 },
  { playerA: 'p3', playerB: 'p4', count: 1 },
];

// Auto-mix ordering. Players who have waited >= STARVE_THRESHOLD rounds (the
// ⏳ badge threshold) are a protected tier: they always rank ahead of anyone
// fresher, so randomness can never bump a waiting player out of the on-deck
// four. Below that, wait 0 and 1 mix freely so the same foursome can't lock
// together. Within either tier, ordering is GAMES (gently evens totals /
// integrates newcomers) plus RANDOM (the actual mixing).
const STARVE_THRESHOLD = 2;
const GAMES_WEIGHT = 0.15;
const RANDOM_WEIGHT = 2.5;

/** Canonical (sorted) pair so each partnership has exactly one row. */
function canonicalPair(x, y) {
  return x < y ? [x, y] : [y, x];
}

/** Increment the partnership count for a pair, creating the row if absent. */
async function bumpPartnership(tx, x, y) {
  const [playerA, playerB] = canonicalPair(x, y);
  await tx.partnership.upsert({
    where: { playerA_playerB: { playerA, playerB } },
    create: { playerA, playerB, count: 1 },
    update: { count: { increment: 1 } },
  });
}

/** Highest queueOrder currently assigned, or 0 if the rack is empty. */
async function maxQueueOrder(tx = prisma) {
  const top = await tx.player.aggregate({ _max: { queueOrder: true } });
  return top._max.queueOrder ?? 0;
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

/** Add players (comma-separated names) to the bottom of the rack. */
export async function addPlayers(namesString) {
  const names = (namesString ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (names.length === 0) return { state: await getState() };

  await prisma.$transaction(async (tx) => {
    let order = await maxQueueOrder(tx);
    for (const name of names) {
      await tx.player.create({ data: { name, queueOrder: ++order } });
    }
  });

  return { state: await getState() };
}

/** Remove a player, unless they are mid-match on a court. */
export async function removePlayer(playerId) {
  const slot = await prisma.courtSlot.findFirst({
    where: { playerId, court: { status: 'playing' } },
  });
  if (slot) {
    return {
      error: 'Cannot remove a player currently playing on court! Finish their match first.',
      state: await getState(),
    };
  }

  // Delete the player and their partnership rows together (no FK to cascade these).
  await prisma.$transaction([
    prisma.partnership.deleteMany({
      where: { OR: [{ playerA: playerId }, { playerB: playerId }] },
    }),
    prisma.player.delete({ where: { id: playerId } }),
  ]);

  return { state: await getState() };
}

/** Randomly reorder everyone currently waiting in the rack. */
export async function shuffleQueue() {
  const queued = await prisma.player.findMany({
    where: { queueOrder: { not: null } },
    select: { id: true },
  });
  if (queued.length < 2) return { state: await getState() };

  const shuffled = shuffle(queued);
  await prisma.$transaction(
    shuffled.map((p, i) =>
      prisma.player.update({ where: { id: p.id }, data: { queueOrder: i + 1 } }),
    ),
  );

  return {
    notification: '🔀 Manual Queue Shuffle: All waiting players mixed successfully!',
    state: await getState(),
  };
}

/** Stack the top 4 waiting players onto a court using the lowest-partnership matchup. */
export async function fillCourt(courtId) {
  try {
    await prisma.$transaction(async (tx) => {
      // Atomically claim the court only if it is still vacant (row-locks it).
      const claimed = await tx.court.updateMany({
        where: { id: courtId, status: 'vacant' },
        data: { status: 'playing' },
      });
      if (claimed.count !== 1) throw new Error('COURT_UNAVAILABLE');

      // Select the current top 4 inside the tx so we never act on a stale snapshot.
      const queued = await tx.player.findMany({
        where: { queueOrder: { not: null } },
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

      // Everyone still waiting was skipped this round.
      await tx.player.updateMany({
        where: { queueOrder: { not: null } },
        data: { waitRounds: { increment: 1 } },
      });

      // Pick the matchup with the fewest prior partnerships (random tie-break).
      const rows = await tx.partnership.findMany({
        where: { playerA: { in: [p0, p1, p2, p3] }, playerB: { in: [p0, p1, p2, p3] } },
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
      await bumpPartnership(tx, best.team1[0], best.team1[1]);
      await bumpPartnership(tx, best.team2[0], best.team2[1]);
    });
  } catch (err) {
    if (err?.message === 'NOT_ENOUGH') {
      return {
        error: 'Need at least 4 players stacked in the queue to load a court!',
        state: await getState(),
      };
    }
    // Court taken, queue shifted, or a unique violation (P2002) from a concurrent fill.
    if (err?.code === 'P2002' || ['COURT_UNAVAILABLE', 'QUEUE_CHANGED'].includes(err?.message)) {
      return {
        error: 'The court or queue changed while loading. Please try again.',
        state: await getState(),
      };
    }
    throw err;
  }

  return { state: await getState() };
}

/** Record a finished match's score, update records, and recycle players to the rack. */
export async function endMatch(courtId, score1, score2, autoMix) {
  const court = await prisma.court.findUnique({
    where: { id: courtId },
    include: { slots: { include: { player: true } } },
  });
  if (!court || court.status !== 'playing') return { state: await getState() };

  const s1 = parseInt(score1, 10) || 0;
  const s2 = parseInt(score2, 10) || 0;
  const team1Won = s1 > s2;
  const team2Won = s2 > s1;

  const team1 = court.slots.filter((s) => s.team === 1);
  const team2 = court.slots.filter((s) => s.team === 2);

  await prisma.$transaction(async (tx) => {
    const base = await maxQueueOrder(tx);
    // Recycle finished players back into the rack in randomized order.
    const recycled = shuffle(court.slots);

    await tx.match.create({
      data: {
        courtName: court.name,
        score1: s1,
        score2: s2,
        players: {
          create: court.slots.map((s) => ({
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
    await tx.court.update({ where: { id: courtId }, data: { status: 'vacant' } });

    for (let i = 0; i < recycled.length; i++) {
      await tx.player.update({
        where: { id: recycled[i].playerId },
        data: { queueOrder: base + i + 1 },
      });
    }
  });

  // Decide whether to auto-mix (Silo-Buster) based on the other courts' state.
  const otherCourts = await prisma.court.findMany({ where: { id: { not: courtId } } });
  const otherPlaying = otherCourts.filter((c) => c.status === 'playing').length;
  const queuedCount = await prisma.player.count({ where: { queueOrder: { not: null } } });

  let notification = '';
  // Mix the whole rack on every finish (when enabled and more than one court's
  // worth of players are waiting, so the next four can actually differ) — this
  // stops the same group of four from locking together every round.
  if (autoMix && queuedCount > 4) {
    const queued = await prisma.player.findMany({
      where: { queueOrder: { not: null } },
      select: { id: true, gamesPlayed: true, waitRounds: true },
    });
    // Tiered fairness: anyone past the starvation threshold is protected and
    // ordered by how long they've waited; everyone else mixes by games+random.
    const maxGames = Math.max(...queued.map((p) => p.gamesPlayed));
    const scored = queued
      .map((p) => ({
        id: p.id,
        tier: p.waitRounds >= STARVE_THRESHOLD ? p.waitRounds : 0,
        mix: GAMES_WEIGHT * (maxGames - p.gamesPlayed) + RANDOM_WEIGHT * Math.random(),
      }))
      .sort((a, b) => b.tier - a.tier || b.mix - a.mix);
    await prisma.$transaction(
      scored.map((p, i) =>
        prisma.player.update({ where: { id: p.id }, data: { queueOrder: i + 1 } }),
      ),
    );
    notification = '⚡ Silo-Buster: Mixed the rack (longest-waiting up next) to keep matchups fresh and fair!';
  } else if (otherPlaying > 0) {
    notification = '💡 Recommended: Wait for other courts to finish before stacking again, to allow a complete mix of player pools!';
  }

  return { notification, state: await getState() };
}

/** Add a new vacant court at the end. */
export async function addCourt() {
  const count = await prisma.court.count();
  const position = (await prisma.court.aggregate({ _max: { position: true } }))._max.position ?? 0;
  await prisma.court.create({
    data: { name: `Court ${count + 1}`, position: position + 1 },
  });
  return { state: await getState() };
}

/** Remove a court, unless a game is in progress on it. */
export async function removeCourt(courtId) {
  const court = await prisma.court.findUnique({ where: { id: courtId } });
  if (court?.status === 'playing') {
    return { error: 'Cannot remove a court with an active game!', state: await getState() };
  }
  await prisma.court.delete({ where: { id: courtId } });
  return { state: await getState() };
}

/** Wipe the arena and restore the default roster, courts, and partnerships. */
export async function resetArena() {
  await prisma.$transaction(async (tx) => {
    await tx.matchPlayer.deleteMany();
    await tx.match.deleteMany();
    await tx.courtSlot.deleteMany();
    await tx.court.deleteMany();
    await tx.partnership.deleteMany();
    await tx.player.deleteMany();

    await tx.player.createMany({
      data: DEFAULT_PLAYERS.map((p, i) => ({ ...p, queueOrder: i + 1 })),
    });
    await tx.court.createMany({ data: DEFAULT_COURTS });
    await tx.partnership.createMany({ data: DEFAULT_PARTNERSHIPS });
  });

  return { state: await getState() };
}
