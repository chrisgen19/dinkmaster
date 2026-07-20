import { describe, it, expect } from 'vitest';
import {
  OFFLINE_HOLD_TTL_MS,
  OFFLINE_UNAVAILABLE_MESSAGE,
  appendEvent,
  createPendingLog,
  engineSettings,
  holdExpiryDelay,
  isHoldActive,
  replayEvents,
} from './arena-offline-state';
import { resolveCommand } from '@/lib/board-engine';
import { RATING_BASELINE } from '@/lib/rating';

const SETTINGS = {
  targetScore: 11,
  starveThreshold: 2,
  emergencyWait: 4,
  skipRestoresPriority: true,
  skipPickReplacement: true,
};

const makePlayer = (id) => ({
  id,
  userId: null,
  firstName: id.toUpperCase(),
  lastName: null,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  waitRounds: 0,
  rating: RATING_BASELINE,
  skipBoosted: false,
  gamesOffset: 0,
});

const makeState = () => ({
  players: ['a', 'b', 'c', 'd', 'e'].map(makePlayer),
  queue: ['a', 'b', 'c', 'd', 'e'],
  courts: [
    { id: 'c1', name: 'Court 1', status: 'vacant', team1: [], team2: [], fillBumpedPlayerIds: [], slots: [] },
  ],
  matchHistory: [],
  history: {},
  lastSessionResetAt: null,
});

let n = 0;
const opts = () => ({
  rng: () => 0.42,
  now: () => '2026-07-20T10:00:00.000Z',
  makeId: (prefix) => `${prefix}_${++n}`,
});

describe('engineSettings', () => {
  it('maps the arena page props onto the engine settings shape', () => {
    expect(
      engineSettings({
        matchmaking: {
          starveThreshold: 3,
          emergencyWait: 5,
          skipRestoresPriority: false,
          skipPickReplacement: true,
        },
        matchDefaults: { targetScore: 15, leaderboardSize: 5 },
      }),
    ).toEqual({
      targetScore: 15,
      starveThreshold: 3,
      emergencyWait: 5,
      skipRestoresPriority: false,
      skipPickReplacement: true,
    });
  });
});

describe('createPendingLog / appendEvent', () => {
  it('creates an empty per-arena log carrying batch identity, base and settings', () => {
    const log = createPendingLog({
      arenaId: 'ar1',
      batchId: 'batch-1',
      baseFetchedAt: 1234,
      baseFingerprint: 'cafe0123',
      settings: SETTINGS,
      enteredAt: '2026-07-20T10:00:00.000Z',
    });
    expect(log).toEqual({
      arenaId: 'ar1',
      batchId: 'batch-1',
      base: { fetchedAt: 1234, fingerprint: 'cafe0123' },
      settings: SETTINGS,
      events: [],
      enteredAt: '2026-07-20T10:00:00.000Z',
    });
  });

  it('defaults a missing base to nulls (first visit was never online)', () => {
    const log = createPendingLog({ arenaId: 'ar1', batchId: 'b', settings: SETTINGS, enteredAt: 'now' });
    expect(log.base).toEqual({ fetchedAt: null, fingerprint: null });
  });

  it('appends events immutably, preserving order', () => {
    const log = createPendingLog({ arenaId: 'ar1', batchId: 'b', settings: SETTINGS, enteredAt: 'now' });
    const one = appendEvent(log, { id: 'e1' });
    const two = appendEvent(one, { id: 'e2' });
    expect(log.events).toEqual([]);
    expect(one.events.map((e) => e.id)).toEqual(['e1']);
    expect(two.events.map((e) => e.id)).toEqual(['e1', 'e2']);
  });
});

describe('replayEvents', () => {
  it('replays a resolved sequence to the exact same state', () => {
    const state = makeState();
    const o = opts();
    const first = resolveCommand(state, SETTINGS, { type: 'checkOut', playerId: 'e' }, o);
    const second = resolveCommand(first.state, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, o);
    const replay = replayEvents(state, SETTINGS, [first.event, second.event]);
    expect(replay.stoppedAt).toBeNull();
    expect(replay.appliedCount).toBe(2);
    expect(replay.state).toEqual(second.state);
  });

  it('stops at the first event that no longer applies and reports its id', () => {
    const state = makeState();
    const o = opts();
    const fill = resolveCommand(state, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, o);
    // Replaying the same fill twice: the court is already playing.
    const replay = replayEvents(state, SETTINGS, [fill.event, fill.event]);
    expect(replay.appliedCount).toBe(1);
    expect(replay.stoppedAt).toBe(fill.event.id);
    expect(replay.state).toEqual(fill.state);
  });

  it('counts clean no-op events as applied and handles an empty/missing list', () => {
    const state = makeState();
    const noop = { id: 'e-noop', type: 'checkOut', occurredAt: 'now', payload: { playerId: 'ghost' }, outcome: null };
    expect(replayEvents(state, SETTINGS, [noop])).toEqual({ state, appliedCount: 1, stoppedAt: null });
    expect(replayEvents(state, SETTINGS, [])).toEqual({ state, appliedCount: 0, stoppedAt: null });
    expect(replayEvents(state, SETTINGS, undefined)).toEqual({ state, appliedCount: 0, stoppedAt: null });
  });
});

describe('OFFLINE_UNAVAILABLE_MESSAGE', () => {
  it('is user-facing copy', () => {
    expect(OFFLINE_UNAVAILABLE_MESSAGE).toMatch(/offline/i);
  });
});

describe('isHoldActive', () => {
  const NOW = Date.parse('2026-07-20T12:00:00.000Z');

  it('is true for a fresh hold and false past the TTL', () => {
    const fresh = { label: 'Chris D.', heldAt: '2026-07-20T11:00:00.000Z' };
    const stale = { label: 'Chris D.', heldAt: '2026-07-19T11:00:00.000Z' };
    expect(isHoldActive(fresh, NOW)).toBe(true);
    expect(isHoldActive(stale, NOW)).toBe(false);
  });

  it('rejects missing, partial, or unparseable holds', () => {
    expect(isHoldActive(null, NOW)).toBe(false);
    expect(isHoldActive(undefined, NOW)).toBe(false);
    expect(isHoldActive({ label: '', heldAt: '2026-07-20T11:00:00.000Z' }, NOW)).toBe(false);
    expect(isHoldActive({ label: 'X', heldAt: 'not-a-date' }, NOW)).toBe(false);
  });
});

describe('holdExpiryDelay', () => {
  const NOW = Date.parse('2026-07-20T12:00:00.000Z');

  it('returns the remaining TTL so a viewer can schedule the banner flip', () => {
    // Held one hour ago, so seven of the eight hours remain.
    const hold = { label: 'Chris D.', heldAt: '2026-07-20T11:00:00.000Z' };
    expect(holdExpiryDelay(hold, NOW)).toBe(OFFLINE_HOLD_TTL_MS - 60 * 60 * 1000);
  });

  it('returns null when there is nothing to expire', () => {
    expect(holdExpiryDelay(null, NOW)).toBeNull();
    expect(holdExpiryDelay({ label: 'Chris D.', heldAt: '2026-07-19T11:00:00.000Z' }, NOW)).toBeNull();
    expect(holdExpiryDelay({ label: 'X', heldAt: 'not-a-date' }, NOW)).toBeNull();
  });
});
