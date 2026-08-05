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
import { ensureUpcomingActivities, getActivityAttendees, listActivities } from '@/lib/activities-server';
import Arena from '../../arena';

// Always read fresh arena state from the database on each request.
export const dynamic = 'force-dynamic';

export default async function ArenaPage({ params }) {
  const { id } = await params;

  const arena = await getArena(id);
  if (!arena) notFound();

  // Materialize before reading state so the prep banner always has a concrete
  // row to point its CTA at. Idempotent, so this is a single indexed read once
  // the horizon is already populated.
  await ensureUpcomingActivities(id);

  const now = new Date();
  const [initialState, members, user, upcoming, recent] = await Promise.all([
    getState(id),
    getArenaMembers(id),
    getCurrentUser(),
    listActivities(id, { scope: 'upcoming', now, take: 4 }),
    // The Activities tab shows a short digest of recent nights; the full list
    // lives on the dedicated route.
    listActivities(id, { scope: 'past', now, take: 3 }),
  ]);

  // The session the banner offers to prep: soonest by start, skipping any whose
  // window has already closed.
  //
  // That last clause is the whole subtlety. The upcoming list always includes
  // the LIVE activity, and a night the manager never closed sorts FIRST (its
  // start is the earliest) while being pure history. Dropping ended windows
  // leaves the genuine next session — and crucially does NOT drop the open
  // activity when the manager has already prepped ahead, so the banner's
  // `prepared` identity check (currentActivity.id === nextActivity.id) can
  // still come back true.
  const nextActivity = upcoming.find((a) => new Date(a.endsAt) > now) ?? null;

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

  // RSVPs for the open activity, for the prep roster's "going" chips and bulk
  // check-in. Managers only — nobody else can act on them, so nobody else pays
  // for the query.
  const activityAttendees =
    canManage && initialState.currentActivity
      ? await getActivityAttendees(initialState.currentActivity.id)
      : [];

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
      nextActivity={nextActivity}
      activityAttendees={activityAttendees}
      upcomingActivities={upcoming}
      recentActivities={recent}
      activitiesNowIso={now.toISOString()}
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
