import { describe, expect, it } from 'vitest';
import { RECENT_MATCH_WINDOW, bestMatchups, rankMatchups, recentResults } from '@/lib/pairing';

/** Build a match in the normalized shape `recentResults` consumes. */
const match = (team1, team2, score1 = 11, score2 = 5) => ({ team1, team2, score1, score2 });

/** Ranking context with sensible defaults; override per test. */
const ctx = ({ results = {}, ratings = {}, pairs = {} } = {}) => ({
  results: new Map(Object.entries(results)),
  ratings: new Map(Object.entries(ratings)),
  pairCount: (a, b) => pairs[[a, b].sort().join('|')] ?? 0,
});

const flat = (split) => [...split.team1, ...split.team2];

describe('recentResults', () => {
  it('marks the winning side W and the losing side L', () => {
    const results = recentResults([match(['a', 'b'], ['c', 'd'])], ['a', 'b', 'c', 'd']);
    expect([...results.entries()]).toEqual([
      ['a', 'W'],
      ['b', 'W'],
      ['c', 'L'],
      ['d', 'L'],
    ]);
  });

  it('reads the score, not the team number', () => {
    const results = recentResults([match(['a', 'b'], ['c', 'd'], 7, 11)], ['a', 'c']);
    expect(results.get('a')).toBe('L');
    expect(results.get('c')).toBe('W');
  });

  it('keeps only each player\'s most recent result', () => {
    const results = recentResults(
      [
        match(['a', 'x'], ['y', 'z']), // newest: a won
        match(['b', 'c'], ['a', 'd']), // older: a lost
      ],
      ['a'],
    );
    expect(results.get('a')).toBe('W');
  });

  it('returns null for a player with no match in the window', () => {
    const results = recentResults([match(['a', 'b'], ['c', 'd'])], ['a', 'newcomer']);
    expect(results.get('newcomer')).toBeNull();
  });

  it('ignores matches beyond the recent window', () => {
    const filler = Array.from({ length: RECENT_MATCH_WINDOW }, () => match(['x', 'y'], ['w', 'z']));
    const results = recentResults([...filler, match(['a', 'b'], ['c', 'd'])], ['a']);
    expect(results.get('a')).toBeNull();
  });

  it('skips tied matches rather than scoring them as a win', () => {
    const results = recentResults([match(['a', 'b'], ['c', 'd'], 9, 9)], ['a', 'c']);
    expect(results.get('a')).toBeNull();
    expect(results.get('c')).toBeNull();
  });
});

describe('rankMatchups', () => {
  const ids = ['w1', 'w2', 'l1', 'l2'];
  const flatRatings = { w1: 1000, w2: 1000, l1: 1000, l2: 1000 };

  it('puts a recent loser with a recent winner on both sides', () => {
    const [best] = rankMatchups(ids, ctx({
      results: { w1: 'W', w2: 'W', l1: 'L', l2: 'L' },
      ratings: flatRatings,
    }));
    expect(best.crossCount).toBe(2);
    for (const team of [best.team1, best.team2]) {
      expect(team.filter((id) => id.startsWith('w'))).toHaveLength(1);
      expect(team.filter((id) => id.startsWith('l'))).toHaveLength(1);
    }
  });

  it('breaks a cross tie by the closer-rated split', () => {
    // Both crossed splits pair one W with one L; only the ratings differ.
    const [best] = rankMatchups(ids, ctx({
      results: { w1: 'W', w2: 'W', l1: 'L', l2: 'L' },
      ratings: { w1: 1200, w2: 1000, l1: 800, l2: 1000 },
    }));
    expect(best.crossCount).toBe(2);
    expect(best.ratingGap).toBe(0); // w1+l1 (1000) vs w2+l2 (1000)
    expect(new Set(best.team1)).toEqual(new Set(['w1', 'l1']));
  });

  it('breaks a cross+rating tie by fewest repeat partnerships', () => {
    const [best] = rankMatchups(ids, ctx({
      results: { w1: 'W', w2: 'W', l1: 'L', l2: 'L' },
      ratings: flatRatings,
      pairs: { 'l1|w1': 5, 'l2|w2': 5 },
    }));
    expect(best.crossCount).toBe(2);
    expect(best.repeats).toBe(0);
    expect(new Set(best.team1)).toEqual(new Set(['w1', 'l2']));
  });

  it('falls back to the closest-rated split when nobody has a recent result', () => {
    const [best] = rankMatchups(ids, ctx({
      ratings: { w1: 1200, w2: 1100, l1: 900, l2: 800 },
    }));
    expect(best.crossCount).toBe(0);
    // Strongest with weakest is the balanced split: 1200+800 vs 1100+900.
    expect(best.ratingGap).toBe(0);
  });

  it('still crosses the lone loser when three players just won', () => {
    const ranked = rankMatchups(['w1', 'w2', 'w3', 'l1'], ctx({
      results: { w1: 'W', w2: 'W', w3: 'W', l1: 'L' },
      ratings: { w1: 1000, w2: 1000, w3: 1000, l1: 1000 },
    }));
    // Only one side can be crossed — but it must be.
    expect(ranked[0].crossCount).toBe(1);
  });

  it('always returns all three splits over the same four players', () => {
    const ranked = rankMatchups(ids, ctx({ ratings: flatRatings }));
    expect(ranked).toHaveLength(3);
    for (const split of ranked) {
      expect(split.team1).toHaveLength(2);
      expect(split.team2).toHaveLength(2);
      expect([...flat(split)].sort()).toEqual([...ids].sort());
    }
  });
});

