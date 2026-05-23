// Server-only read for the weekly leaderboard. Kept separate from the pure
// `leaderboard.js` so the ranking math can be imported into client components
// (the arena "This Week" tab) without pulling Prisma into the browser bundle.

import { prisma } from '@/lib/prisma';
import { computeWeeklyLeaderboard, weekWindow, DEFAULT_TIMEZONE, LEADERBOARD_SIZE } from '@/lib/leaderboard';

/**
 * This week's leaderboard for one arena. Fetches the arena schedule and the
 * week's matches, then ranks with the shared pure function.
 * @param {string} arenaId
 * @param {{now?: Date, limit?: number}} [opts]
 */
export async function getWeeklyLeaderboard(arenaId, { now, limit = LEADERBOARD_SIZE } = {}) {
  if (!arenaId) throw new Error('getWeeklyLeaderboard requires an arenaId');

  const arena = await prisma.arena.findUnique({
    where: { id: arenaId },
    select: { scheduleDays: true, timezone: true },
  });
  const timeZone = arena?.timezone || DEFAULT_TIMEZONE;
  const { start, end } = weekWindow(now ? new Date(now) : new Date(), timeZone);

  const matches = await prisma.match.findMany({
    where: { arenaId, createdAt: { gte: start, lt: end } },
    include: { players: true },
    orderBy: { createdAt: 'asc' },
  });

  const shaped = matches.map((m) => ({
    score1: m.score1,
    score2: m.score2,
    timestamp: new Date(m.createdAt).toISOString(),
    team1: m.players
      .filter((p) => p.team === 1)
      .map((p) => ({ id: p.playerId, firstName: p.playerFirstName, lastName: p.playerLastName })),
    team2: m.players
      .filter((p) => p.team === 2)
      .map((p) => ({ id: p.playerId, firstName: p.playerFirstName, lastName: p.playerLastName })),
  }));

  return computeWeeklyLeaderboard({
    matches: shaped,
    schedule: { days: arena?.scheduleDays ?? [], timezone: timeZone },
    now,
    limit,
  });
}
