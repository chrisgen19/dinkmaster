// Server-only reads and materialization for Activities. Kept separate from the
// pure `activities.js` so the window math and tallies can be imported into
// client components without pulling Prisma into the browser bundle — the same
// split as leaderboard.js / leaderboard-server.js.

import { prisma } from '@/lib/prisma';
import { DEFAULT_HORIZON_DAYS, upcomingWindows } from '@/lib/activities';
import { DEFAULT_TIMEZONE } from '@/lib/sessions';

/** The arena columns every activity read needs. */
const SCHEDULE_SELECT = {
  scheduleDays: true,
  scheduleStart: true,
  scheduleEnd: true,
  timezone: true,
  defaultActivityCapacity: true,
  activityHorizonDays: true,
};

/** Shape an Arena row into the `{days, start, end, timezone}` view-model sessions.js expects. */
function toSchedule(arena) {
  return {
    days: arena?.scheduleDays ?? [],
    start: arena?.scheduleStart ?? null,
    end: arena?.scheduleEnd ?? null,
    timezone: arena?.timezone || DEFAULT_TIMEZONE,
  };
}

/**
 * Materialize the arena's schedule into `Activity` rows out to `horizonDays`.
 *
 * This is what makes a recurring schedule behave like Reclub's auto-created
 * weekly activities. It runs lazily from page loads and after a schedule save
 * rather than on a cron: `@@unique([arenaId, startsAt])` makes it idempotent, so
 * calling it on every request is safe and the arena is self-healing — a club
 * that goes quiet for two months gets a correct list the moment someone opens
 * the page.
 *
 * Only creates. Never updates or deletes an existing row, so a manager's edits
 * (title, capacity, notes, a cancellation) survive every subsequent call.
 *
 * @param {string} arenaId
 * @param {{now?: Date, horizonDays?: number}} [opts] - `horizonDays` overrides
 *   the arena's own setting; omit it so the manager's choice wins.
 * @returns {Promise<number>} how many rows were created
 */
export async function ensureUpcomingActivities(arenaId, { now, horizonDays } = {}) {
  if (!arenaId) throw new Error('ensureUpcomingActivities requires an arenaId');

  const arena = await prisma.arena.findUnique({ where: { id: arenaId }, select: SCHEDULE_SELECT });
  if (!arena) return 0;

  const horizon = horizonDays ?? arena.activityHorizonDays ?? DEFAULT_HORIZON_DAYS;
  const schedule = toSchedule(arena);
  const windows = upcomingWindows(schedule, now ? new Date(now) : new Date(), horizon);
  if (windows.length === 0) return 0;

  // One round trip to find what's already there, so the common case (nothing to
  // create) costs a single indexed read instead of N upserts.
  const existing = await prisma.activity.findMany({
    where: { arenaId, startsAt: { in: windows.map((w) => w.start) } },
    select: { startsAt: true },
  });
  const known = new Set(existing.map((a) => a.startsAt.getTime()));
  const missing = windows.filter((w) => !known.has(w.start.getTime()));
  if (missing.length === 0) return 0;

  const created = await prisma.activity.createMany({
    data: missing.map((w) => ({
      arenaId,
      startsAt: w.start,
      endsAt: w.end,
      timezone: schedule.timezone,
      status: 'SCHEDULED',
      source: 'SCHEDULE',
      // Seeded at creation only. Changing the arena default later never
      // rewrites an existing night, so a manager's per-activity override sticks.
      capacity: arena.defaultActivityCapacity ?? null,
    })),
    // Belt and braces: two page loads racing on the same empty arena would
    // otherwise have one of them fail the unique constraint.
    skipDuplicates: true,
  });
  return created.count;
}

