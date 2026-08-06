import { describe, it, expect } from 'vitest';
import {
  activityTimeRange,
  activityTitle,
  computeActivityStats,
  computeActivityStandings,
  deriveActivityState,
  promoteFromWaitlist,
  upcomingWindows,
  wallClockToUtc,
} from './activities';

// Tue/Thu 18:00–22:00 UTC, matching the sessions.js test fixture.
const sched = (overrides = {}) => ({
  days: [2, 4],
  start: '18:00',
  end: '22:00',
  timezone: 'UTC',
  ...overrides,
});

// 2026-05-19 is a Tuesday in UTC; 2026-05-20 Wed; 2026-05-21 Thu.
const at = (iso) => new Date(iso);

/** Build a match row in the shape `getState` ships to the client. */
const match = (activityId, team1, team2, score1, score2, timestamp = '2026-05-19T19:00:00Z') => ({
  activityId,
  team1: team1.map((id) => ({ id, firstName: id.toUpperCase() })),
  team2: team2.map((id) => ({ id, firstName: id.toUpperCase() })),
  score1,
  score2,
  timestamp,
});

describe('upcomingWindows', () => {
  it('returns nothing when the arena has no play days', () => {
    // Empty scheduleDays means "no schedule" here — deliberately unlike
    // leaderboard.js, where empty means "every day counts".
    expect(upcomingWindows(sched({ days: [] }), at('2026-05-19T12:00:00Z'))).toEqual([]);
  });

  it('enumerates every window inside the horizon, oldest first', () => {
    const wins = upcomingWindows(sched(), at('2026-05-18T00:00:00Z'), 14);
    // Mon 18th + 14d → Tue 19, Thu 21, Tue 26, Thu 28. The next Tuesday is
    // Jun 2, one day past the horizon.
    expect(wins.map((w) => w.start.toISOString())).toEqual([
      '2026-05-19T18:00:00.000Z',
      '2026-05-21T18:00:00.000Z',
      '2026-05-26T18:00:00.000Z',
      '2026-05-28T18:00:00.000Z',
    ]);
  });

  it('includes the currently-live window, which nextSession alone would skip', () => {
    // Mid-session on Tuesday: nextSession only returns windows starting after
    // `now`, so without the explicit live check tonight would be missing.
    const wins = upcomingWindows(sched(), at('2026-05-19T19:00:00Z'), 7);
    expect(wins[0].start.toISOString()).toBe('2026-05-19T18:00:00.000Z');
    expect(wins[0].end.toISOString()).toBe('2026-05-19T22:00:00.000Z');
  });

  it('does not re-emit a window that has already ended today', () => {
    // 23:00 on Tuesday — that night's 18:00–22:00 window is over.
    const wins = upcomingWindows(sched(), at('2026-05-19T23:00:00Z'), 7);
    expect(wins.map((w) => w.start.toISOString())).not.toContain('2026-05-19T18:00:00.000Z');
    expect(wins[0].start.toISOString()).toBe('2026-05-21T18:00:00.000Z');
  });

  it('respects the horizon', () => {
    const short = upcomingWindows(sched(), at('2026-05-18T00:00:00Z'), 3);
    expect(short).toHaveLength(1); // only Tue the 19th falls inside 3 days
  });

  it('survives a DST transition without duplicating or dropping a window', () => {
    // US DST springs forward 2026-03-08. A Sunday-only schedule spanning it
    // must still yield one window per week at the same LOCAL time.
    const wins = upcomingWindows(
      { days: [0], start: '09:00', end: '12:00', timezone: 'America/New_York' },
      at('2026-03-01T00:00:00Z'),
      21,
    );
    expect(wins).toHaveLength(3);
    // 09:00 local = 14:00Z before the shift, 13:00Z after.
    expect(wins.map((w) => w.start.toISOString())).toEqual([
      '2026-03-01T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-15T13:00:00.000Z',
    ]);
  });
});

describe('activityTitle', () => {
  it('prefers a manager-set title', () => {
    expect(activityTitle({ title: 'Friday Smash', startsAt: '2026-05-19T18:00:00Z', timezone: 'UTC' }))
      .toBe('Friday Smash');
  });

  it('derives weekday + date from the window', () => {
    expect(activityTitle({ startsAt: '2026-05-19T18:00:00Z', timezone: 'UTC' }))
      .toBe('Tuesday · May 19');
  });

  it('uses the activity timezone snapshot, not UTC', () => {
    // 18:00Z on the 19th is already 02:00 on the 20th in Manila.
    expect(activityTitle({ startsAt: '2026-05-19T18:00:00Z', timezone: 'Asia/Manila' }))
      .toBe('Wednesday · May 20');
  });

  it('falls back rather than throwing on a corrupted timezone', () => {
    expect(activityTitle({ startsAt: '2026-05-19T18:00:00Z', timezone: 'Not/AZone' }))
      .toBe('Wednesday · May 20'); // silently uses the Asia/Manila default
  });

  it('degrades to a generic label without a start', () => {
    expect(activityTitle({})).toBe('Activity');
  });
});

