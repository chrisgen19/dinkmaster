import { SiteHeader } from '@/app/site-header';
import { AuthStatus } from '@/app/auth-status';
import { ArenaActivitiesList } from '@/app/arena-activities-list';
import { ensureUpcomingActivities, listActivities } from '@/lib/activities-server';
import { loadArenaForActivities } from './_load';

// Activities reflect live schedule + attendance state; never serve a cached copy.
export const dynamic = 'force-dynamic';

/**
 * Activities index (`/arena/[id]/activities`) — the club's calendar.
 *
 * Upcoming/Past is a real URL (`?scope=past`) rather than client tab state, so
 * a manager can link someone straight to a past night's list and the back
 * button behaves. Same reasoning as the settings section nav.
 */
export default async function ArenaActivitiesPage({ params, searchParams }) {
  const { id } = await params;
  const { scope: rawScope } = (await searchParams) ?? {};
  const scope = rawScope === 'past' ? 'past' : 'upcoming';

  const { arena, canManage, viewerRole, viewerUserId } = await loadArenaForActivities(id);

  // Materialize before reading. Idempotent, so calling it on every load is
  // safe and makes the page self-healing: a club that goes quiet for two
  // months still gets a correct list the moment someone opens this.
  await ensureUpcomingActivities(id);

  // One instant for both the query and the client's badge derivation, so a row
  // near its boundary can't be classified one way here and another after
  // hydration.
  const now = new Date();
  const activities = await listActivities(id, { scope, now, viewerUserId });

  // RSVP is for members answering for themselves — spectators and non-members
  // see the calendar but no buttons.
  const canRsvp = arena.rsvpEnabled && !!viewerRole;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="arena" arenaName={arena.name}>
        <AuthStatus />
      </SiteHeader>
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-6 lg:p-8">
        <ArenaActivitiesList
          arenaId={arena.id}
          arenaName={arena.name}
          activities={activities}
          scope={scope}
          canManage={canManage}
          hasSchedule={arena.scheduleDays.length > 0}
          nowIso={now.toISOString()}
          timezone={arena.timezone}
          canRsvp={canRsvp}
        />
      </main>
    </div>
  );
}