/**
 * Activities for the list view.
 *
 * `upcoming` is ascending (the next night first — that's what a player wants to
 * act on); `past` is descending (most recent first).
 *
 * Status dominates the clock, and the two filters are exact complements so every
 * row lands in exactly one list:
 *   - LIVE is always upcoming, however far past its scheduled end it runs, so a
 *     session going long doesn't vanish off the list mid-play.
 *   - COMPLETED is always past, however far in the future its window reaches.
 *     Backfilled nights span a whole local day, so a session closed this morning
 *     still has an `endsAt` later tonight — by the window alone it would show as
 *     upcoming, which is plainly wrong.
 *   - SCHEDULED and CANCELLED fall back to the window. Cancelled nights stay
 *     visible (greyed) rather than vanishing, since players may have RSVP'd.
 *
 * @param {string} arenaId
 * @param {{scope?: 'upcoming'|'past', now?: Date, take?: number, viewerUserId?: string|null}} [opts]
 */
export async function listActivities(arenaId, { scope = 'upcoming', now, take = 20, viewerUserId = null } = {}) {
  if (!arenaId) throw new Error('listActivities requires an arenaId');
  const nowDate = now ? new Date(now) : new Date();
  const where = { arenaId, ...activityScopeFilter(scope, nowDate) };

  const rows = await prisma.activity.findMany({
    where,
    orderBy: { startsAt: scope === 'past' ? 'desc' : 'asc' },
    take,
    include: {
      _count: { select: { matches: true, attendees: true } },
      // The full status list serves the counts; `userId` rides along so the
      // viewer's own row can be picked out without a second query per activity.
      attendees: { select: { status: true, userId: true, position: true } },
    },
  });

  return rows.map((row) => shapeSummary(row, viewerUserId));
}

/**
 * The Prisma `where` fragment selecting one scope. Exported so a test can pin it
 * against `deriveActivityState`, which applies the same rule client-side — the
 * two classifying a row differently would put it in a list whose own badge
 * contradicts it.
 *
 * @param {'upcoming'|'past'} scope
 * @param {Date} now
 */
export function activityScopeFilter(scope, now) {
  const byWindow = { status: { in: ['SCHEDULED', 'CANCELLED'] } };
  return scope === 'past'
    ? { OR: [{ status: 'COMPLETED' }, { ...byWindow, endsAt: { lte: now } }] }
    : { OR: [{ status: 'LIVE' }, { ...byWindow, endsAt: { gt: now } }] };
}

/** Count attendees by status without a second query — the lists are small (tens, not thousands). */
function shapeSummary(row, viewerUserId = null) {
  const counts = { going: 0, waitlist: 0, declined: 0, checkedIn: 0, noShow: 0 };
  let viewer = null;
  for (const a of row.attendees ?? []) {
    if (a.status === 'GOING') counts.going += 1;
    else if (a.status === 'WAITLIST') counts.waitlist += 1;
    else if (a.status === 'DECLINED') counts.declined += 1;
    else if (a.status === 'CHECKED_IN') counts.checkedIn += 1;
    else if (a.status === 'NO_SHOW') counts.noShow += 1;
    if (viewerUserId && a.userId === viewerUserId) {
      viewer = { status: a.status, position: a.position ?? null };
    }
  }
  return {
    // The viewer's own RSVP, so the buttons render in the right state on first
    // paint rather than flashing "not answered" and correcting after hydration.
    viewerRsvp: viewer,
    id: row.id,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    status: row.status,
    source: row.source,
    capacity: row.capacity,
    notes: row.notes,
    openedAt: row.openedAt ? row.openedAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    matchCount: row._count?.matches ?? 0,
    attendeeCount: row._count?.attendees ?? 0,
    counts,
  };
}

/**
 * One activity with everything its detail page renders: the attendee list and
 * every match played, shaped for `computeActivityStandings` and `<MatchHistory>`
 * (which is already shape-agnostic via `toMatch`, so it needs no changes).
 *
 * Returns null when the activity doesn't exist. `arenaId` is checked by the
 * caller against the route's arena so an id from another club can't be read.
 */
