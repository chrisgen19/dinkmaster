import { describe, it, expect } from 'vitest';
import {
  toMatch,
  winnerSide,
  viewerWon,
  differential,
  dayLabel,
  groupByDay,
  summarise,
  scoreSpreadClass,
  scoreSplitColors,
} from './match-history';

const NEUTRAL = {
  id: 'm1',
  timestamp: '2026-05-25T19:42:00.000Z',
  courtName: 'Court 1',
  team1: [{ id: 'p-ace', firstName: 'Ace' }, { id: 'p-mia', firstName: 'Mia' }],
  team2: [{ id: 'p-joe', firstName: 'Joe' }, { id: 'p-lin', firstName: 'Lin' }],
  score1: 11,
  score2: 6,
};

const PLAYER = {
  id: 'm2',
  timestamp: '2026-05-24T10:00:00.000Z',
  courtName: 'Court 2',
  arenaName: 'QC Open',
  won: false,
  scoreFor: 5,
  scoreAgainst: 11,
  partners: [{ firstName: 'Mia' }],
};

describe('toMatch()', () => {
  it('normalises a neutral arena match (no viewer)', () => {
    const m = toMatch(NEUTRAL);
    expect(m.id).toBe('m1');
    expect(m.teams.a.score).toBe(11);
    expect(m.teams.b.score).toBe(6);
    expect(m.teams.a.players).toHaveLength(2);
    expect(m.youOn).toBeNull();
  });

  it('marks viewer side when a known player id is passed', () => {
    const onA = toMatch(NEUTRAL, { viewerPlayerId: 'p-ace' });
    const onB = toMatch(NEUTRAL, { viewerPlayerId: 'p-joe' });
    expect(onA.youOn).toBe('a');
    expect(onB.youOn).toBe('b');
  });

  it('normalises a player-perspective match — viewer always on side A', () => {
    const m = toMatch(PLAYER);
    expect(m.id).toBe('m2');
    expect(m.teams.a.score).toBe(5);
    expect(m.teams.b.score).toBe(11);
    expect(m.youOn).toBe('a');
    expect(m.arenaName).toBe('QC Open');
    expect(m.teams.a.players).toEqual([{ firstName: 'Mia' }]);
  });

  it('player shape with no partners still produces a valid match', () => {
    const m = toMatch({ ...PLAYER, partners: undefined });
    expect(m.teams.a.players).toEqual([]);
  });

  it('carries the match target through, defaulting to null', () => {
    // The arena's correction dialog states this value as its "First to N"
    // rule, and the server validates against the same one — so a row that
    // never recorded its target must normalise to null, not to a guess.
    expect(toMatch({ ...NEUTRAL, targetScore: 15 }).targetScore).toBe(15);
    expect(toMatch(NEUTRAL).targetScore).toBeNull();
  });

  it('throws on an unknown shape', () => {
    expect(() => toMatch({ foo: 'bar' })).toThrow();
  });

  it('throws when neither id nor matchId is present', () => {
    expect(() =>
      toMatch({ ...PLAYER, id: undefined, matchId: undefined }),
    ).toThrow(/id required/i);
    expect(() => toMatch({ ...NEUTRAL, id: undefined })).toThrow(/id required/i);
  });
});

describe('winnerSide() / viewerWon() / differential()', () => {
  it('winnerSide picks the larger score', () => {
    expect(winnerSide(toMatch(NEUTRAL))).toBe('a');
    expect(winnerSide(toMatch({ ...NEUTRAL, score1: 4, score2: 11 }))).toBe('b');
  });

  it('viewerWon is null in neutral mode', () => {
    expect(viewerWon(toMatch(NEUTRAL))).toBeNull();
  });

  it('viewerWon reflects whose side won when youOn is set', () => {
    const onA = toMatch(NEUTRAL, { viewerPlayerId: 'p-ace' }); // A won 11-6
    const onB = toMatch(NEUTRAL, { viewerPlayerId: 'p-joe' });
    expect(viewerWon(onA)).toBe(true);
    expect(viewerWon(onB)).toBe(false);
  });

  it('viewerWon returns null for a tie (treated as undecided, not a loss)', () => {
    const tie = toMatch({ ...NEUTRAL, score1: 7, score2: 7 }, { viewerPlayerId: 'p-ace' });
    expect(viewerWon(tie)).toBeNull();
  });

  it('differential signs from viewer perspective when set, else from A', () => {
    expect(differential(toMatch(NEUTRAL))).toBe(5);
    expect(differential(toMatch(NEUTRAL, { viewerPlayerId: 'p-joe' }))).toBe(-5);
    expect(differential(toMatch(PLAYER))).toBe(-6);
  });
});

