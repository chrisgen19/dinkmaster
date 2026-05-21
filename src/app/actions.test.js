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
  ['addPlayer', () => actions.addPlayer(ARENA, 'Alice', 'Bob')],
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

    it('addPlayer() with a blank first name skips the gate and the transaction', async () => {
      const result = await actions.addPlayer(ARENA, '   ', '  ');
      expect(result.error).toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('addPlayer() with a first name proceeds past the gate to the transaction', async () => {
      await actions.addPlayer(ARENA, 'Alice', '');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('createArena() with a blank name is rejected before any write', async () => {
      const result = await actions.createArena('   ');
      expect(result.error).toBeTruthy();
      expect(prisma.arena.create).not.toHaveBeenCalled();
    });

    it('removePlayer() scopes both deletes to the arena (no cross-arena delete)', async () => {
      // Drive the real transaction callback with a fake tx so the destructive
      // queries can be inspected — this guards the cross-arena delete fix:
      // even an owner must not be able to delete another arena's player by id.
      const tx = {
        $executeRaw: vi.fn(),
        courtSlot: { findFirst: vi.fn().mockResolvedValue(null) },
        partnership: { deleteMany: vi.fn() },
        player: { deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.removePlayer(ARENA, 'player-from-another-arena');

      // The final delete must carry arenaId, not just the global id.
      expect(tx.player.deleteMany).toHaveBeenCalledWith({
        where: { id: 'player-from-another-arena', arenaId: ARENA },
      });
      expect(tx.partnership.deleteMany).toHaveBeenCalledWith({
        where: {
          arenaId: ARENA,
          OR: [
            { playerA: 'player-from-another-arena' },
            { playerB: 'player-from-another-arena' },
          ],
        },
      });
    });
  });
});