export async function getActivityDetail(activityId, { viewerUserId = null } = {}) {
  if (!activityId) throw new Error('getActivityDetail requires an activityId');

  const row = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      _count: { select: { matches: true, attendees: true } },
      attendees: { orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }] },
      matches: { include: { players: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!row) return null;

  return {
    ...shapeSummary(row, viewerUserId),
    arenaId: row.arenaId,
    attendees: row.attendees.map((a) => ({
      id: a.id,
      playerId: a.playerId,
      userId: a.userId,
      displayName: a.displayName,
      status: a.status,
      position: a.position,
      checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
    })),
    // Same shape `getState` ships, so the pure tallies and the match-history
    // component consume it without a second adapter.
    matches: row.matches.map((m) => ({
      id: m.id,
      courtName: m.courtName,
      score1: m.score1,
      score2: m.score2,
      timestamp: m.createdAt.toISOString(),
      activityId: m.activityId,
      team1: m.players
        .filter((p) => p.team === 1)
        .map((p) => ({ id: p.playerId, firstName: p.playerFirstName, lastName: p.playerLastName })),
      team2: m.players
        .filter((p) => p.team === 2)
        .map((p) => ({ id: p.playerId, firstName: p.playerFirstName, lastName: p.playerLastName })),
    })),
  };
}

/**
 * Just the attendee rows for one activity.
 *
 * Split out from `getActivityDetail` because the arena board needs attendance
 * for the prep roster but none of the matches or standings that detail carries.
 *
 * @param {string} activityId
 */
export async function getActivityAttendees(activityId) {
  if (!activityId) return [];
  const rows = await prisma.activityAttendee.findMany({
    where: { activityId },
    select: { id: true, playerId: true, userId: true, displayName: true, status: true, position: true },
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  });
  return rows;
}

/**
 * Pick the activity `startActivity` should open next, inside its transaction.
 *
 * Preference order, most-specific first:
 *   1. an explicit `activityId` — the manager tapped a specific night
 *   2. the session happening now, if the schedule says one is live
 *   3. the next already-materialized SCHEDULED row
 *   4. a fresh MANUAL row starting now — an unscheduled arena, or a manager
 *      starting an impromptu session
 *
 * Steps 2 and 3 both go through `upsert` on `[arenaId, startsAt]` so a window
 * that was never materialized still gets a stable row rather than a duplicate.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} arenaId
 * @param {{activityId?: string|null, now?: Date}} [opts]
 */
export async function resolveActivityToOpen(tx, arenaId, { activityId = null, now = new Date() } = {}) {
  if (activityId) {
    const chosen = await tx.activity.findFirst({ where: { id: activityId, arenaId } });
    if (!chosen) throw new Error('ACTIVITY_NOT_FOUND');
    if (chosen.status === 'CANCELLED') throw new Error('ACTIVITY_CANCELLED');
    return chosen;
  }

  const arena = await tx.arena.findUnique({ where: { id: arenaId }, select: SCHEDULE_SELECT });
  if (!arena) throw new Error('ARENA_GONE');
  const schedule = toSchedule(arena);

  // The window covering `now`, or the next one — `upcomingWindows` already
  // puts a live session first, which is exactly the priority we want here.
  const [window] = upcomingWindows(schedule, now, 14);
  if (window) {
    return tx.activity.upsert({
      where: { arenaId_startsAt: { arenaId, startsAt: window.start } },
      create: {
        arenaId,
        startsAt: window.start,
        endsAt: window.end,
        timezone: schedule.timezone,
        status: 'SCHEDULED',
        source: 'SCHEDULE',
      },
      update: {},
    });
  }

  return tx.activity.create({
    data: {
      arenaId,
      startsAt: now,
      // Placeholder span — an impromptu session has no schedule window behind it.
      endsAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
      timezone: schedule.timezone,
      status: 'SCHEDULED',
      source: 'MANUAL',
    },
  });
}
