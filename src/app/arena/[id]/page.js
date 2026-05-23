import { notFound } from 'next/navigation';
import { getState } from '@/lib/data';
import { getArena, getArenaMembers, getArenaJoinRequests, hasPendingJoinRequest } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { canManageArena } from '@/lib/roles';
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

  const viewerRole = user ? (members.find((m) => m.userId === user.id)?.role ?? null) : null;
  const canManage = canManageArena(viewerRole);

  // Managers see the pending-request queue; a signed-in non-member sees whether
  // their own request is pending.
  const [pendingRequests, viewerPending] = await Promise.all([
    canManage ? getArenaJoinRequests(id) : Promise.resolve([]),
    user && !viewerRole && user.id !== arena.ownerId
      ? hasPendingJoinRequest(id, user.id)
      : Promise.resolve(false),
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
      }}
      matchDefaults={{
        targetScore: arena.targetScore,
        autoMixDefault: arena.autoMixDefault,
        leaderboardSize: arena.leaderboardSize,
        countOffScheduleGames: arena.countOffScheduleGames,
      }}
      canManage={canManage}
      viewerRole={viewerRole}
      viewerUserId={user?.id ?? null}
      isAuthenticated={!!user}
      members={members}
      pendingRequests={pendingRequests}
      viewerPending={viewerPending}
    />
  );
}
