import { notFound } from 'next/navigation';
import { getState } from '@/lib/data';
import {
  getArena,
  getArenaMembers,
  getArenaJoinRequests,
  hasPendingJoinRequest,
  getArenaLinkRequests,
  getViewerLinkContext,
  getArenaInvites,
} from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { canManageArena, ROLES } from '@/lib/roles';
import Arena from '../../arena';

// Always read fresh arena state from the database on each request.
export const dynamic = 'force-dynamic';

export default async function ArenaPage({ params }) {
  const { id } = await params;

  const arena = await getArena(id);
  if (!arena) notFound();

  const [initialState, members, user] = await Promise.all([
    getState(id),
    getArenaMembers(id),
    getCurrentUser(),
  ]);

  // `Arena.ownerId` is the canonical owner record (the OWNER membership row only
  // mirrors it), so fall back to it when the viewer is the owner but has no
  // membership row — mirroring `requireArenaManager`/`usersShareArena`. Without
  // this an owner missing that mirror row would lose canManage and the rack's
  // name→profile links even though the server still authorizes them.
  const viewerRole = user
    ? (members.find((m) => m.userId === user.id)?.role ??
        (arena.ownerId === user.id ? ROLES.OWNER : null))
    : null;
  const canManage = canManageArena(viewerRole);

  // Managers see the pending-request queue; a signed-in non-member sees whether
  // their own request is pending. Managers also see pending link requests, and
  // every signed-in viewer gets their per-arena link-request context so the
  // Members tab can render the right self-link affordance.
  const [pendingRequests, viewerPending, pendingLinkRequests, viewerLinkContext, invites] =
    await Promise.all([
      canManage ? getArenaJoinRequests(id) : Promise.resolve([]),
      user && !viewerRole && user.id !== arena.ownerId
        ? hasPendingJoinRequest(id, user.id)
        : Promise.resolve(false),
      canManage ? getArenaLinkRequests(id) : Promise.resolve([]),
      // Only arena members (incl. managers) ever interact with the link UI,
      // so spectators skip the three DB queries `getViewerLinkContext` runs.
      user && viewerRole ? getViewerLinkContext(id, user.id) : Promise.resolve(null),
      // Invite links are a manager-only affordance (the hero Share control).
      canManage ? getArenaInvites(id) : Promise.resolve([]),
    ]);

  return (
    <Arena
      initialState={initialState}
      arenaId={arena.id}
      arenaName={arena.name}
      description={arena.description ?? ''}
      schedule={{
        days: arena.scheduleDays,
        start: arena.scheduleStart,
        end: arena.scheduleEnd,
        timezone: arena.timezone,
      }}
      matchmaking={{
        starveThreshold: arena.starveThreshold,
        emergencyWait: arena.emergencyWait,
        skipRestoresPriority: arena.skipRestoresPriority,
        skipPickReplacement: arena.skipPickReplacement,
        balancedPairing: arena.balancedPairing,
      }}
      matchDefaults={{
        targetScore: arena.targetScore,
        autoMixDefault: arena.autoMixDefault,
        leaderboardSize: arena.leaderboardSize,
        countOffScheduleGames: arena.countOffScheduleGames,
        showPartnershipMatrix: arena.showPartnershipMatrix,
      }}
      sessionPrep={{
        autoResetOnSession: arena.autoResetOnSession,
        // ISO string so the client doesn't accidentally serialize a Date.
        lastSessionResetAt: arena.lastSessionResetAt ? arena.lastSessionResetAt.toISOString() : null,
      }}
      canManage={canManage}
      viewerRole={viewerRole}
      viewerUserId={user?.id ?? null}
      isAuthenticated={!!user}
      members={members}
      pendingRequests={pendingRequests}
      viewerPending={viewerPending}
      pendingLinkRequests={pendingLinkRequests}
      viewerLinkContext={viewerLinkContext}
      invites={invites}
    />
  );
}
