// Shared server-side loader for the activities list + detail routes.
// Centralizes the arena fetch and the viewer-role resolution so the two routes
// can't drift. Server-only — no `'use client'`.
//
// Underscore-prefixed filename keeps Next.js from treating it as a route segment
// (`/arena/[id]/activities/_load` would otherwise be a public URL) — same
// convention as `settings/_load.js`.

import { notFound } from 'next/navigation';
import { getArena, getArenaMembers } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { canManageArena, ROLES } from '@/lib/roles';

/**
 * Load + resolve the viewer's role for an arena's activity pages.
 *
 * Deliberately does NOT gate on membership: activities are the club's public
 * face — the thing a prospective member wants to look at before joining — so a
 * spectator sees the same list the arena board already shows them. Only the
 * manager affordances are role-gated.
 *
 * Calls `notFound()` for a missing arena, so the caller can use the result
 * directly.
 *
 * @param {string} arenaId
 */
export async function loadArenaForActivities(arenaId) {
  const arena = await getArena(arenaId);
  if (!arena) notFound();

  const [members, user] = await Promise.all([getArenaMembers(arenaId), getCurrentUser()]);

  // `Arena.ownerId` is the canonical owner record (the OWNER membership row only
  // mirrors it), so fall back to it when the viewer is the owner but has no
  // membership row — same reasoning as the arena board route.
  const viewerRole = user
    ? (members.find((m) => m.userId === user.id)?.role ?? (arena.ownerId === user.id ? ROLES.OWNER : null))
    : null;

  return {
    arena,
    viewerRole,
    canManage: canManageArena(viewerRole),
    viewerUserId: user?.id ?? null,
  };
}
