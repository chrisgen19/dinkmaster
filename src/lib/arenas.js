import { prisma } from '@/lib/prisma';

/**
 * List every arena for the public directory, with owner and content counts.
 * @returns {Promise<Array<{id:string,name:string,ownerId:string,ownerName:string,playerCount:number,courtCount:number,matchCount:number}>>}
 */
export async function listArenas() {
  const arenas = await prisma.arena.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { players: true, courts: true, matches: true } },
    },
  });

  return arenas.map((a) => ({
    id: a.id,
    name: a.name,
    ownerId: a.ownerId,
    ownerName: a.owner.name,
    playerCount: a._count.players,
    courtCount: a._count.courts,
    matchCount: a._count.matches,
  }));
}

/**
 * Fetch one arena with its owner, or null if it does not exist.
 * @param {string} id
 */
export async function getArena(id) {
  return prisma.arena.findUnique({
    where: { id },
    include: { owner: { select: { id: true, name: true } } },
  });
}
