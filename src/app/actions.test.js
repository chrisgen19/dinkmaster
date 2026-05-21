import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth guards, the state reader, and Prisma so the actions run with
// no database. These tests cover authorization and pure-logic guards.
vi.mock('@/lib/session', () => ({
  requireUser: vi.fn(),
  requireArenaOwner: vi.fn(),
  requireArenaManager: vi.fn(),
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
    arena: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    arenaMembership: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    court: { findMany: vi.fn() },
    player: { count: vi.fn() },
  },
}));

import { requireUser, requireArenaOwner, requireArenaManager } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { ROLES } from '@/lib/roles';
import * as actions from '@/app/actions';

const ARENA = 'arena_test';
const ERR = 'denied';

// Owner-or-organizer gated (requireArenaManager).
const PLAY = [
  ['addPlayers', () => actions.addPlayers(ARENA, 'Alice')],
  ['removePlayer', () => actions.removePlayer(ARENA, 'p1')],
  ['shuffleQueue', () => actions.shuffleQueue(ARENA)],
  ['fillCourt', () => actions.fillCourt(ARENA, 'c1')],
  ['endMatch', () => actions.endMatch(ARENA, 'c1', 11, 5, true)],
  ['addCourt', () => actions.addCourt(ARENA)],
  ['removeCourt', () => actions.removeCourt(ARENA, 'c1')],
  ['resetArena', () => actions.resetArena(ARENA)],
];
// Owner-only gated (requireArenaOwner).
const OWNER_ONLY = [
  ['renameArena', () => actions.renameArena(ARENA, 'New')],
  ['updateMemberRole', () => actions.updateMemberRole(ARENA, 'u2', ROLES.ORGANIZER)],
  ['removeMember', () => actions.removeMember(ARENA, 'u2')],
  ['transferOwnership', () => actions.transferOwnership(ARENA, 'u2')],
];
// Any signed-in user (requireUser).
const USER_GATED = [
  ['createArena', () => actions.createArena('My Arena')],
  ['joinArena', () => actions.joinArena(ARENA)],
  ['leaveArena', () => actions.leaveArena(ARENA)],
];

describe('arena server actions — authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('denied callers', () => {
    beforeEach(() => {
      requireArenaManager.mockResolvedValue({ error: ERR });
      requireArenaOwner.mockResolvedValue({ error: ERR });
      requireUser.mockResolvedValue({ error: ERR });
    });

    for (const [name, call] of [...PLAY, ...OWNER_ONLY, ...USER_GATED]) {
      it(`${name}() returns the auth error and writes nothing`, async () => {
        const result = await call();
        expect(result.error).toBe(ERR);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.arena.create).not.toHaveBeenCalled();
        expect(prisma.arena.update).not.toHaveBeenCalled();
        expect(prisma.arenaMembership.upsert).not.toHaveBeenCalled();
        expect(prisma.arenaMembership.updateMany).not.toHaveBeenCalled();
        expect(prisma.arenaMembership.deleteMany).not.toHaveBeenCalled();
      });
    }
  });

  describe('authorized callers', () => {
    beforeEach(() => {
      requireArenaManager.mockResolvedValue({
        user: { id: 'u1' },
        arena: { id: ARENA, ownerId: 'u1' },
        role: ROLES.OWNER,
      });
      requireArenaOwner.mockResolvedValue({
        user: { id: 'u1' },
        arena: { id: ARENA, ownerId: 'u1' },
      });
      requireUser.mockResolvedValue({ user: { id: 'u1' } });
    });

    it('addPlayers() with names proceeds to the transaction', async () => {
      await actions.addPlayers(ARENA, 'Alice');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('addPlayers() with no names is a no-op', async () => {
      const result = await actions.addPlayers(ARENA, '  , ');
      expect(result.error).toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('removePlayer() scopes both deletes to the arena (no cross-arena delete)', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        courtSlot: { findFirst: vi.fn().mockResolvedValue(null) },
        partnership: { deleteMany: vi.fn() },
        player: { deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.removePlayer(ARENA, 'player-from-another-arena');

      expect(tx.player.deleteMany).toHaveBeenCalledWith({
        where: { id: 'player-from-another-arena', arenaId: ARENA },
      });
    });

    it('updateMemberRole() rejects an unknown role', async () => {
      const result = await actions.updateMemberRole(ARENA, 'u2', 'SUPERUSER');
      expect(result.error).toBeTruthy();
      expect(prisma.arenaMembership.updateMany).not.toHaveBeenCalled();
    });

    it('updateMemberRole() refuses to change the owner', async () => {
      const result = await actions.updateMemberRole(ARENA, 'u1', ROLES.MEMBER);
      expect(result.error).toBeTruthy();
      expect(prisma.arenaMembership.updateMany).not.toHaveBeenCalled();
    });

    it('transferOwnership() rejects transferring to the current owner', async () => {
      const result = await actions.transferOwnership(ARENA, 'u1');
      expect(result.error).toBeTruthy();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('leaveArena() refuses to let the owner leave', async () => {
      prisma.arena.findUnique.mockResolvedValue({ id: ARENA, ownerId: 'u1' });
      const result = await actions.leaveArena(ARENA);
      expect(result.error).toBeTruthy();
      expect(prisma.arenaMembership.deleteMany).not.toHaveBeenCalled();
    });
  });
});
