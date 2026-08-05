import { notFound } from 'next/navigation';
import { SiteHeader } from '@/app/site-header';
import { AuthStatus } from '@/app/auth-status';
import { ArenaActivityDetail } from '@/app/arena-activity-detail';
import { getActivityDetail } from '@/lib/activities-server';
import { computeActivityStandings } from '@/lib/activities';
import { loadArenaForActivities } from '../_load';

export const dynamic = 'force-dynamic';

/**
 * One activity (`/arena/[id]/activities/[activityId]`) — the night's record:
 * standings, every match played, and who came.
 *
 * Standings are computed on the server with the same pure function the arena
 * board uses, so a past night and the live board can never disagree about a
 * player's record.
 */
export default async function ArenaActivityPage({ params }) {
  const { id, activityId } = await params;

  const { arena, canManage, viewerRole, viewerUserId } = await loadArenaForActivities(id);
  const activity = await getActivityDetail(activityId, { viewerUserId });

  // Check ownership explicitly: without it, an activity id from another club
  // would render here under this arena's name.
  if (!activity || activity.arenaId !== id) notFound();

  const { standings, gameCount, playerCount } = computeActivityStandings({
    matches: activity.matches,
    activityId: activity.id,
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="arena" arenaName={arena.name}>
        <AuthStatus />
      </SiteHeader>
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-6 lg:p-8">
        <ArenaActivityDetail
          arenaId={arena.id}
          activity={activity}
          standings={standings}
          gameCount={gameCount}
          playerCount={playerCount}
          canManage={canManage}
          // Members answer for themselves; spectators see the record only.
          canRsvp={arena.rsvpEnabled && !!viewerRole}
        />
      </main>
    </div>
  );
}
