import { describe, it, expect } from 'vitest';
import { computeMatchRatings, eloToDupr, RATING_BASELINE } from '@/lib/rating';

/** Sum of all four ratings — Elo is zero-sum, so this is invariant per match. */
const total = ({ team1, team2 }) => team1[0] + team1[1] + team2[0] + team2[1];

describe('computeMatchRatings', () => {
  const even = [RATING_BASELINE, RATING_BASELINE];

  it('moves the winning team up and the losing team down by an equal amount', () => {
    const next = computeMatchRatings({ team1: even, team2: even, outcome: 1 });
    expect(next.team1[0]).toBeGreaterThan(RATING_BASELINE);
    expect(next.team1[1]).toBe(next.team1[0]); // teammates share the delta
    expect(next.team2[0]).toBeLessThan(RATING_BASELINE);
    expect(RATING_BASELINE - next.team2[0]).toBe(next.team1[0] - RATING_BASELINE);
  });

  it('is zero-sum — the four ratings always sum to their pre-match total', () => {
    const before = even[0] * 2 + even[1] * 2;
    for (const outcome of [0, 1, 2]) {
      expect(total(computeMatchRatings({ team1: even, team2: even, outcome }))).toBe(before);
    }
  });

  it('awards an even win 16 points (K=32, expected 0.5)', () => {
    const next = computeMatchRatings({ team1: even, team2: even, outcome: 1 });
    expect(next.team1[0] - RATING_BASELINE).toBe(16);
  });

  it('leaves evenly-matched teams unchanged on a tie', () => {
    const next = computeMatchRatings({ team1: even, team2: even, outcome: 0 });
    expect(next.team1[0]).toBe(RATING_BASELINE);
    expect(next.team2[0]).toBe(RATING_BASELINE);
  });

  it('rewards an underdog win more than a favourite win', () => {
    const underdog = computeMatchRatings({ team1: [800, 800], team2: [1200, 1200], outcome: 1 });
    const favourite = computeMatchRatings({ team1: [1200, 1200], team2: [800, 800], outcome: 1 });
    expect(underdog.team1[0] - 800).toBeGreaterThan(favourite.team1[0] - 1200);
  });

  it('uses the team average, so a mixed pair plays as its midpoint', () => {
    const mixed = computeMatchRatings({ team1: [1400, 600], team2: even, outcome: 1 });
    const midpoint = computeMatchRatings({ team1: [1000, 1000], team2: even, outcome: 1 });
    // avg(1400,600) == 1000, so both teammates gain the same delta as an even team.
    expect(mixed.team1[0] - 1400).toBe(midpoint.team1[0] - 1000);
  });
});

describe('eloToDupr', () => {
  it('maps the baseline Elo to 3.5 DUPR', () => {
    expect(eloToDupr(RATING_BASELINE)).toBe(3.5);
  });

  it('maps every 100 Elo points to 0.5 DUPR points', () => {
    expect(eloToDupr(1100)).toBeCloseTo(4.0);
    expect(eloToDupr(900)).toBeCloseTo(3.0);
  });

  it('clamps the display to the 2.0–8.0 range', () => {
    expect(eloToDupr(100)).toBe(2.0); // far below
    expect(eloToDupr(5000)).toBe(8.0); // far above
  });
});
