// Shared server-side loader for the settings index + per-section routes.
// Centralizes the auth gate (`canManageArena` → redirect), the arena fetch,
// and the prop bundle shape so the two routes don't drift in what they pass
// to <ArenaSettings>. Server-only — no `'use client'`.
//
// Underscore-prefixed filename keeps Next.js from treating it as a route
// segment (e.g. `/arena/[id]/settings/_load` would otherwise be a public URL).

import { notFound, redirect } from 'next/navigation';
import { getArena, getArenaMembers } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { canManageArena } from '@/lib/roles';

/**
 * Load + authorize, then return the full prop bundle for <ArenaSettings>.
 * Calls `notFound()` for a missing arena and `redirect()` for non-managers,
 * so the caller can use the return value directly.
 *
 * @param {string} arenaId
 * @returns {Promise<{props: object}>}
 */
export async function loadArenaForSettings(arenaId) {
  const arena = await getArena(arenaId);
  if (!arena) notFound();

  const [members, user] = await Promise.all([getArenaMembers(arenaId), getCurrentUser()]);
  const viewerRole = user ? (members.find((m) => m.userId === user.id)?.role ?? null) : null;
  if (!canManageArena(viewerRole)) redirect(`/arena/${arenaId}`);

  return {
    arena,
    props: {
      arenaId: arena.id,
      arenaName: arena.name,
      description: arena.description ?? '',
      schedule: {
        days: arena.scheduleDays,
        start: arena.scheduleStart,
        end: arena.scheduleEnd,
        timezone: arena.timezone,
      },
      matchmaking: {
        starveThreshold: arena.starveThreshold,
        emergencyWait: arena.emergencyWait,
        skipRestoresPriority: arena.skipRestoresPriority,
        skipPickReplacement: arena.skipPickReplacement,
      },
      matchDefaults: {
        targetScore: arena.targetScore,
        autoMixDefault: arena.autoMixDefault,
        leaderboardSize: arena.leaderboardSize,
        countOffScheduleGames: arena.countOffScheduleGames,
        showPartnershipMatrix: arena.showPartnershipMatrix,
      },
      sessions: {
        autoResetOnSession: arena.autoResetOnSession,
        lastSessionResetAt: arena.lastSessionResetAt ? arena.lastSessionResetAt.toISOString() : null,
      },
      activities: {
        rsvpEnabled: arena.rsvpEnabled,
        defaultActivityCapacity: arena.defaultActivityCapacity,
        activityHorizonDays: arena.activityHorizonDays,
      },
      isOwner: viewerRole === 'OWNER',
      viewerUserId: user?.id ?? null,
      members,
    },
  };
}
