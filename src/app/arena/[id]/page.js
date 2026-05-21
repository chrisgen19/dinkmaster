import { notFound } from 'next/navigation';
import { getState } from '@/lib/data';
import { getArena } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import Arena from '../../arena';

// Always read fresh arena state from the database on each request.
export const dynamic = 'force-dynamic';

export default async function ArenaPage({ params }) {
  const { id } = await params;

  const arena = await getArena(id);
  if (!arena) notFound();

  const [initialState, user] = await Promise.all([getState(id), getCurrentUser()]);
  const canManage = !!user && user.id === arena.ownerId;

  return (
    <Arena
      initialState={initialState}
      arenaId={arena.id}
      arenaName={arena.name}
      canManage={canManage}
    />
  );
}
