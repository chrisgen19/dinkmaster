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

/**
 * List an arena's members (oldest first) with user details and role.
 * @param {string} arenaId
 * @returns {Promise<Array<{membershipId:string,userId:string,name:string,email:string,role:string}>>}
 */
export async function getArenaMembers(arenaId) {
  const members = await prisma.arenaMembership.findMany({
    where: { arenaId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return members.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
  }));
}

/**
 * All of a user's arena memberships, as `{ arenaId, role }` rows — used to
 * badge the directory.
 * @param {string} userId
 */
export async function getUserMemberships(userId) {
  return prisma.arenaMembership.findMany({
    where: { userId },
    select: { arenaId: true, role: true },
  });
}
