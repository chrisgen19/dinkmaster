import { describe, it, expect } from 'vitest';
import { boardFingerprint, canonicalBoardString, fnv1a } from '@/lib/board-fingerprint';

const SETTINGS = {
  targetScore: 11,
  starveThreshold: 2,
  emergencyWait: 4,
  skipRestoresPriority: true,
  skipPickReplacement: true,
};

const player = (id, overrides = {}) => ({
  id,
  waitRounds: 0,
  gamesPlayed: 0,
  gamesOffset: 0,
  wins: 0,
  losses: 0,
  rating: 1000,
  skipBoosted: false,
  ...overrides,
});

const baseState = () => ({
  players: [player('a'), player('b')],
  queue: ['a', 'b'],
  courts: [
    { id: 'c1', status: 'vacant', slots: [] },
  ],
  history: {},
});

describe('fnv1a', () => {
  it('is deterministic and 8 hex chars', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
});

describe('boardFingerprint', () => {
  it('is stable across input ordering (players, courts, slots, pairs)', () => {
    const a = {
      players: [player('a'), player('b')],
      queue: ['a', 'b'],
      courts: [
        { id: 'c1', status: 'playing', slots: [{ playerId: 'a', team: 1, prevQueueOrder: 1 }, { playerId: 'b', team: 2 }] },
        { id: 'c2', status: 'vacant', slots: [] },
      ],
      history: { a: { b: 2 }, b: { a: 2 } },
    };
    const b = {
      players: [player('b'), player('a')], // reordered
      queue: ['a', 'b'],
      courts: [
        { id: 'c2', status: 'vacant', slots: [] }, // reordered
        { id: 'c1', status: 'playing', slots: [{ playerId: 'b', team: 2 }, { playerId: 'a', team: 1 }] },
      ],
      history: { b: { a: 2 }, a: { b: 2 } },
    };
    expect(boardFingerprint(a, SETTINGS)).toBe(boardFingerprint(b, SETTINGS));
  });

  it('changes when queue ORDER changes, even with identical membership', () => {
    const s1 = baseState();
    const s2 = { ...baseState(), queue: ['b', 'a'] };
    expect(boardFingerprint(s1, SETTINGS)).not.toBe(boardFingerprint(s2, SETTINGS));
  });

  it('changes on any tracked player field, court status, or partnership count', () => {
    const base = boardFingerprint(baseState(), SETTINGS);
    const bumpedWait = { ...baseState(), players: [player('a', { waitRounds: 1 }), player('b')] };
    const playingCourt = { ...baseState(), courts: [{ id: 'c1', status: 'playing', slots: [] }] };
    const withPair = { ...baseState(), history: { a: { b: 1 }, b: { a: 1 } } };
    for (const changed of [bumpedWait, playingCourt, withPair]) {
      expect(boardFingerprint(changed, SETTINGS)).not.toBe(base);
    }
  });

  it('changes when settings change (a concurrent settings save must diverge)', () => {
    const state = baseState();
    expect(boardFingerprint(state, SETTINGS)).not.toBe(
      boardFingerprint(state, { ...SETTINGS, targetScore: 15 }),
    );
  });

  it('ignores zero-count partnerships (cancel round-trips leave explicit zeros)', () => {
    const withZeros = { ...baseState(), history: { a: { b: 0 }, b: { a: 0 } } };
    expect(boardFingerprint(withZeros, SETTINGS)).toBe(boardFingerprint(baseState(), SETTINGS));
  });

  it('ignores slot restore snapshots and match history', () => {
    const s1 = {
      ...baseState(),
      courts: [{ id: 'c1', status: 'playing', slots: [{ playerId: 'a', team: 1, prevQueueOrder: 3, prevWaitRounds: 2 }] }],
    };
    const s2 = {
      ...baseState(),
      matchHistory: [{ id: 'm1' }],
      courts: [{ id: 'c1', status: 'playing', slots: [{ playerId: 'a', team: 1, prevQueueOrder: 9, prevWaitRounds: 0 }] }],
    };
    expect(boardFingerprint(s1, SETTINGS)).toBe(boardFingerprint(s2, SETTINGS));
  });

  it('canonical string spells out every hashed section', () => {
    const text = canonicalBoardString(baseState(), SETTINGS);
    expect(text).toContain('p:a|0|0|0|0|0|1000|0;b|0|0|0|0|0|1000|0');
    expect(text).toContain('q:a,b');
    expect(text).toContain('c:c1|vacant|');
    expect(text).toContain('h:');
    expect(text).toContain('s:11|2|4|1|1');
  });
});
