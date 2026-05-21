import { notFound } from 'next/navigation';
import { getState } from '@/lib/data';
import { getArena, getArenaMembers, getArenaJoinRequests } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { canManageArena } from '@/lib/roles';
import { prisma } from '@/lib/prisma';
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
      ? prisma.joinRequest
          .findUnique({ where: { arenaId_userId: { arenaId: id, userId: user.id } } })
          .then((r) => !!r)
      : Promise.resolve(false),
  ]);

  return (
    <Arena
      initialState={initialState}
      arenaId={arena.id}
      arenaName={arena.name}
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
