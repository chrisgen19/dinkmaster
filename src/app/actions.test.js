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
  ['addPlayer', () => actions.addPlayer(ARENA, 'Alice', 'Bob')],
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
  ['linkPlayerToMember', () => actions.linkPlayerToMember(ARENA, 'p1', 'u2')],
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

    it('addPlayer() with a blank first name skips the gate and the transaction', async () => {
      const result = await actions.addPlayer(ARENA, '   ', '  ');
      expect(result.error).toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('addPlayer() with a first name proceeds past the gate to the transaction', async () => {
      await actions.addPlayer(ARENA, 'Alice', '');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('removePlayer() scopes both deletes to the arena (no cross-arena delete)', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        player: {
          findFirst: vi.fn().mockResolvedValue({ userId: null }), // a temp player
          deleteMany: vi.fn(),
        },
        courtSlot: { findFirst: vi.fn().mockResolvedValue(null) },
        partnership: { deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.removePlayer(ARENA, 'player-from-another-arena');

      expect(tx.player.deleteMany).toHaveBeenCalledWith({
        where: { id: 'player-from-another-arena', arenaId: ARENA },
      });
    });

    it('removePlayer() refuses to remove a linked (member) player', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        player: {
          findFirst: vi.fn().mockResolvedValue({ userId: 'u9' }), // a linked player
          deleteMany: vi.fn(),
        },
        courtSlot: { findFirst: vi.fn() },
        partnership: { deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.removePlayer(ARENA, 'linked-player');
      expect(result.error).toMatch(/Members tab/i);
      expect(tx.player.deleteMany).not.toHaveBeenCalled();
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

    it('joinArena() makes the user a member and a queued player', async () => {
      prisma.arena.findUnique.mockResolvedValue({ id: ARENA, ownerId: 'u2' });
      const tx = {
        $executeRaw: vi.fn(),
        arenaMembership: { upsert: vi.fn() },
        player: {
          findUnique: vi.fn().mockResolvedValue(null), // no existing linked player
          findMany: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: null } }),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.joinArena(ARENA);
      expect(tx.arenaMembership.upsert).toHaveBeenCalled();
      expect(tx.player.create).toHaveBeenCalled();
    });

    it('removeMember() removes the member and their linked player', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        player: {
          findUnique: vi.fn().mockResolvedValue({ id: 'p-linked' }),
          deleteMany: vi.fn(),
        },
        courtSlot: { findFirst: vi.fn().mockResolvedValue(null) },
        partnership: { deleteMany: vi.fn() },
        arenaMembership: { deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.removeMember(ARENA, 'u2');
      expect(result.error).toBeUndefined();
      expect(tx.player.deleteMany).toHaveBeenCalledWith({
        where: { id: 'p-linked', arenaId: ARENA },
      });
      expect(tx.arenaMembership.deleteMany).toHaveBeenCalled();
    });

    // --- linkPlayerToMember branches & merge semantics ---------------------

    /** Build a fake transaction for linkPlayerToMember with overridable mocks. */
    const linkTx = ({ temp, member, ownPlayer, onCourt }) => ({
      $executeRaw: vi.fn(),
      player: {
        findFirst: vi.fn().mockResolvedValue(temp),
        findUnique: vi.fn().mockResolvedValue(ownPlayer),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      arenaMembership: { findUnique: vi.fn().mockResolvedValue(member) },
      courtSlot: { findFirst: vi.fn().mockResolvedValue(onCourt) },
      matchPlayer: { updateMany: vi.fn() },
      partnership: { deleteMany: vi.fn() },
    });

    it('linkPlayerToMember() merges the member’s existing player into the walk-in', async () => {
      const tx = linkTx({
        temp: { id: 'temp1', userId: null },
        member: { role: ROLES.MEMBER },
        ownPlayer: { id: 'own1', gamesPlayed: 3, wins: 2, losses: 1 },
        onCourt: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.linkPlayerToMember(ARENA, 'temp1', 'u2');
      expect(result.error).toBeUndefined();
      // Counters folded into the survivor; no history dropped.
      expect(tx.player.update).toHaveBeenCalledWith({
        where: { id: 'temp1' },
        data: {
          userId: 'u2',
          gamesPlayed: { increment: 3 },
          wins: { increment: 2 },
          losses: { increment: 1 },
        },
      });
      // Finished-match snapshots re-pointed to the survivor.
      expect(tx.matchPlayer.updateMany).toHaveBeenCalledWith({
        where: { playerId: 'own1' },
        data: { playerId: 'temp1' },
      });
      expect(tx.player.deleteMany).toHaveBeenCalledWith({ where: { id: 'own1', arenaId: ARENA } });
    });

    it('linkPlayerToMember() just links when the member has no player yet', async () => {
      const tx = linkTx({
        temp: { id: 'temp1', userId: null },
        member: { role: ROLES.MEMBER },
        ownPlayer: null,
        onCourt: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.linkPlayerToMember(ARENA, 'temp1', 'u2');
      expect(tx.player.update).toHaveBeenCalledWith({ where: { id: 'temp1' }, data: { userId: 'u2' } });
      expect(tx.matchPlayer.updateMany).not.toHaveBeenCalled();
      expect(tx.player.deleteMany).not.toHaveBeenCalled();
    });

    it('linkPlayerToMember() rejects linking to a non-member', async () => {
      const tx = linkTx({
        temp: { id: 'temp1', userId: null },
        member: null,
        ownPlayer: null,
        onCourt: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.linkPlayerToMember(ARENA, 'temp1', 'u2');
      expect(result.error).toMatch(/join the arena/i);
      expect(tx.player.update).not.toHaveBeenCalled();
    });

    it('linkPlayerToMember() refuses when the member’s player is on a court', async () => {
      const tx = linkTx({
        temp: { id: 'temp1', userId: null },
        member: { role: ROLES.MEMBER },
        ownPlayer: { id: 'own1', gamesPlayed: 0, wins: 0, losses: 0 },
        onCourt: { id: 'slot1' },
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.linkPlayerToMember(ARENA, 'temp1', 'u2');
      expect(result.error).toMatch(/court/i);
      expect(tx.player.update).not.toHaveBeenCalled();
      expect(tx.player.deleteMany).not.toHaveBeenCalled();
    });

    it('linkPlayerToMember() rejects a player that is already linked', async () => {
      const tx = linkTx({
        temp: { id: 'temp1', userId: 'someone-else' },
        member: { role: ROLES.MEMBER },
        ownPlayer: null,
        onCourt: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.linkPlayerToMember(ARENA, 'temp1', 'u2');
      expect(result.error).toMatch(/already linked/i);
      expect(tx.player.update).not.toHaveBeenCalled();
    });
  });
});
