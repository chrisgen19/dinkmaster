import { notFound, redirect } from 'next/navigation';
import { getArena, getArenaMembers } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { canManageArena } from '@/lib/roles';
import { ArenaSettings } from '../../../arena-settings';

// Settings reads/writes live arena config; never serve a cached copy.
export const dynamic = 'force-dynamic';

/**
 * Owner/organizer settings for one arena. Non-managers are bounced back to the
 * arena view; the page itself only renders for managers, and owner-only
 * controls (Danger Zone) are further gated inside the client component and the
 * server actions they call.
 */
export default async function ArenaSettingsPage({ params }) {
  const { id } = await params;

  const arena = await getArena(id);
  if (!arena) notFound();

  const [members, user] = await Promise.all([getArenaMembers(id), getCurrentUser()]);
  const viewerRole = user ? (members.find((m) => m.userId === user.id)?.role ?? null) : null;

  // Managers only — everyone else goes back to the public arena view.
  if (!canManageArena(viewerRole)) redirect(`/arena/${id}`);

  const isOwner = viewerRole === 'OWNER';

  return (
    <ArenaSettings
      arenaId={arena.id}
      arenaName={arena.name}
      description={arena.description ?? ''}
      schedule={{
        days: arena.scheduleDays,
        start: arena.scheduleStart,
        end: arena.scheduleEnd,
        timezone: arena.timezone,
      }}
      isOwner={isOwner}
      viewerUserId={user?.id ?? null}
      members={members}
    />
  );
}
