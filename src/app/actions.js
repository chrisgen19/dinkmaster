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

/** Add players (comma-separated names) to the bottom of the rack. */
export async function addPlayers(namesString) {
  const names = (namesString ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (names.length === 0) return { state: await getState() };

  let order = await maxQueueOrder();
  await prisma.$transaction(
    names.map((name) =>
      prisma.player.create({ data: { name, queueOrder: ++order } }),
    ),
  );

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

  await prisma.player.delete({ where: { id: playerId } });
  return { state: await getState() };
}

/** Move a queued player up (-1) or down (+1) one slot. */
export async function moveInQueue(playerId, direction) {
  const queued = await prisma.player.findMany({
    where: { queueOrder: { not: null } },
    orderBy: { queueOrder: 'asc' },
  });

  const index = queued.findIndex((p) => p.id === playerId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= queued.length) {
    return { state: await getState() };
  }

  const a = queued[index];
  const b = queued[target];
  await prisma.$transaction([
    prisma.player.update({ where: { id: a.id }, data: { queueOrder: b.queueOrder } }),
    prisma.player.update({ where: { id: b.id }, data: { queueOrder: a.queueOrder } }),
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

  const shuffled = [...queued].sort(() => Math.random() - 0.5);
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
  const queued = await prisma.player.findMany({
    where: { queueOrder: { not: null } },
    orderBy: { queueOrder: 'asc' },
    take: 4,
    select: { id: true },
  });

  if (queued.length < 4) {
    return {
      error: 'Need at least 4 players stacked in the queue to load a court!',
      state: await getState(),
    };
  }

  const [p0, p1, p2, p3] = queued.map((p) => p.id);

  // Look up existing partnership counts among the four candidates.
  const rows = await prisma.partnership.findMany({
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
  matchups.sort((a, b) => (a.weight !== b.weight ? a.weight - b.weight : Math.random() - 0.5));
  const best = matchups[0];

  await prisma.$transaction(async (tx) => {
    await tx.court.update({ where: { id: courtId }, data: { status: 'playing' } });
    await tx.courtSlot.createMany({
      data: [
        ...best.team1.map((playerId) => ({ courtId, playerId, team: 1 })),
        ...best.team2.map((playerId) => ({ courtId, playerId, team: 2 })),
      ],
    });
    await bumpPartnership(tx, best.team1[0], best.team1[1]);
    await bumpPartnership(tx, best.team2[0], best.team2[1]);
    await tx.player.updateMany({
      where: { id: { in: [p0, p1, p2, p3] } },
      data: { gamesPlayed: { increment: 1 }, queueOrder: null },
    });
  });

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
  const finishedIds = court.slots.map((s) => s.playerId);

  const base = await maxQueueOrder();
  // Recycle finished players back into the rack in randomized order.
  const recycled = [...court.slots].sort(() => Math.random() - 0.5);

  await prisma.$transaction(async (tx) => {
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
  const otherVacant = otherCourts.filter((c) => c.status === 'vacant').length;
  const otherPlaying = otherCourts.filter((c) => c.status === 'playing').length;
  const queuedCount = await prisma.player.count({ where: { queueOrder: { not: null } } });

  let notification = '';
  if (otherVacant > 0 && autoMix && queuedCount >= 8) {
    const queued = await prisma.player.findMany({
      where: { queueOrder: { not: null } },
      select: { id: true },
    });
    const shuffled = [...queued].sort(() => Math.random() - 0.5);
    await prisma.$transaction(
      shuffled.map((p, i) =>
        prisma.player.update({ where: { id: p.id }, data: { queueOrder: i + 1 } }),
      ),
    );
    notification = '⚡ Silo-Buster: Automatically mixed finished players to prevent repetitive court matches!';
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
