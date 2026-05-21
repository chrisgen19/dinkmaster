import { prisma } from '@/lib/prisma';

/**
 * Build the full arena state in the exact shape the UI consumes, scoped to a
 * single arena.
 *
 * @param {string} arenaId - the arena whose players/courts/matches to read
 * @returns {Promise<{
 *   players: Array<{id:string,name:string,gamesPlayed:number,wins:number,losses:number,waitRounds:number}>,
 *   queue: string[],
 *   courts: Array<{id:string,name:string,status:string,team1:string[],team2:string[]}>,
 *   matchHistory: Array<{id:string,courtName:string,team1:Array<{id:string,name:string}>,team2:Array<{id:string,name:string}>,score1:number,score2:number,timestamp:string}>,
 *   history: Record<string, Record<string, number>>
 * }>}
 */
export async function getState(arenaId) {
  const [players, courts, matches, partnerships] = await Promise.all([
    prisma.player.findMany({ where: { arenaId }, orderBy: { createdAt: 'asc' } }),
    prisma.court.findMany({
      where: { arenaId },
      orderBy: { position: 'asc' },
      include: { slots: true },
    }),
    prisma.match.findMany({
      where: { arenaId },
      orderBy: { createdAt: 'desc' },
      include: { players: true },
    }),
    prisma.partnership.findMany({ where: { arenaId } }),
  ]);

  const queue = players
    .filter((p) => p.queueOrder !== null)
    .sort((a, b) => a.queueOrder - b.queueOrder)
    .map((p) => p.id);

  const courtState = courts.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    team1: c.slots.filter((s) => s.team === 1).map((s) => s.playerId),
    team2: c.slots.filter((s) => s.team === 2).map((s) => s.playerId),
  }));

  // Use the snapshotted names so history survives player deletion.
  const teamSnapshot = (m, team) =>
    m.players.filter((mp) => mp.team === team).map((mp) => ({ id: mp.playerId, name: mp.playerName }));

  const matchHistory = matches.map((m) => ({
    id: m.id,
    courtName: m.courtName,
    team1: teamSnapshot(m, 1),
    team2: teamSnapshot(m, 2),
    score1: m.score1,
    score2: m.score2,
    // ISO string; formatted in the client so it uses the viewer's locale/timezone.
    timestamp: new Date(m.createdAt).toISOString(),
  }));

  // Expand canonical partnership rows into the symmetric matrix the UI reads.
  const history = {};
  for (const { playerA, playerB, count } of partnerships) {
    (history[playerA] ??= {})[playerB] = count;
    (history[playerB] ??= {})[playerA] = count;
  }

  return {
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      gamesPlayed: p.gamesPlayed,
      wins: p.wins,
      losses: p.losses,
      waitRounds: p.waitRounds,
    })),
    queue,
    courts: courtState,
    matchHistory,
    history,
  };
}
