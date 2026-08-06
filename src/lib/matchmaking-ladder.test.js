import { describe, it, expect } from 'vitest';
import { autoMixKey, compareAutoMix } from './matchmaking';

// Ladder ("king of the court") ordering. The comparator is shared by the server
// (`applyAutoMixTx`) and the offline engine, so these cover both.

const THRESHOLDS = { starveThreshold: 2, emergencyWait: 4 };

/** A queued paddle. `rand` is pinned so ties resolve deterministically. */
const paddle = (id, overrides = {}) => ({
  id,
  waitRounds: 0,
  gamesPlayed: 0,
  gamesOffset: 0,
  skipBoosted: false,
  ...overrides,
});

/** Order ids the way the auto-mix would. `records` is a Map, as the callers pass. */
const order = (players, records = null, rands = {}) =>
  players
    .map((p) =>
      autoMixKey(p, {
        ...THRESHOLDS,
        skipRestoresPriority: true,
        record: records?.get(p.id) ?? null,
        rand: rands[p.id] ?? 0,
      }),
    )
    .sort(compareAutoMix)
    .map((k) => k.id);

describe('autoMixKey / compareAutoMix — ladder off', () => {
  it('is unchanged from the pre-ladder ordering: fewest games first', () => {
    // No records passed, so every ladder field is 0 and the two ladder
    // comparisons are no-ops.
    const players = [
      paddle('busy', { gamesPlayed: 5 }),
      paddle('fresh', { gamesPlayed: 1 }),
      paddle('middle', { gamesPlayed: 3 }),
    ];
    expect(order(players)).toEqual(['fresh', 'middle', 'busy']);
  });

  it('counts gamesOffset so a latecomer sorts as a peer, not catch-up', () => {
    const players = [
      paddle('regular', { gamesPlayed: 6, gamesOffset: 0 }),
      paddle('latecomer', { gamesPlayed: 0, gamesOffset: 6 }),
      paddle('rested', { gamesPlayed: 2, gamesOffset: 0 }),
    ];
    expect(order(players)[0]).toBe('rested');
  });
});

describe('autoMixKey / compareAutoMix — ladder on', () => {
  const records = new Map([
    ['winner', { games: 3, wins: 3, losses: 0 }],
    ['mid', { games: 3, wins: 1, losses: 2 }],
    ['loser', { games: 3, wins: 0, losses: 3 }],
  ]);

  it('groups winners ahead of losers', () => {
    const players = [paddle('loser'), paddle('mid'), paddle('winner')];
    expect(order(players, records)).toEqual(['winner', 'mid', 'loser']);
  });

  it('breaks a wins tie on win rate', () => {
    // Both have 2 wins; the one who needed fewer games ranks higher.
    const r = new Map([
      ['efficient', { games: 2, wins: 2, losses: 0 }],
      ['grinder', { games: 5, wins: 2, losses: 3 }],
    ]);
    expect(order([paddle('grinder'), paddle('efficient')], r)).toEqual(['efficient', 'grinder']);
  });

  it('falls back to fewest games when records are identical', () => {
    const r = new Map([
      ['played-more', { games: 2, wins: 1, losses: 1 }],
      ['played-less', { games: 2, wins: 1, losses: 1 }],
    ]);
    const players = [
      paddle('played-more', { gamesPlayed: 8 }),
      paddle('played-less', { gamesPlayed: 2 }),
    ];
    expect(order(players, r)).toEqual(['played-less', 'played-more']);
  });

  it('treats a player with no record yet as 0-0, behind anyone with a win', () => {
    // Arriving mid-session shouldn't jump you to the top of the ladder.
    const players = [paddle('newcomer'), paddle('winner')];
    expect(order(players, records)).toEqual(['winner', 'newcomer']);
  });

  it('does not let a tie-heavy record inflate the ladder', () => {
    // Ties give a game but no win (computeActivityStats' convention), so a
    // player who only tied ranks below a single winner.
    const r = new Map([
      ['tied-lots', { games: 5, wins: 0, losses: 0 }],
      ['won-once', { games: 1, wins: 1, losses: 0 }],
    ]);
    expect(order([paddle('tied-lots'), paddle('won-once')], r)).toEqual(['won-once', 'tied-lots']);
  });
});

describe('wait bands outrank the ladder', () => {
  const records = new Map([
    ['champion', { games: 4, wins: 4, losses: 0 }],
    ['struggling', { games: 4, wins: 0, losses: 4 }],
  ]);

  it('pulls a starving loser above an undefeated player', () => {
    // The guarantee that makes ladder mode safe: a small losers' pool can't
    // strand anyone, because the protected band still cuts the line.
    const players = [
      paddle('champion', { waitRounds: 0 }),
      paddle('struggling', { waitRounds: 2 }), // hits starveThreshold
    ];
    expect(order(players, records)).toEqual(['struggling', 'champion']);
  });

  it('orders the emergency band strictly by longest wait, ignoring record', () => {
    const players = [
      paddle('champion', { waitRounds: 4 }),
      paddle('struggling', { waitRounds: 6 }),
    ];
    expect(order(players, records)).toEqual(['struggling', 'champion']);
  });

  it('keeps a returning skipped paddle above everyone', () => {
    const players = [
      paddle('champion', { waitRounds: 3 }),
      paddle('struggling', { skipBoosted: true }),
    ];
    expect(order(players, records)).toEqual(['struggling', 'champion']);
  });

  it('applies the ladder only WITHIN a band, not across bands', () => {
    // Two protected players sort by record; a fresh winner still sits below both.
    const r = new Map([
      ['protected-loser', { games: 2, wins: 0, losses: 2 }],
      ['protected-winner', { games: 2, wins: 2, losses: 0 }],
      ['fresh-winner', { games: 3, wins: 3, losses: 0 }],
    ]);
    const players = [
      paddle('fresh-winner', { waitRounds: 0 }),
      paddle('protected-loser', { waitRounds: 2 }),
      paddle('protected-winner', { waitRounds: 2 }),
    ];
    expect(order(players, r)).toEqual(['protected-winner', 'protected-loser', 'fresh-winner']);
  });
});
