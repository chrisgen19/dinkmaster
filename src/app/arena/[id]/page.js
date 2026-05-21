import { notFound } from 'next/navigation';
import { getState } from '@/lib/data';
import { getArena, getArenaMembers } from '@/lib/arenas';
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

  return (
    <Arena
      initialState={initialState}
      arenaId={arena.id}
      arenaName={arena.name}
      canManage={canManageArena(viewerRole)}
      viewerRole={viewerRole}
      viewerUserId={user?.id ?? null}
      isAuthenticated={!!user}
      members={members}
    />
  );
}
