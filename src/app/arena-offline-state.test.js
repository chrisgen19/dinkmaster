import { describe, it, expect } from 'vitest';
import {
  OFFLINE_UNAVAILABLE_MESSAGE,
  appendEvent,
  createPendingLog,
  engineSettings,
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