describe('activityTimeRange', () => {
  it('formats the window in the activity timezone', () => {
    expect(activityTimeRange({ startsAt: '2026-05-19T10:00:00Z', endsAt: '2026-05-19T14:00:00Z', timezone: 'Asia/Manila' }))
      .toBe('6:00 PM – 10:00 PM');
  });

  it('returns null when a bound is missing', () => {
    expect(activityTimeRange({ startsAt: '2026-05-19T10:00:00Z', timezone: 'UTC' })).toBeNull();
  });
});

describe('deriveActivityState', () => {
  const now = at('2026-05-20T12:00:00Z');

  it('trusts an explicit status over the clock', () => {
    // Window is long past, but the manager still has it open.
    expect(deriveActivityState({ status: 'LIVE', endsAt: '2026-05-19T22:00:00Z' }, now)).toBe('live');
    expect(deriveActivityState({ status: 'CANCELLED', endsAt: '2026-05-21T22:00:00Z' }, now)).toBe('cancelled');
    expect(deriveActivityState({ status: 'COMPLETED', endsAt: '2026-05-21T22:00:00Z' }, now)).toBe('past');
  });

  it('falls back to the window for a SCHEDULED row', () => {
    expect(deriveActivityState({ status: 'SCHEDULED', endsAt: '2026-05-19T22:00:00Z' }, now)).toBe('past');
    expect(deriveActivityState({ status: 'SCHEDULED', endsAt: '2026-05-21T22:00:00Z' }, now)).toBe('upcoming');
  });
});

describe('computeActivityStats', () => {
  const matches = [
    match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 5),
    match('a1', ['p1', 'p3'], ['p2', 'p4'], 8, 11),
    match('a2', ['p1', 'p2'], ['p3', 'p4'], 11, 9),
  ];

  it('counts only the named activity', () => {
    const tally = computeActivityStats(matches, 'a1');
    expect(tally.get('p1')).toEqual({ games: 2, wins: 1, losses: 1 });
    expect(tally.get('p4')).toEqual({ games: 2, wins: 1, losses: 1 });
  });

  it('leaves other activities untouched — past nights stay computable', () => {
    const tally = computeActivityStats(matches, 'a2');
    expect(tally.get('p1')).toEqual({ games: 1, wins: 1, losses: 0 });
  });

  it('counts everything when no activity is given', () => {
    expect(computeActivityStats(matches, null).get('p1')).toEqual({ games: 3, wins: 2, losses: 1 });
  });

  it('gives a tie a game but no win and no loss', () => {
    const tally = computeActivityStats([match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 11)], 'a1');
    expect(tally.get('p1')).toEqual({ games: 1, wins: 0, losses: 0 });
    expect(tally.get('p3')).toEqual({ games: 1, wins: 0, losses: 0 });
  });

  it('returns an empty tally for an activity with no matches', () => {
    expect(computeActivityStats(matches, 'nope').size).toBe(0);
  });
});

describe('computeActivityStandings', () => {
  it('ranks by wins first', () => {
    const matches = [
      match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 5, '2026-05-19T19:00:00Z'),
      match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 7, '2026-05-19T20:00:00Z'),
    ];
    const { standings } = computeActivityStandings({ matches, activityId: 'a1' });
    expect(standings.slice(0, 2).map((s) => s.playerId).sort()).toEqual(['p1', 'p2']);
    expect(standings.at(-1)).toMatchObject({ wins: 0, losses: 2 });
  });

  it('breaks a wins tie on win percentage', () => {
    const matches = [
      // p1 wins once in one game (100%); p3 wins once in two (50%).
      match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 5, '2026-05-19T19:00:00Z'),
      match('a1', ['p3', 'p5'], ['p6', 'p7'], 11, 5, '2026-05-19T20:00:00Z'),
      match('a1', ['p3', 'p5'], ['p6', 'p7'], 5, 11, '2026-05-19T21:00:00Z'),
    ];
    const { standings } = computeActivityStandings({ matches, activityId: 'a1' });
    const rank = (id) => standings.find((s) => s.playerId === id).rank;
    expect(rank('p1')).toBeLessThan(rank('p3'));
  });

  it('breaks a full tie on the most recent win', () => {
    // Four players, four matches, everyone finishes 2W-2L at 50%. The only
    // discriminator left is when each last won. In 2v2 both winners share a
    // timestamp, so this needs four matches to produce distinct last-win times.
    const matches = [
      match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 5, '2026-05-19T10:00:00Z'),
      match('a1', ['p3', 'p4'], ['p1', 'p2'], 11, 5, '2026-05-19T11:00:00Z'),
      match('a1', ['p1', 'p3'], ['p2', 'p4'], 11, 5, '2026-05-19T12:00:00Z'),
      match('a1', ['p2', 'p4'], ['p1', 'p3'], 11, 5, '2026-05-19T13:00:00Z'),
    ];
    const { standings } = computeActivityStandings({ matches, activityId: 'a1' });
    expect(standings.every((s) => s.wins === 2 && s.losses === 2)).toBe(true);
    // p2 and p4 won most recently (13:00); p1 and p3 last won at 12:00.
    expect(standings.slice(0, 2).map((s) => s.playerId).sort()).toEqual(['p2', 'p4']);
    expect(standings.slice(2).map((s) => s.playerId).sort()).toEqual(['p1', 'p3']);
  });

  it('includes winless players — an activity is the full scoreboard, not a podium', () => {
    const matches = [match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 0)];
    const { standings, playerCount } = computeActivityStandings({ matches, activityId: 'a1' });
    expect(playerCount).toBe(4);
    expect(standings.map((s) => s.playerId).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('reports game count and win percentage', () => {
    const matches = [
      match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 5),
      match('a1', ['p1', 'p2'], ['p3', 'p4'], 5, 11),
    ];
    const { gameCount, standings } = computeActivityStandings({ matches, activityId: 'a1' });
    expect(gameCount).toBe(2);
    expect(standings.find((s) => s.playerId === 'p1').winPct).toBe(50);
  });

  it('honours the limit and reports hasData', () => {
    const matches = [match('a1', ['p1', 'p2'], ['p3', 'p4'], 11, 5)];
    expect(computeActivityStandings({ matches, activityId: 'a1', limit: 2 }).standings).toHaveLength(2);
    expect(computeActivityStandings({ matches: [], activityId: 'a1' }).hasData).toBe(false);
  });
});

