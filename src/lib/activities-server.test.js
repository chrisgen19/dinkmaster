import { describe, it, expect, vi } from 'vitest';
import { deriveActivityState } from './activities';

// activities-server.js imports Prisma at module scope, so stub it — this suite
// only exercises the pure scope filter, not the queries around it.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

const { activityScopeFilter } = await import('./activities-server');

const NOW = new Date('2026-08-05T12:00:00Z');
const PAST_END = new Date('2026-08-04T22:00:00Z');
const FUTURE_END = new Date('2026-08-06T22:00:00Z');

/**
 * Evaluate a scope filter against a row in memory. Mirrors the subset of Prisma
 * `where` semantics the filter actually uses (a top-level OR of clauses, each
 * combining an optional status match with an optional endsAt comparison).
 */
function matches(filter, row) {
  return filter.OR.some((clause) => {
    if (clause.status) {
      const wanted = clause.status.in ?? [clause.status];
      if (!wanted.includes(row.status)) return false;
    }
    if (clause.endsAt?.gt && !(row.endsAt > clause.endsAt.gt)) return false;
    if (clause.endsAt?.lte && !(row.endsAt <= clause.endsAt.lte)) return false;
    return true;
  });
}

const ROWS = [
  { label: 'LIVE running past its window', status: 'LIVE', endsAt: PAST_END },
  { label: 'LIVE inside its window', status: 'LIVE', endsAt: FUTURE_END },
  { label: 'COMPLETED whose window ends later today', status: 'COMPLETED', endsAt: FUTURE_END },
  { label: 'COMPLETED long finished', status: 'COMPLETED', endsAt: PAST_END },
  { label: 'SCHEDULED in the future', status: 'SCHEDULED', endsAt: FUTURE_END },
  { label: 'SCHEDULED that nobody opened', status: 'SCHEDULED', endsAt: PAST_END },
  { label: 'CANCELLED in the future', status: 'CANCELLED', endsAt: FUTURE_END },
  { label: 'CANCELLED in the past', status: 'CANCELLED', endsAt: PAST_END },
];

describe('activityScopeFilter', () => {
  const upcoming = activityScopeFilter('upcoming', NOW);
  const past = activityScopeFilter('past', NOW);

  it.each(ROWS)('puts a $label in exactly one list', (row) => {
    const inUpcoming = matches(upcoming, row);
    const inPast = matches(past, row);
    expect(inUpcoming || inPast).toBe(true);
    expect(inUpcoming && inPast).toBe(false);
  });

  it('keeps a LIVE activity upcoming even when it runs past its scheduled end', () => {
    // A session going long must not vanish off the list mid-play.
    expect(matches(upcoming, { status: 'LIVE', endsAt: PAST_END })).toBe(true);
  });

  it('keeps a COMPLETED activity past even when its window reaches into tonight', () => {
    // Backfilled nights span a whole local day, so a session closed this morning
    // still has an endsAt later today. By the window alone it would read as
    // upcoming, which is plainly wrong.
    expect(matches(past, { status: 'COMPLETED', endsAt: FUTURE_END })).toBe(true);
    expect(matches(upcoming, { status: 'COMPLETED', endsAt: FUTURE_END })).toBe(false);
  });

  it('keeps a cancelled future night visible rather than hiding it', () => {
    // Players may already have RSVP'd, so it stays listed (greyed) instead of
    // silently disappearing.
    expect(matches(upcoming, { status: 'CANCELLED', endsAt: FUTURE_END })).toBe(true);
  });

  it('agrees with deriveActivityState, which applies the same rule client-side', () => {
    // Drift here would put a row in a list whose own badge contradicts it.
    //
    // CANCELLED is excluded on purpose: it is a badge, not a list. A called-off
    // night keeps its window's placement (next week's cancellation still sits
    // under Upcoming so RSVP'd players see it), while `deriveActivityState`
    // reports 'cancelled' either way. The two answer different questions for
    // that one status, so only the others are comparable.
    for (const row of ROWS.filter((r) => r.status !== 'CANCELLED')) {
      const serverSaysPast = matches(past, row);
      const clientState = deriveActivityState(row, NOW);
      const clientSaysPast = clientState === 'past';
      expect(
        clientSaysPast,
        `${row.label}: server=${serverSaysPast ? 'past' : 'upcoming'} client=${clientState}`,
      ).toBe(serverSaysPast);
    }
  });

  it('places a cancelled night by its window, and badges it independently', () => {
    const future = { status: 'CANCELLED', endsAt: FUTURE_END };
    const stale = { status: 'CANCELLED', endsAt: PAST_END };
    expect(matches(upcoming, future)).toBe(true);
    expect(matches(past, stale)).toBe(true);
    // The badge is the same in both lists — that's the point of it being separate.
    expect(deriveActivityState(future, NOW)).toBe('cancelled');
    expect(deriveActivityState(stale, NOW)).toBe('cancelled');
  });
});
