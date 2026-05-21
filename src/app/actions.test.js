import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth guards, the state reader, and Prisma so the actions run with
// no database. The point of these tests is the auth/ownership gate.
vi.mock('@/lib/session', () => ({
  requireUser: vi.fn(),
  requireArenaOwner: vi.fn(),
}));
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
  prisma: {
    $transaction: vi.fn(),
    arena: { create: vi.fn(), update: vi.fn() },
    court: { findMany: vi.fn() },
    player: { count: vi.fn() },
  },
}));

import { requireUser, requireArenaOwner } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import * as actions from '@/app/actions';

const AUTH_ERROR = 'Only the arena owner can manage this arena.';
const ARENA = 'arena_test';

// Every owner-gated mutation, with representative arguments.
const OWNER_MUTATIONS = [
  ['addPlayers', () => actions.addPlayers(ARENA, 'Alice, Bob')],
  ['removePlayer', () => actions.removePlayer(ARENA, 'p1')],
  ['shuffleQueue', () => actions.shuffleQueue(ARENA)],
  ['fillCourt', () => actions.fillCourt(ARENA, 'c1')],
  ['endMatch', () => actions.endMatch(ARENA, 'c1', 11, 5, true)],
  ['addCourt', () => actions.addCourt(ARENA)],
  ['removeCourt', () => actions.removeCourt(ARENA, 'c1')],
  ['resetArena', () => actions.resetArena(ARENA)],
  ['renameArena', () => actions.renameArena(ARENA, 'New Name')],
];

describe('arena server actions — auth & ownership gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('non-owner / unauthenticated callers', () => {
    beforeEach(() => {
      requireArenaOwner.mockResolvedValue({ error: AUTH_ERROR });
      requireUser.mockResolvedValue({ error: AUTH_ERROR });
    });

    for (const [name, call] of OWNER_MUTATIONS) {
      it(`${name}() returns the auth error and does not mutate`, async () => {
        const result = await call();
        expect(result.error).toBe(AUTH_ERROR);
        // $transaction is the single entry point for every mutation — if it
        // was never called, nothing was written.
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.arena.update).not.toHaveBeenCalled();
      });
    }

    it('createArena() returns the auth error and creates nothing', async () => {
      const result = await actions.createArena('My Arena');
      expect(result.error).toBe(AUTH_ERROR);
      expect(prisma.arena.create).not.toHaveBeenCalled();
    });
  });

  describe('the arena owner', () => {
    beforeEach(() => {
      requireArenaOwner.mockResolvedValue({
        user: { id: 'u1', name: 'Owner' },
        arena: { id: ARENA, name: 'Test Arena', ownerId: 'u1' },
      });
      requireUser.mockResolvedValue({ user: { id: 'u1', name: 'Owner' } });
    });

    it('addPlayers() with no names skips the gate and the transaction', async () => {
      const result = await actions.addPlayers(ARENA, '   ,  ');
      expect(result.error).toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('addPlayers() with names proceeds past the gate to the transaction', async () => {
      await actions.addPlayers(ARENA, 'Alice');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('createArena() with a blank name is rejected before any write', async () => {
      const result = await actions.createArena('   ');
      expect(result.error).toBeTruthy();
      expect(prisma.arena.create).not.toHaveBeenCalled();
    });
  });
});
