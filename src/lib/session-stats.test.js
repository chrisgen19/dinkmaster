import { describe, it, expect } from 'vitest';
import { computeSessionStats } from './session-stats';

/** Convenience match builder. `t` is an offset from the cutoff in minutes. */
function m({ team1, team2, score1, score2, t }) {
  return {
    team1: team1.map((id) => ({ id })),
    team2: team2.map((id) => ({ id })),
    score1,
    score2,
    timestamp: new Date(BASE + t * 60_000).toISOString(),
  };
}
const BASE = Date.parse('2026-05-26T00:00:00Z');
const CUTOFF = new Date(BASE).toISOString();

describe('computeSessionStats', () => {
  it('returns an empty Map for no matches', () => {
    const out = computeSessionStats([], CUTOFF);
    expect(out.size).toBe(0);
  });

  it('counts every match when sessionStart is null (never-reset arena)', () => {
    const matches = [
      m({ team1: ['a', 'b'], team2: ['c', 'd'], score1: 11, score2: 7, t: -60 }),
      m({ team1: ['c', 'd'], team2: ['a', 'b'], score1: 11, score2: 9, t: 10 }),
    ];
    const out = computeSessionStats(matches, null);
    expect(out.get('a')).toEqual({ games: 2, wins: 1, losses: 1 });
    expect(out.get('b')).toEqual({ games: 2, wins: 1, losses: 1 });
    expect(out.get('c')).toEqual({ games: 2, wins: 1, losses: 1 });
    expect(out.get('d')).toEqual({ games: 2, wins: 1, losses: 1 });
  });

  it('treats undefined sessionStart the same as null (default arg path)', () => {
    const matches = [
      m({ team1: ['a'], team2: ['b'], score1: 11, score2: 7, t: -60 }),
      m({ team1: ['a'], team2: ['b'], score1: 11, score2: 9, t: 10 }),
    ];
    const out = computeSessionStats(matches, undefined);
    expect(out.get('a')).toEqual({ games: 2, wins: 2, losses: 0 });
    expect(out.get('b')).toEqual({ games: 2, wins: 0, losses: 2 });
  });

  it('drops matches that finished before the session boundary', () => {
    const matches = [
      m({ team1: ['a', 'b'], team2: ['c', 'd'], score1: 11, score2: 7, t: -60 }), // pre-reset
      m({ team1: ['a', 'c'], team2: ['b', 'd'], score1: 11, score2: 5, t: 5 }), // post-reset
    ];
    const out = computeSessionStats(matches, CUTOFF);
    expect(out.get('a')).toEqual({ games: 1, wins: 1, losses: 0 });
    expect(out.get('b')).toEqual({ games: 1, wins: 0, losses: 1 });
    expect(out.get('c')).toEqual({ games: 1, wins: 1, losses: 0 });
    expect(out.get('d')).toEqual({ games: 1, wins: 0, losses: 1 });
  });

  it('includes matches at exactly the cutoff (inclusive boundary)', () => {
    const matches = [m({ team1: ['a'], team2: ['b'], score1: 11, score2: 9, t: 0 })];
    const out = computeSessionStats(matches, CUTOFF);
    expect(out.get('a')).toEqual({ games: 1, wins: 1, losses: 0 });
    expect(out.get('b')).toEqual({ games: 1, wins: 0, losses: 1 });
  });

  it('treats ties as a played game but no win and no loss', () => {
    const matches = [m({ team1: ['a'], team2: ['b'], score1: 11, score2: 11, t: 5 })];
    const out = computeSessionStats(matches, CUTOFF);
    expect(out.get('a')).toEqual({ games: 1, wins: 0, losses: 0 });
    expect(out.get('b')).toEqual({ games: 1, wins: 0, losses: 0 });
  });

  it('returns no entry for a player who never appears in a counted match', () => {
    const matches = [m({ team1: ['a'], team2: ['b'], score1: 11, score2: 7, t: 5 })];
    const out = computeSessionStats(matches, CUTOFF);
    expect(out.has('z')).toBe(false);
  });

  it('omits players who only appear in pre-cutoff matches (rack tile reads 0)', () => {
    // `preOnly` plays before the cutoff, `post` plays after. The overlay in
    // arena.js falls back to {games:0, wins:0, losses:0} when a player has
    // no entry — so this case is what makes the rack tile show 0/0/0 for
    // someone who hasn't played yet this session.
    const matches = [
      m({ team1: ['preOnly'], team2: ['post'], score1: 11, score2: 7, t: -30 }),
      m({ team1: ['post'], team2: ['other'], score1: 11, score2: 7, t: 5 }),
    ];
    const out = computeSessionStats(matches, CUTOFF);
    expect(out.has('preOnly')).toBe(false);
    expect(out.get('post')).toEqual({ games: 1, wins: 1, losses: 0 });
    expect(out.get('other')).toEqual({ games: 1, wins: 0, losses: 1 });
  });

  it('accepts a Date instance for sessionStart', () => {
    const matches = [
      m({ team1: ['a'], team2: ['b'], score1: 11, score2: 9, t: -10 }),
      m({ team1: ['a'], team2: ['b'], score1: 11, score2: 9, t: 10 }),
    ];
    const out = computeSessionStats(matches, new Date(BASE));
    expect(out.get('a')).toEqual({ games: 1, wins: 1, losses: 0 });
  });
});
