import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth guard, the state reader, and Prisma so the actions run with no
// database. The point of these tests is the auth gate, not the rotation logic.
vi.mock('@/lib/session', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data', () => ({
  getState: vi.fn(async () => ({
    players: [],
    queue: [],
    courts: [],
    matchHistory: [],
    history: {},
  })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: vi.fn(), court: { findMany: vi.fn() }, player: { count: vi.fn() } },
}));

import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import * as actions from '@/app/actions';

const AUTH_ERROR = 'Please sign in to manage the arena.';

// Every mutating action, with representative arguments.
const MUTATIONS = [
  ['addPlayers', () => actions.addPlayers('Alice, Bob')],
  ['removePlayer', () => actions.removePlayer('p1')],
  ['shuffleQueue', () => actions.shuffleQueue()],
  ['fillCourt', () => actions.fillCourt('c1')],
  ['endMatch', () => actions.endMatch('c1', 11, 5, true)],
  ['addCourt', () => actions.addCourt()],
  ['removeCourt', () => actions.removeCourt('c1')],
  ['resetArena', () => actions.resetArena()],
];

describe('arena server actions — auth gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('unauthenticated callers', () => {
    beforeEach(() => {
      requireUser.mockResolvedValue({ error: AUTH_ERROR });
    });

    for (const [name, call] of MUTATIONS) {
      it(`${name}() returns the auth error and does not mutate`, async () => {
        const result = await call();
        expect(result.error).toBe(AUTH_ERROR);
        // $transaction is the single entry point for every mutation — if it was
        // never called, nothing was written.
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    }
  });

  describe('authenticated callers', () => {
    beforeEach(() => {
      requireUser.mockResolvedValue({ user: { id: 'u1', name: 'Organizer' } });
    });

    it('addPlayers() with no names skips the auth error and the transaction', async () => {
      // Authenticated + empty input: a valid no-op, not an auth rejection.
      const result = await actions.addPlayers('   ,  ');
      expect(result.error).toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('addPlayers() with names proceeds past the auth gate to the transaction', async () => {
      await actions.addPlayers('Alice');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
