import { prisma } from '@/lib/prisma';

/**
 * Build the full arena state in the exact shape the UI consumes.
 * Mirrors the original localStorage structure so the client stays unchanged.
 *
 * @returns {Promise<{
 *   players: Array<{id:string,name:string,gamesPlayed:number,wins:number,losses:number}>,
 *   queue: string[],
 *   courts: Array<{id:string,name:string,status:string,team1:string[],team2:string[]}>,
 *   matchHistory: Array<{id:string,courtName:string,team1:string[],team2:string[],score1:number,score2:number,timestamp:string}>,
 *   history: Record<string, Record<string, number>>
 * }>}
 */
export async function getState() {
  const [players, courts, matches, partnerships] = await Promise.all([
    prisma.player.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.court.findMany({ orderBy: { position: 'asc' }, include: { slots: true } }),
    prisma.match.findMany({ orderBy: { createdAt: 'desc' }, include: { players: true } }),
    prisma.partnership.findMany(),
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

  const matchHistory = matches.map((m) => ({
    id: m.id,
    courtName: m.courtName,
    team1: m.players.filter((mp) => mp.team === 1).map((mp) => mp.playerId),
    team2: m.players.filter((mp) => mp.team === 2).map((mp) => mp.playerId),
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
    })),
    queue,
    courts: courtState,
    matchHistory,
    history,
  };
}
