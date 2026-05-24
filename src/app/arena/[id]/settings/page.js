import { notFound, redirect } from 'next/navigation';
import { getArena, getArenaMembers } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { canManageArena } from '@/lib/roles';
import { SiteHeader } from '@/app/site-header';
import { AuthStatus } from '@/app/auth-status';
import { ArenaSettings } from '@/app/arena-settings';

// Settings reads/writes live arena config; never serve a cached copy.
export const dynamic = 'force-dynamic';

/**
 * Owner/organizer settings for one arena. Non-managers are bounced back to the
 * arena view; the page itself only renders for managers. Within Danger Zone,
 * reset is manager-accessible while transfer/delete are owner-only — gated in
 * the client component and re-enforced by the server actions they call.
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
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="arena" arenaName={arena.name}>
        <AuthStatus />
      </SiteHeader>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
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
          sessions={{
            autoResetOnSession: arena.autoResetOnSession,
            lastSessionResetAt: arena.lastSessionResetAt ? arena.lastSessionResetAt.toISOString() : null,
          }}
          isOwner={isOwner}
          viewerUserId={user?.id ?? null}
          members={members}
        />
      </main>
    </div>
  );
}