describe('rankMatchups — legacy mode (balanced: false)', () => {
  const ids = ['w1', 'w2', 'l1', 'l2'];

  it('ignores recent results and ratings entirely', () => {
    const ranked = rankMatchups(ids, {
      ...ctx({
        results: { w1: 'W', w2: 'W', l1: 'L', l2: 'L' },
        ratings: { w1: 1200, w2: 1000, l1: 800, l2: 1000 },
      }),
      balanced: false,
    });
    // Both skill keys are neutralised, so no split can win on them.
    for (const split of ranked) {
      expect(split.crossCount).toBe(0);
      expect(split.ratingGap).toBe(0);
    }
  });

  it('picks the fewest repeat partnerships, reproducing the pre-toggle rule', () => {
    const [best] = rankMatchups(ids, {
      ...ctx({
        // Ratings and results that WOULD steer the balanced rule elsewhere.
        results: { w1: 'W', w2: 'W', l1: 'L', l2: 'L' },
        ratings: { w1: 1200, w2: 1000, l1: 800, l2: 1000 },
        pairs: { 'l1|w1': 4, 'l2|w2': 4, 'l2|w1': 4, 'l1|w2': 4 },
      }),
      balanced: false,
    });
    // Every crossed pair is expensive; only w1+w2 vs l1+l2 costs nothing.
    expect(best.repeats).toBe(0);
    expect(new Set(best.team1)).toEqual(new Set(['w1', 'w2']));
    expect(best.crossCount).toBe(0);
  });

  it('leaves all three splits tied when no pair has partnered', () => {
    const ranked = rankMatchups(ids, {
      ...ctx({ ratings: { w1: 1200, w2: 1000, l1: 800, l2: 1000 } }),
      balanced: false,
    });
    // Tied on every key, so the caller's random tie-break decides — exactly
    // the old `shuffle(matchups.filter(minWeight))[0]` behaviour.
    expect(bestMatchups(ranked)).toHaveLength(3);
  });

  it('defaults to balanced when the flag is omitted', () => {
    const [best] = rankMatchups(ids, ctx({
      results: { w1: 'W', w2: 'W', l1: 'L', l2: 'L' },
      ratings: { w1: 1000, w2: 1000, l1: 1000, l2: 1000 },
    }));
    expect(best.crossCount).toBe(2);
  });
});

describe('bestMatchups', () => {
  it('returns every split tied on all three keys', () => {
    // Flat ratings, no history, no results: all three splits are equivalent.
    const ranked = rankMatchups(['a', 'b', 'c', 'd'], ctx({
      ratings: { a: 1000, b: 1000, c: 1000, d: 1000 },
    }));
    expect(bestMatchups(ranked)).toHaveLength(3);
  });

  it('narrows to the single best split when one strictly wins', () => {
    const ranked = rankMatchups(['w1', 'w2', 'l1', 'l2'], ctx({
      results: { w1: 'W', w2: 'W', l1: 'L', l2: 'L' },
      ratings: { w1: 1200, w2: 1000, l1: 800, l2: 1000 },
    }));
    expect(bestMatchups(ranked)).toHaveLength(1);
  });
});