describe('dayLabel()', () => {
  const now = new Date('2026-05-25T12:00:00');

  it('returns Today / Yesterday for the nearest two days', () => {
    expect(dayLabel(new Date('2026-05-25T08:00:00'), now)).toBe('Today');
    expect(dayLabel(new Date('2026-05-24T08:00:00'), now)).toBe('Yesterday');
  });

  it('returns weekday name within the past week', () => {
    // 2026-05-20 was a Wednesday.
    const label = dayLabel(new Date('2026-05-20T08:00:00'), now);
    expect(label).toMatch(/^[A-Z][a-z]+day$/);
  });

  it('returns a same-year label without the year for older same-year dates', () => {
    // Avoid locale-specific assertions (month abbreviation, day order all vary
    // by runtime locale). The locale-agnostic invariant is: the year is
    // omitted within the current year and present outside it.
    const label = dayLabel(new Date('2026-01-04T08:00:00'), now);
    expect(label).toBeTruthy();
    expect(label).not.toMatch(/2026/);
  });

  it('includes the year for older dates', () => {
    expect(dayLabel(new Date('2024-12-15T08:00:00'), now)).toMatch(/2024/);
  });
});

describe('groupByDay()', () => {
  const now = new Date('2026-05-25T12:00:00');

  it('clusters matches by local day, newest day first, preserving input order within a group', () => {
    const matches = [
      toMatch({ ...NEUTRAL, id: 'a', timestamp: '2026-05-25T19:00:00' }),
      toMatch({ ...NEUTRAL, id: 'b', timestamp: '2026-05-25T18:00:00' }),
      toMatch({ ...NEUTRAL, id: 'c', timestamp: '2026-05-24T20:00:00' }),
    ];
    const groups = groupByDay(matches, now);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].matches.map((m) => m.id)).toEqual(['a', 'b']);
    expect(groups[1].label).toBe('Yesterday');
    expect(groups[1].matches.map((m) => m.id)).toEqual(['c']);
  });

  it('returns an empty array for no matches', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('summarise()', () => {
  // Newest-first: W, W, L, W
  const playerMatches = [
    toMatch({ ...PLAYER, id: 'p1', won: true, scoreFor: 11, scoreAgainst: 7 }),
    toMatch({ ...PLAYER, id: 'p2', won: true, scoreFor: 11, scoreAgainst: 9 }),
    toMatch({ ...PLAYER, id: 'p3', won: false, scoreFor: 5, scoreAgainst: 11 }),
    toMatch({ ...PLAYER, id: 'p4', won: true, scoreFor: 11, scoreAgainst: 2 }),
  ];

  it('counts wins, losses, and win pct', () => {
    const s = summarise(playerMatches);
    expect(s.total).toBe(4);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(1);
    expect(s.winPct).toBe(75);
  });

  it('reports the current streak from the head of the list', () => {
    expect(summarise(playerMatches).streak).toEqual({ kind: 'W', count: 2 });
  });

  it('streak is null for a neutral-mode list', () => {
    const neutral = [toMatch(NEUTRAL), toMatch({ ...NEUTRAL, id: 'm3' })];
    expect(summarise(neutral).streak).toBeNull();
  });

  it('winPct is null when no decided matches', () => {
    expect(summarise([]).winPct).toBeNull();
  });
});

describe('ScoreBlock visual styles logic', () => {
  it('selects sky tones for negative Team A differentials in neutral perspective', () => {
    const cls = scoreSpreadClass(false, true, 'neutral');
    expect(cls).toContain('bg-sky-50');
    expect(cls).toContain('text-sky-700');
    expect(cls).toContain('ring-sky-200/50');
  });

  it('selects emerald tones for positive Team A differentials in neutral perspective', () => {
    const cls = scoreSpreadClass(true, false, 'neutral');
    expect(cls).toContain('bg-emerald-500');
    expect(cls).toContain('text-white');
  });

  it('selects slate tones for ties', () => {
    const cls = scoreSpreadClass(false, false, 'neutral');
    expect(cls).toContain('bg-slate-50');
    expect(cls).toContain('text-slate-400');
    expect(cls).toContain('ring-1');
  });

  it('applies dynamic split bar colors based on winner and perspective', () => {
    // Neutral Win (Team A won)
    const neutralWin = scoreSplitColors('a', 'neutral', null);
    expect(neutralWin.leftBarColor).toBe('bg-emerald-500');
    expect(neutralWin.rightBarColor).toBe('bg-slate-300');

    // Neutral Loss (Team B won)
    const neutralLoss = scoreSplitColors('b', 'neutral', null);
    expect(neutralLoss.leftBarColor).toBe('bg-slate-300');
    expect(neutralLoss.rightBarColor).toBe('bg-sky-500');

    // Player Win
    const playerWin = scoreSplitColors('a', 'player', true);
    expect(playerWin.leftBarColor).toBe('bg-emerald-500');
    expect(playerWin.rightBarColor).toBe('bg-slate-300');

    // Player Loss
    const playerLoss = scoreSplitColors('b', 'player', false);
    expect(playerLoss.leftBarColor).toBe('bg-slate-300');
    expect(playerLoss.rightBarColor).toBe('bg-rose-500');

    // Tie
    const tie = scoreSplitColors('tie', 'neutral', null);
    expect(tie.leftBarColor).toBe('bg-slate-400');
    expect(tie.rightBarColor).toBe('bg-slate-400');
  });
});
