import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ROLES } from '@/lib/roles';

/**
 * Resolve the current signed-in user from the request cookies.
 * @returns {Promise<{id:string,name:string,email:string}|null>}
 */
export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * Guard for server actions that mutate the arena. Returns the user when
 * authenticated, or an `{ error }` the action can hand straight back to the
 * client (the arena UI surfaces `result.error` as a notice).
 *
 * @returns {Promise<{user:object}|{error:string}>}
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return { error: 'Please sign in to manage the arena.' };
  return { user };
}

/**
 * Guard for arena mutations: the caller must be signed in AND own the arena.
 * Returns the user and arena when authorized, otherwise an `{ error }`.
 *
 * @param {string} arenaId
 * @returns {Promise<{user:object,arena:object}|{error:string}>}
 */
export async function requireArenaOwner(arenaId) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Please sign in to manage this arena.' };
  if (!arenaId) return { error: 'Arena not found.' };

  const arena = await prisma.arena.findUnique({ where: { id: arenaId } });
  if (!arena) return { error: 'Arena not found.' };
  if (arena.ownerId !== user.id) {
    return { error: 'Only the arena owner can manage this arena.' };
  }
  return { user, arena };
}

/**
 * Guard for arena play actions: the caller must be signed in and be the
 * arena's owner OR an organizer. Returns the user, arena, and resolved role
 * when authorized, otherwise an `{ error }`.
 *
 * @param {string} arenaId
 * @returns {Promise<{user:object,arena:object,role:string}|{error:string}>}
 */
export async function requireArenaManager(arenaId) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Please sign in to manage this arena.' };
  if (!arenaId) return { error: 'Arena not found.' };

  const arena = await prisma.arena.findUnique({ where: { id: arenaId } });
  if (!arena) return { error: 'Arena not found.' };
  if (arena.ownerId === user.id) return { user, arena, role: ROLES.OWNER };

  const membership = await prisma.arenaMembership.findUnique({
    where: { arenaId_userId: { arenaId, userId: user.id } },
  });
  if (membership?.role === ROLES.ORGANIZER) {
    return { user, arena, role: ROLES.ORGANIZER };
  }
  return { error: 'Only the arena owner or an organizer can manage this arena.' };
}