describe('promoteFromWaitlist', () => {
  const a = (id, status, position = null) => ({ id, status, position });

  it('promotes in first-come-first-serve order up to the free slots', () => {
    const attendees = [
      a('g1', 'GOING'), a('g2', 'GOING'),
      a('w1', 'WAITLIST', 2), a('w2', 'WAITLIST', 1), a('w3', 'WAITLIST', 3),
    ];
    // capacity 4, 2 confirmed → 2 slots, lowest positions first
    expect(promoteFromWaitlist(attendees, 4)).toEqual(['w2', 'w1']);
  });

  it('counts CHECKED_IN against capacity — being on site occupies a slot', () => {
    const attendees = [a('g1', 'GOING'), a('c1', 'CHECKED_IN'), a('w1', 'WAITLIST', 1)];
    expect(promoteFromWaitlist(attendees, 2)).toEqual([]);
  });

  it('ignores DECLINED when counting occupancy', () => {
    const attendees = [a('g1', 'GOING'), a('d1', 'DECLINED'), a('w1', 'WAITLIST', 1)];
    expect(promoteFromWaitlist(attendees, 2)).toEqual(['w1']);
  });

  it('clears the whole waitlist when uncapped', () => {
    const attendees = [a('g1', 'GOING'), a('w1', 'WAITLIST', 1), a('w2', 'WAITLIST', 2)];
    expect(promoteFromWaitlist(attendees, null)).toEqual(['w1', 'w2']);
  });

  it('promotes nobody when full or when the waitlist is empty', () => {
    expect(promoteFromWaitlist([a('g1', 'GOING'), a('w1', 'WAITLIST', 1)], 1)).toEqual([]);
    expect(promoteFromWaitlist([a('g1', 'GOING')], 4)).toEqual([]);
  });
});

describe('wallClockToUtc', () => {
  it('interprets the wall time in the given zone, not the runtime’s', () => {
    // 18:00 in Manila (UTC+8, no DST) is 10:00Z.
    expect(wallClockToUtc('2026-03-15', '18:00', 'Asia/Manila').toISOString())
      .toBe('2026-03-15T10:00:00.000Z');
    // The same wall time in New York is a different instant entirely — which is
    // the whole bug: a manager on a NY laptop creating a Manila session must
    // still get 10:00Z, not 22:00Z.
    expect(wallClockToUtc('2026-03-15', '18:00', 'America/New_York').toISOString())
      .toBe('2026-03-15T22:00:00.000Z');
  });

  it('handles a DST transition without drifting an hour', () => {
    // US DST springs forward 2026-03-08. 09:00 local is 14:00Z before and
    // 13:00Z after.
    expect(wallClockToUtc('2026-03-01', '09:00', 'America/New_York').toISOString())
      .toBe('2026-03-01T14:00:00.000Z');
    expect(wallClockToUtc('2026-03-15', '09:00', 'America/New_York').toISOString())
      .toBe('2026-03-15T13:00:00.000Z');
  });

  it('returns null on malformed input rather than an Invalid Date', () => {
    expect(wallClockToUtc('', '18:00', 'UTC')).toBeNull();
    expect(wallClockToUtc('2026-03-15', '', 'UTC')).toBeNull();
    expect(wallClockToUtc('15-03-2026', '18:00', 'UTC')).toBeNull();
    expect(wallClockToUtc('2026-03-15', '25:00', 'UTC')).toBeNull();
  });

  it('falls back to the default zone rather than throwing on a bad timezone', () => {
    expect(wallClockToUtc('2026-03-15', '18:00', 'Not/AZone').toISOString())
      .toBe('2026-03-15T10:00:00.000Z'); // Asia/Manila default
  });
});
