import { describe, it, expect } from 'vitest';
import { computeWeeklyLeaderboard, weekWindow } from '@/lib/leaderboard';

// All tests run in UTC with an explicit `now` so the Mon–Sun window is fixed.
// 2026-05-18 is a Monday; the week runs to 2026-05-25 (next Monday).
const NOW = '2026-05-20T12:00:00Z'; // Wednesday
const UTC = { timezone: 'UTC' };

/** A finished match at day `d` of May 2026 (UTC). `winner` is 1 or 2. */
const match = (team1, team2, winner, day, hour = 12) => ({
  team1: team1.map((id) => ({ id, firstName: id.toUpperCase() })),
  team2: team2.map((id) => ({ id, firstName: id.toUpperCase() })),
  score1: winner === 1 ? 11 : 5,
  score2: winner === 2 ? 11 : 5,
  timestamp: `2026-05-${day}T${String(hour).padStart(2, '0')}:00:00Z`,
});

describe('weekWindow', () => {
  it('spans Monday 00:00 to the next Monday 00:00 in the zone', () => {
    const { start, end } = weekWindow(new Date(NOW), 'UTC');
    expect(start.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });

  it('shifts the boundary by the zone offset', () => {
    // Manila is UTC+8, so local Monday 00:00 is the previous Sunday 16:00 UTC.
    const { start } = weekWindow(new Date(NOW), 'Asia/Manila');
    expect(start.toISOString()).toBe('2026-05-17T16:00:00.000Z');
  });
});

describe('computeWeeklyLeaderboard', () => {
  it('returns no leaders and hasData=false when there are no matches', () => {
    const r = computeWeeklyLeaderboard({ matches: [], schedule: UTC, now: NOW });
    expect(r.hasData).toBe(false);
    expect(r.leaders).toEqual([]);
  });

  it('ranks by wins, then breaks ties by win %', () => {
    // Distinct partners each game so only `a` and `c` accumulate these wins.
    const matches = [
      // a wins 3 of 3 (100%)
      match(['a', 'x1'], ['b1', 'b2'], 1, 18),
      match(['a', 'x2'], ['b3', 'b4'], 1, 19),
      match(['a', 'x3'], ['b5', 'b6'], 1, 20),
      // c wins 3 of 4 (75%) — same win count as a, lower win %
      match(['c', 'z1'], ['d1', 'd2'], 1, 18),
      match(['c', 'z2'], ['d3', 'd4'], 1, 19),
      match(['c', 'z3'], ['d5', 'd6'], 1, 20),
      match(['c', 'z4'], ['d7', 'd8'], 2, 21),
    ];
    const r = computeWeeklyLeaderboard({ matches, schedule: UTC, now: NOW, limit: 2 });
    expect(r.leaders.map((l) => l.playerId)).toEqual(['a', 'c']);
    expect(r.leaders[0]).toMatchObject({ rank: 1, wins: 3, games: 3, winPct: 100 });
    expect(r.leaders[1]).toMatchObject({ rank: 2, wins: 3, games: 4, winPct: 75 });
  });

  it('breaks an exact wins+win% tie by the most recent win', () => {
    // e and f each finish 2 wins / 2 games (100%); f's last win is later, so
    // f ranks first. (Equal wins + equal win% implies equal games, so the
    // most-recent-win key is the meaningful final tie-break.)
    const matches = [
      match(['e', 'p1'], ['l1', 'l2'], 1, 18),
      match(['e', 'p2'], ['l3', 'l4'], 1, 19), // e's last win: day 19
      match(['f', 'q1'], ['m1', 'm2'], 1, 20),
      match(['f', 'q2'], ['m3', 'm4'], 1, 21), // f's last win: day 21 (later)
    ];
    const r = computeWeeklyLeaderboard({ matches, schedule: UTC, now: NOW });
    expect(r.leaders[0]).toMatchObject({ playerId: 'f', wins: 2, games: 2, winPct: 100 });
    expect(r.leaders[1]).toMatchObject({ playerId: 'e', wins: 2, games: 2, winPct: 100 });
  });

  it('excludes players with zero wins', () => {
    const r = computeWeeklyLeaderboard({
      matches: [match(['a', 'x'], ['b', 'y'], 1, 18)],
      schedule: UTC,
      now: NOW,
    });
    expect(r.leaders.map((l) => l.playerId).sort()).toEqual(['a', 'x']);
  });

  it('counts games on any weekday by default (countOffSchedule)', () => {
    const matches = [
      match(['a', 'x'], ['b', 'y'], 1, 18), // Monday (a scheduled day)
      match(['a', 'x'], ['b', 'y'], 1, 20), // Wednesday (off-schedule) — still counts
    ];
    // schedule.days = [1] (Monday only) must NOT exclude the Wednesday game.
    const r = computeWeeklyLeaderboard({ matches, schedule: { timezone: 'UTC', days: [1] }, now: NOW });
    expect(r.leaders[0]).toMatchObject({ playerId: 'a', wins: 2, games: 2 });
  });

  it('excludes off-schedule games when countOffSchedule is false', () => {
    const matches = [
      match(['a', 'x'], ['b', 'y'], 1, 18), // Monday — kept
      match(['a', 'x'], ['b', 'y'], 1, 20), // Wednesday — dropped
    ];
    const r = computeWeeklyLeaderboard({
      matches,
      schedule: { timezone: 'UTC', days: [1] },
      countOffSchedule: false,
      now: NOW,
    });
    expect(r.leaders[0]).toMatchObject({ playerId: 'a', wins: 1, games: 1 });
  });

  it('countOffSchedule=false with no schedule days falls back to "every day"', () => {
    const matches = [
      match(['a', 'x'], ['b', 'y'], 1, 18), // Monday
      match(['a', 'x'], ['b', 'y'], 1, 20), // Wednesday
    ];
    const r = computeWeeklyLeaderboard({
      matches,
      schedule: { timezone: 'UTC', days: [] },
      countOffSchedule: false,
      now: NOW,
    });
    expect(r.leaders[0]).toMatchObject({ playerId: 'a', wins: 2, games: 2 });
  });

  it('ignores matches outside the current week', () => {
    const matches = [
      match(['a', 'x'], ['b', 'y'], 1, 11), // previous week — excluded
      match(['a', 'x'], ['b', 'y'], 1, 19), // this week — counts
    ];
    const r = computeWeeklyLeaderboard({ matches, schedule: UTC, now: NOW });
    expect(r.leaders[0]).toMatchObject({ playerId: 'a', wins: 1, games: 1 });
  });

  it('caps the board at `limit`', () => {
    const matches = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      match([id, `${id}2`], ['loser', 'loser2'], 1, 18 + (i % 6)),
    );
    const r = computeWeeklyLeaderboard({ matches, schedule: UTC, now: NOW, limit: 5 });
    expect(r.leaders).toHaveLength(5);
    expect(r.leaders.every((l) => l.rank <= 5)).toBe(true);
  });

  it('treats a tie game as a game played but not a win', () => {
    const tie = { ...match(['a', 'x'], ['b', 'y'], 1, 18), score1: 9, score2: 9 };
    const win = match(['a', 'x'], ['b', 'y'], 1, 19);
    const r = computeWeeklyLeaderboard({ matches: [tie, win], schedule: UTC, now: NOW });
    expect(r.leaders[0]).toMatchObject({ playerId: 'a', wins: 1, games: 2, winPct: 50 });
  });
});
