import { describe, it, expect } from 'vitest';
import { validateLineup, diffLineup, pairKey } from '@/lib/court-lineup';

describe('validateLineup', () => {
  it('accepts four distinct ids, two per team', () => {
    expect(validateLineup(['a', 'b'], ['c', 'd'])).toEqual({ ok: true });
  });

  it('rejects wrong team sizes', () => {
    expect(validateLineup(['a'], ['b', 'c', 'd'])).toEqual({ ok: false, reason: 'WRONG_TEAM_SIZE' });
    expect(validateLineup(['a', 'b', 'c'], ['d'])).toEqual({ ok: false, reason: 'WRONG_TEAM_SIZE' });
  });

  it('rejects a player appearing twice', () => {
    expect(validateLineup(['a', 'b'], ['a', 'c'])).toEqual({ ok: false, reason: 'DUPLICATE_PLAYER' });
  });

  it('rejects non-string / empty ids', () => {
    expect(validateLineup(['a', ''], ['c', 'd'])).toEqual({ ok: false, reason: 'BAD_ID' });
    expect(validateLineup(['a', 2], ['c', 'd'])).toEqual({ ok: false, reason: 'BAD_ID' });
  });

  it('rejects non-array input', () => {
    expect(validateLineup(null, ['c', 'd'])).toEqual({ ok: false, reason: 'NOT_ARRAYS' });
  });
});

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
    expect(pairKey('a', 'b')).toBe('a|b');
  });
});

describe('diffLineup', () => {
  it('reports no change when the lineup is identical', () => {
    const lineup = { team1: ['a', 'b'], team2: ['c', 'd'] };
    const d = diffLineup(lineup, lineup);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.pairsToBump).toEqual([]);
    expect(d.pairsToUnbump).toEqual([]);
    expect(d.changed).toBe(false);
  });

  it('treats a within-team reorder as unchanged (canonical pairing)', () => {
    const d = diffLineup(
      { team1: ['a', 'b'], team2: ['c', 'd'] },
      { team1: ['b', 'a'], team2: ['d', 'c'] },
    );
    expect(d.changed).toBe(false);
    expect(d.pairsToBump).toEqual([]);
    expect(d.pairsToUnbump).toEqual([]);
  });

  it('handles a partner swap: no add/remove, both pairs change', () => {
    // a was with b, c was with d -> a now with c, b now with d.
    const d = diffLineup(
      { team1: ['a', 'b'], team2: ['c', 'd'] },
      { team1: ['a', 'c'], team2: ['b', 'd'] },
    );
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toBe(true);
    expect(new Set(d.pairsToUnbump.map(([x, y]) => pairKey(x, y)))).toEqual(
      new Set([pairKey('a', 'b'), pairKey('c', 'd')]),
    );
    expect(new Set(d.pairsToBump.map(([x, y]) => pairKey(x, y)))).toEqual(
      new Set([pairKey('a', 'c'), pairKey('b', 'd')]),
    );
  });

  it('handles a single substitution: one added, one removed, one pair changes', () => {
    // d subbed out for e on team2; team1 (a,b) untouched.
    const d = diffLineup(
      { team1: ['a', 'b'], team2: ['c', 'd'] },
      { team1: ['a', 'b'], team2: ['c', 'e'] },
    );
    expect(d.added).toEqual(['e']);
    expect(d.removed).toEqual(['d']);
    expect(d.changed).toBe(true);
    // team1 pair unchanged -> not in either list.
    expect(d.pairsToUnbump.map(([x, y]) => pairKey(x, y))).toEqual([pairKey('c', 'd')]);
    expect(d.pairsToBump.map(([x, y]) => pairKey(x, y))).toEqual([pairKey('c', 'e')]);
  });

  it('emits canonically-ordered pairs', () => {
    const d = diffLineup(
      { team1: ['b', 'a'], team2: ['c', 'd'] },
      { team1: ['z', 'a'], team2: ['c', 'd'] },
    );
    // a paired with z -> canonical [a, z]
    expect(d.pairsToBump).toEqual([['a', 'z']]);
  });
});
