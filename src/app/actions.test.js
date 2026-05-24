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
    arena: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
    arenaMembership: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    court: { findMany: vi.fn() },
    player: { count: vi.fn() },
    joinRequest: { upsert: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
    linkRequest: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { requireUser, requireArenaOwner, requireArenaManager } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { ROLES } from '@/lib/roles';
import { MAX_WAIT_THRESHOLD } from '@/lib/matchmaking';
import { MAX_TARGET_SCORE, MAX_LEADERBOARD_SIZE } from '@/lib/match-defaults';
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
  ['updateArenaGeneral', () => actions.updateArenaGeneral(ARENA, { name: 'New' })],
  ['updateArenaSchedule', () => actions.updateArenaSchedule(ARENA, { days: [1, 3, 5] })],
  ['updateArenaMatchmaking', () => actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4 })],
  ['updateArenaMatchDefaults', () => actions.updateArenaMatchDefaults(ARENA, { targetScore: 11, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true })],
  ['updateArenaSessions', () => actions.updateArenaSessions(ARENA, { autoResetOnSession: true })],
  ['prepareNextSession', () => actions.prepareNextSession(ARENA)],
  ['checkInPlayer', () => actions.checkInPlayer(ARENA, 'p1')],
  ['checkOutPlayer', () => actions.checkOutPlayer(ARENA, 'p1')],
  ['approveJoinRequest', () => actions.approveJoinRequest(ARENA, 'u2')],
  ['rejectJoinRequest', () => actions.rejectJoinRequest(ARENA, 'u2')],
  ['linkPlayerToMember', () => actions.linkPlayerToMember(ARENA, 'p1', 'u2')],
  ['approveLinkRequest', () => actions.approveLinkRequest(ARENA, 'r1')],
  ['rejectLinkRequest', () => actions.rejectLinkRequest(ARENA, 'r1')],
];
// Owner-only gated (requireArenaOwner).
const OWNER_ONLY = [
  ['updateMemberRole', () => actions.updateMemberRole(ARENA, 'u2', ROLES.ORGANIZER)],
  ['removeMember', () => actions.removeMember(ARENA, 'u2')],
  ['transferOwnership', () => actions.transferOwnership(ARENA, 'u2')],
  ['deleteArena', () => actions.deleteArena(ARENA)],
];
// Any signed-in user (requireUser).
const USER_GATED = [
  ['createArena', () => actions.createArena('My Arena')],
  ['requestToJoin', () => actions.requestToJoin(ARENA)],
  ['leaveArena', () => actions.leaveArena(ARENA)],
  ['requestLinkPlayer', () => actions.requestLinkPlayer(ARENA, 'p1')],
  ['cancelLinkRequest', () => actions.cancelLinkRequest(ARENA)],
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
        expect(prisma.arena.updateMany).not.toHaveBeenCalled();
        expect(prisma.arena.deleteMany).not.toHaveBeenCalled();
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

    describe('updateArenaSchedule()', () => {
      beforeEach(() => {
        // The write is a count-checked updateMany; default to "the row exists".
        prisma.arena.updateMany.mockResolvedValue({ count: 1 });
      });

      it('normalizes days (dedupes + sorts) and persists a valid schedule', async () => {
        const result = await actions.updateArenaSchedule(ARENA, {
          days: [5, 1, 3, 1],
          start: '18:00',
          end: '22:00',
          timezone: 'Asia/Manila',
        });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { scheduleDays: [1, 3, 5], scheduleStart: '18:00', scheduleEnd: '22:00', timezone: 'Asia/Manila' },
        });
        expect(result.schedule.days).toEqual([1, 3, 5]);
      });

      it('defaults an empty timezone to Asia/Manila and allows empty times', async () => {
        const result = await actions.updateArenaSchedule(ARENA, { days: [], start: '', end: '' });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { scheduleDays: [], scheduleStart: null, scheduleEnd: null, timezone: 'Asia/Manila' },
        });
      });

      it('reports a clean error when the arena no longer exists (concurrent delete)', async () => {
        prisma.arena.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateArenaSchedule(ARENA, { days: [1] });
        expect(result.error).toMatch(/no longer exists/i);
      });

      it.each([
        ['an out-of-range day', { days: [7] }],
        ['a partial-numeric day string', { days: ['1x'] }],
        ['a blank day string', { days: [''] }],
        ['a whitespace-only day string', { days: ['   '] }],
        ['a hex-shaped day string', { days: ['0x1'] }],
        ['a malformed start time', { days: [1], start: '6pm' }],
        ['an end before the start', { days: [1], start: '22:00', end: '18:00' }],
        ['an unrecognized timezone', { days: [1], timezone: 'Mars/Olympus' }],
      ])('rejects %s and writes nothing', async (_label, input) => {
        const result = await actions.updateArenaSchedule(ARENA, input);
        expect(result.error).toBeTruthy();
        expect(prisma.arena.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('updateArenaGeneral()', () => {
      beforeEach(() => {
        prisma.arena.updateMany.mockResolvedValue({ count: 1 });
      });

      it('persists a trimmed name and null-coerces a blank description', async () => {
        const result = await actions.updateArenaGeneral(ARENA, { name: '  Court Kings  ', description: '   ' });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { name: 'Court Kings', description: null },
        });
      });

      it('reports a clean error when the arena no longer exists (concurrent delete)', async () => {
        prisma.arena.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateArenaGeneral(ARENA, { name: 'Court Kings' });
        expect(result.error).toMatch(/no longer exists/i);
      });

      it.each([
        ['a blank name', { name: '   ' }],
        ['an over-long name', { name: 'x'.repeat(81) }],
        ['an over-long description', { name: 'ok', description: 'y'.repeat(281) }],
      ])('rejects %s and writes nothing', async (_label, input) => {
        const result = await actions.updateArenaGeneral(ARENA, input);
        expect(result.error).toBeTruthy();
        expect(prisma.arena.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('updateArenaMatchmaking()', () => {
      beforeEach(() => {
        prisma.arena.updateMany.mockResolvedValue({ count: 1 });
      });

      it('persists valid thresholds and coerces numeric strings', async () => {
        const result = await actions.updateArenaMatchmaking(ARENA, { starveThreshold: '3', emergencyWait: '6' });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { starveThreshold: 3, emergencyWait: 6 },
        });
        expect(result.matchmaking).toEqual({ starveThreshold: 3, emergencyWait: 6 });
      });

      it('reports a clean error when the arena no longer exists', async () => {
        prisma.arena.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4 });
        expect(result.error).toMatch(/no longer exists/i);
      });

      it.each([
        ['a zero starve threshold', { starveThreshold: 0, emergencyWait: 4 }],
        ['a fractional starve threshold', { starveThreshold: 2.5, emergencyWait: 4 }],
        ['a non-numeric starve threshold', { starveThreshold: 'lots', emergencyWait: 4 }],
        ['an emergency wait below the starve threshold', { starveThreshold: 4, emergencyWait: 2 }],
        ['an out-of-range starve threshold', { starveThreshold: MAX_WAIT_THRESHOLD + 1, emergencyWait: 4 }],
        ['an out-of-range emergency wait', { starveThreshold: 2, emergencyWait: MAX_WAIT_THRESHOLD + 1 }],
      ])('rejects %s and writes nothing', async (_label, input) => {
        const result = await actions.updateArenaMatchmaking(ARENA, input);
        expect(result.error).toBeTruthy();
        expect(prisma.arena.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('updateArenaMatchDefaults()', () => {
      beforeEach(() => {
        prisma.arena.updateMany.mockResolvedValue({ count: 1 });
      });

      it('persists valid defaults and coerces "true"/"false" string booleans', async () => {
        const result = await actions.updateArenaMatchDefaults(ARENA, {
          targetScore: '15',
          autoMixDefault: 'false',
          leaderboardSize: '10',
          countOffScheduleGames: 'true',
        });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { targetScore: 15, autoMixDefault: false, leaderboardSize: 10, countOffScheduleGames: true },
        });
      });

      it('reports a clean error when the arena no longer exists', async () => {
        prisma.arena.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateArenaMatchDefaults(ARENA, {
          targetScore: 11, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true,
        });
        expect(result.error).toMatch(/no longer exists/i);
      });

      it.each([
        ['a zero target score', { targetScore: 0, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true }],
        ['a fractional target score', { targetScore: 11.5, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true }],
        ['an out-of-range target score', { targetScore: MAX_TARGET_SCORE + 1, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true }],
        ['an out-of-range leaderboard size', { targetScore: 11, autoMixDefault: true, leaderboardSize: MAX_LEADERBOARD_SIZE + 1, countOffScheduleGames: true }],
        ['a non-boolean autoMixDefault', { targetScore: 11, autoMixDefault: 'maybe', leaderboardSize: 5, countOffScheduleGames: true }],
        ['a non-boolean countOffScheduleGames', { targetScore: 11, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: 1 }],
      ])('rejects %s and writes nothing', async (_label, input) => {
        const result = await actions.updateArenaMatchDefaults(ARENA, input);
        expect(result.error).toBeTruthy();
        expect(prisma.arena.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('updateArenaSessions()', () => {
      beforeEach(() => {
        prisma.arena.updateMany.mockResolvedValue({ count: 1 });
      });

      it('persists a valid boolean and returns the new setting', async () => {
        const result = await actions.updateArenaSessions(ARENA, { autoResetOnSession: true });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { autoResetOnSession: true },
        });
        expect(result.sessions.autoResetOnSession).toBe(true);
      });

      it('reports a clean error when the arena no longer exists', async () => {
        prisma.arena.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateArenaSessions(ARENA, { autoResetOnSession: false });
        expect(result.error).toMatch(/no longer exists/i);
      });

      it.each([
        ['undefined', undefined],
        ['null', null],
        ['a string', 'true'],
        ['a number', 1],
      ])('rejects %s for autoResetOnSession and writes nothing', async (_label, value) => {
        const result = await actions.updateArenaSessions(ARENA, { autoResetOnSession: value });
        expect(result.error).toBeTruthy();
        expect(prisma.arena.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('prepareNextSession()', () => {
      it('enters the transaction once when the caller is authorized', async () => {
        await actions.prepareNextSession(ARENA);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('wipes partnerships, empties the rack, and stamps lastSessionResetAt', async () => {
        const tx = {
          $executeRaw: vi.fn(),
          partnership: { deleteMany: vi.fn() },
          player: { updateMany: vi.fn() },
          arena: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        };
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.prepareNextSession(ARENA);
        expect(result.error).toBeUndefined();

        // Partnership matrix wiped for this arena only.
        expect(tx.partnership.deleteMany).toHaveBeenCalledWith({ where: { arenaId: ARENA } });
        // Every active player pulled off the rack with waitRounds reset.
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { arenaId: ARENA, leftAt: null },
          data: { queueOrder: null, waitRounds: 0 },
        });
        // Reset stamped via updateMany (count-guarded) so a concurrent delete
        // is a clean error, not an uncaught P2025.
        expect(tx.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { lastSessionResetAt: expect.any(Date) },
        });
      });

      it('reports a clean error when the arena was deleted mid-transaction', async () => {
        const tx = {
          $executeRaw: vi.fn(),
          partnership: { deleteMany: vi.fn() },
          player: { updateMany: vi.fn() },
          arena: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        };
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.prepareNextSession(ARENA);
        expect(result.error).toMatch(/no longer exists/i);
      });

      it('does not touch lifetime stats, ratings, or match history', async () => {
        const tx = {
          $executeRaw: vi.fn(),
          partnership: { deleteMany: vi.fn() },
          player: { updateMany: vi.fn() },
          arena: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
          // Presence asserts the action never reaches for these.
          match: { deleteMany: vi.fn() },
          courtSlot: { deleteMany: vi.fn() },
        };
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.prepareNextSession(ARENA);

        expect(tx.match.deleteMany).not.toHaveBeenCalled();
        expect(tx.courtSlot.deleteMany).not.toHaveBeenCalled();
        // The player update sets only queue/wait fields — never wins/losses/rating/gamesPlayed.
        const data = tx.player.updateMany.mock.calls[0][0].data;
        expect(data).toEqual({ queueOrder: null, waitRounds: 0 });
      });
    });

    describe('checkInPlayer()', () => {
      // gamesPlayed 4 with a single active peer averaging 10 → gamesOffset
      // re-anchors to 10 - 4 = 6 so the returner sorts as a peer, not catch-up.
      const baseTx = () => ({
        $executeRaw: vi.fn(),
        player: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([{ gamesPlayed: 10, gamesOffset: 0 }]),
          aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: 3 } }),
          update: vi.fn(),
        },
        courtSlot: { findFirst: vi.fn().mockResolvedValue(null) },
      });

      it('appends to the queue tail and re-anchors gamesOffset to the group average', async () => {
        const tx = baseTx();
        tx.player.findFirst.mockResolvedValue({ id: 'p1', queueOrder: null, gamesPlayed: 4 });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.checkInPlayer(ARENA, 'p1');

        expect(tx.player.update).toHaveBeenCalledWith({
          where: { id: 'p1' },
          data: { queueOrder: 4, waitRounds: 0, gamesOffset: 6 },
        });
      });

      it('is a no-op when the player is already on the rack', async () => {
        const tx = baseTx();
        tx.player.findFirst.mockResolvedValue({ id: 'p1', queueOrder: 2, gamesPlayed: 4 });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.checkInPlayer(ARENA, 'p1');

        expect(tx.player.update).not.toHaveBeenCalled();
      });

      it('is a no-op when the player is on a court mid-match', async () => {
        const tx = baseTx();
        tx.player.findFirst.mockResolvedValue({ id: 'p1', queueOrder: null, gamesPlayed: 4 });
        tx.courtSlot.findFirst.mockResolvedValue({ id: 'slot1' });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.checkInPlayer(ARENA, 'p1');

        expect(tx.player.update).not.toHaveBeenCalled();
      });

      it('is a no-op when the player does not exist (or left the arena)', async () => {
        const tx = baseTx();
        tx.player.findFirst.mockResolvedValue(null);
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.checkInPlayer(ARENA, 'ghost');

        expect(tx.player.update).not.toHaveBeenCalled();
      });
    });

    describe('checkOutPlayer()', () => {
      it('clears the queue only for an active, currently-queued player', async () => {
        const tx = { $executeRaw: vi.fn(), player: { updateMany: vi.fn() } };
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.checkOutPlayer(ARENA, 'p1');

        // The `queueOrder: { not: null }` filter means a player already off
        // the rack (or on a court) matches zero rows — a safe no-op.
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: 'p1', arenaId: ARENA, leftAt: null, queueOrder: { not: null } },
          data: { queueOrder: null, waitRounds: 0 },
        });
      });
    });

    describe('deleteArena()', () => {
      it('deletes scoped to the caller, and reports a race when no row matches', async () => {
        prisma.arena.deleteMany.mockResolvedValueOnce({ count: 1 });
        const ok = await actions.deleteArena(ARENA);
        expect(ok.ok).toBe(true);
        expect(prisma.arena.deleteMany).toHaveBeenCalledWith({ where: { id: ARENA, ownerId: 'u1' } });

        prisma.arena.deleteMany.mockResolvedValueOnce({ count: 0 });
        const race = await actions.deleteArena(ARENA);
        expect(race.error).toMatch(/Ownership changed/i);
      });
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

    it('requestToJoin() records a pending request without joining', async () => {
      prisma.arena.findUnique.mockResolvedValue({ id: ARENA, ownerId: 'u2' });
      prisma.arenaMembership.findUnique.mockResolvedValue(null); // not yet a member

      const result = await actions.requestToJoin(ARENA);
      expect(result.ok).toBe(true);
      expect(prisma.joinRequest.upsert).toHaveBeenCalledWith({
        where: { arenaId_userId: { arenaId: ARENA, userId: 'u1' } },
        create: { arenaId: ARENA, userId: 'u1' },
        update: {},
      });
      // No membership/player is created on request.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('requestToJoin() is a no-op for an existing member', async () => {
      prisma.arena.findUnique.mockResolvedValue({ id: ARENA, ownerId: 'u2' });
      prisma.arenaMembership.findUnique.mockResolvedValue({ role: ROLES.MEMBER });

      const result = await actions.requestToJoin(ARENA);
      expect(result.ok).toBe(true);
      expect(prisma.joinRequest.upsert).not.toHaveBeenCalled();
    });

    it('approveJoinRequest() creates membership, activates a player, consumes the request', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        joinRequest: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req1', arenaId: ARENA, userId: 'u2' }),
          deleteMany: vi.fn(),
        },
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 'u2', firstName: 'Bo', lastName: 'B' }),
        },
        arenaMembership: { upsert: vi.fn() },
        player: {
          findUnique: vi.fn().mockResolvedValue(null), // no prior player → create fresh
          findMany: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: null } }),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.approveJoinRequest(ARENA, 'u2');
      expect(result.error).toBeUndefined();
      expect(tx.arenaMembership.upsert).toHaveBeenCalled();
      expect(tx.player.create).toHaveBeenCalled();
      expect(tx.joinRequest.deleteMany).toHaveBeenCalledWith({ where: { arenaId: ARENA, userId: 'u2' } });
    });

    it('approveJoinRequest() reactivates a returning member’s player (keeps stats)', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        joinRequest: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req1', arenaId: ARENA, userId: 'u2' }),
          deleteMany: vi.fn(),
        },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'u2', firstName: 'Bo', lastName: 'B' }) },
        arenaMembership: { upsert: vi.fn() },
        player: {
          // a departed player row exists → reactivate, don't create
          findUnique: vi.fn().mockResolvedValue({ id: 'p-old', gamesPlayed: 5, leftAt: new Date(), queueOrder: null }),
          findMany: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: 3 } }),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.approveJoinRequest(ARENA, 'u2');
      expect(tx.player.create).not.toHaveBeenCalled();
      expect(tx.player.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-old' }, data: expect.objectContaining({ leftAt: null }) }),
      );
    });

    it('approveJoinRequest() errors when no request exists', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        joinRequest: { findUnique: vi.fn().mockResolvedValue(null), deleteMany: vi.fn() },
        user: { findUnique: vi.fn() },
        arenaMembership: { upsert: vi.fn() },
        player: { create: vi.fn(), update: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.approveJoinRequest(ARENA, 'u2');
      expect(result.error).toMatch(/no longer exists/i);
      expect(tx.arenaMembership.upsert).not.toHaveBeenCalled();
    });

    it('resetArena() only re-queues active players (skips departed rows)', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        match: { deleteMany: vi.fn() },
        courtSlot: { deleteMany: vi.fn() },
        partnership: { deleteMany: vi.fn() },
        court: { updateMany: vi.fn() },
        player: {
          findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.resetArena(ARENA);
      // The reset must scope its player scan to active rows so a departed
      // player can't be silently re-queued (invisible to getState).
      expect(tx.player.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { arenaId: ARENA, leftAt: null } }),
      );
      // ...but stats (games/wins/losses/rating) are cleared for EVERY player,
      // departed rows included, so a rejoin can't resurrect pre-reset stats or
      // a stale Elo from matches the reset already deleted.
      expect(tx.player.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { arenaId: ARENA },
          data: expect.objectContaining({ gamesPlayed: 0, wins: 0, rating: 1000 }),
        }),
      );
    });

    it('endMatch() applies Elo rating updates — winners rise, losers fall', async () => {
      const slot = (playerId, team) => ({
        playerId,
        team,
        player: { id: playerId, firstName: playerId, lastName: null, rating: 1000 },
      });
      const tx = {
        $executeRaw: vi.fn(),
        court: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }), // claim the finish
          findUnique: vi.fn().mockResolvedValue({ id: 'c1', name: 'Court 1' }),
        },
        courtSlot: {
          findMany: vi
            .fn()
            .mockResolvedValue([slot('w1', 1), slot('w2', 1), slot('l1', 2), slot('l2', 2)]),
          deleteMany: vi.fn(),
        },
        player: {
          aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: 0 } }),
          updateMany: vi.fn(),
          update: vi.fn(),
        },
        match: { create: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));
      prisma.court.findMany.mockResolvedValue([]); // no other courts -> no auto-mix
      prisma.player.count.mockResolvedValue(0);

      await actions.endMatch(ARENA, 'c1', 11, 5, false);

      // tx.player.update is called both for ratings and for re-queueing; pick
      // the rating write for each player. Team 1 won 11-5 from an even start.
      const ratingFor = (id) =>
        tx.player.update.mock.calls.find((c) => c[0].where.id === id && 'rating' in c[0].data)[0]
          .data.rating;
      expect(ratingFor('w1')).toBeGreaterThan(1000);
      expect(ratingFor('w2')).toBeGreaterThan(1000);
      expect(ratingFor('l1')).toBeLessThan(1000);
      expect(ratingFor('l2')).toBeLessThan(1000);
    });

    it('endMatch() degrades gracefully when the arena vanishes during auto-mix', async () => {
      const slot = (playerId, team) => ({
        playerId,
        team,
        player: { id: playerId, firstName: playerId, lastName: null, rating: 1000 },
      });

      // Match-finish tx (first $transaction call) — full happy path.
      const finishTx = {
        $executeRaw: vi.fn(),
        court: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 'c1', name: 'Court 1' }),
        },
        courtSlot: {
          findMany: vi.fn().mockResolvedValue([slot('w1', 1), slot('w2', 1), slot('l1', 2), slot('l2', 2)]),
          deleteMany: vi.fn(),
        },
        player: {
          aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: 0 } }),
          updateMany: vi.fn(),
          update: vi.fn(),
        },
        match: { create: vi.fn() },
      };

      // Auto-mix tx (second $transaction call) — the arena row is gone.
      const mixTx = {
        $executeRaw: vi.fn(),
        arena: { findUnique: vi.fn().mockResolvedValue(null) },
        player: { findMany: vi.fn(), update: vi.fn() },
      };

      let txCall = 0;
      prisma.$transaction.mockImplementation(async (cb) => {
        txCall += 1;
        return cb(txCall === 1 ? finishTx : mixTx);
      });
      // Force the auto-mix branch (autoMix=true and queuedCount > 4).
      prisma.court.findMany.mockResolvedValue([]);
      prisma.player.count.mockResolvedValue(5);

      const result = await actions.endMatch(ARENA, 'c1', 11, 5, true);

      // Match commit succeeded; mix bailed cleanly with no notification.
      expect(result.error).toBeUndefined();
      expect(result.state).toBeDefined();
      expect(result.notification).toBe('');
      expect(mixTx.arena.findUnique).toHaveBeenCalled();
      expect(mixTx.player.update).not.toHaveBeenCalled();
    });

    it('rejectJoinRequest() deletes the request', async () => {
      const result = await actions.rejectJoinRequest(ARENA, 'u2');
      expect(result.ok).toBe(true);
      expect(prisma.joinRequest.deleteMany).toHaveBeenCalledWith({ where: { arenaId: ARENA, userId: 'u2' } });
    });

    it('approveJoinRequest() does not re-queue a member already active on court', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        joinRequest: {
          findUnique: vi.fn().mockResolvedValue({ id: 'req1', arenaId: ARENA, userId: 'u2' }),
          deleteMany: vi.fn(),
        },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'u2', firstName: 'Bo', lastName: 'B' }) },
        arenaMembership: { upsert: vi.fn() },
        player: {
          // active player, but off the rack (on a court): leftAt null, queueOrder null
          findUnique: vi.fn().mockResolvedValue({ id: 'p-court', gamesPlayed: 1, leftAt: null, queueOrder: null }),
          findMany: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: 2 } }),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.approveJoinRequest(ARENA, 'u2');
      // Must not re-queue them — that would put the same person in the rack and on a court.
      expect(tx.player.update).not.toHaveBeenCalled();
      expect(tx.player.create).not.toHaveBeenCalled();
    });

    it('removeMember() deactivates the member’s player (keeps the row for history)', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        player: {
          findUnique: vi.fn().mockResolvedValue({ id: 'p-linked' }),
          update: vi.fn(),
          deleteMany: vi.fn(),
        },
        courtSlot: { findFirst: vi.fn().mockResolvedValue(null) },
        arenaMembership: { deleteMany: vi.fn() },
        joinRequest: { deleteMany: vi.fn() },
        linkRequest: { deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.removeMember(ARENA, 'u2');
      expect(result.error).toBeUndefined();
      // Deactivated, not deleted: leftAt is set and the row is kept.
      expect(tx.player.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-linked' }, data: expect.objectContaining({ leftAt: expect.any(Date), queueOrder: null }) }),
      );
      expect(tx.player.deleteMany).not.toHaveBeenCalled();
      expect(tx.arenaMembership.deleteMany).toHaveBeenCalled();
      // Loop-closing cleanup: a leaver should not be left with a lingering
      // LinkRequest (mirrors the existing JoinRequest cleanup).
      expect(tx.linkRequest.deleteMany).toHaveBeenCalledWith({
        where: { arenaId: ARENA, userId: 'u2' },
      });
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
      linkRequest: { deleteMany: vi.fn() },
    });

    it('linkPlayerToMember() merges the member’s existing player into the walk-in', async () => {
      const tx = linkTx({
        temp: { id: 'temp1', userId: null, gamesPlayed: 1, rating: 1100 },
        member: { role: ROLES.MEMBER },
        ownPlayer: { id: 'own1', gamesPlayed: 3, wins: 2, losses: 1, rating: 1300 },
        onCourt: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.linkPlayerToMember(ARENA, 'temp1', 'u2');
      expect(result.error).toBeUndefined();
      // Counters folded into the survivor; no history dropped. Elo is blended
      // by games played: (1100×1 + 1300×3) / 4 = 1250.
      expect(tx.player.update).toHaveBeenCalledWith({
        where: { id: 'temp1' },
        data: {
          userId: 'u2',
          gamesPlayed: { increment: 3 },
          wins: { increment: 2 },
          losses: { increment: 1 },
          rating: 1250,
        },
      });
      // Finished-match snapshots re-pointed to the survivor.
      expect(tx.matchPlayer.updateMany).toHaveBeenCalledWith({
        where: { playerId: 'own1' },
        data: { playerId: 'temp1' },
      });
      expect(tx.player.deleteMany).toHaveBeenCalledWith({ where: { id: 'own1', arenaId: ARENA } });
      // Order matters: the walk-in `update` claims (arenaId, userId), so the
      // existing `ownPlayer` must be deleted FIRST or the @@unique constraint
      // fires with P2002. Lock the ordering here so a future reorder is loud.
      const deleteOrder = tx.player.deleteMany.mock.invocationCallOrder[0];
      const updateOrder = tx.player.update.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(updateOrder);
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
      // Consume stale LinkRequest rows for the same user OR the same player.
      expect(tx.linkRequest.deleteMany).toHaveBeenCalledWith({
        where: { arenaId: ARENA, OR: [{ userId: 'u2' }, { playerId: 'temp1' }] },
      });
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

    // --- requestLinkPlayer (member self-claim) ----------------------------

    /**
     * Build a fake transaction for `requestLinkPlayer` with overridable mocks.
     * The action does all its validation inside `prisma.$transaction`, so each
     * scenario seeds the reads it needs and watches `linkRequest.upsert`.
     */
    const requestTx = ({ arena, membership, ownPlayer, target, existingForPlayer, upsertImpl }) => ({
      $executeRaw: vi.fn(),
      arena: { findUnique: vi.fn().mockResolvedValue(arena) },
      arenaMembership: { findUnique: vi.fn().mockResolvedValue(membership) },
      player: {
        findUnique: vi.fn().mockResolvedValue(ownPlayer),
        findFirst: vi.fn().mockResolvedValue(target),
      },
      linkRequest: {
        findUnique: vi.fn().mockResolvedValue(existingForPlayer),
        upsert: upsertImpl ?? vi.fn(),
      },
    });

    it('requestLinkPlayer() upserts a pending request when eligible', async () => {
      const tx = requestTx({
        arena: { id: ARENA, ownerId: 'someone-else' },
        membership: { role: ROLES.MEMBER },
        ownPlayer: null,
        target: { id: 'p1', userId: null, leftAt: null },
        existingForPlayer: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.requestLinkPlayer(ARENA, 'p1');
      expect(result.ok).toBe(true);
      expect(tx.linkRequest.upsert).toHaveBeenCalledWith({
        where: { arenaId_userId: { arenaId: ARENA, userId: 'u1' } },
        create: { arenaId: ARENA, userId: 'u1', playerId: 'p1' },
        update: { playerId: 'p1' },
      });
    });

    // The "Yosh" flow: a member who joined via approveJoinRequest already
    // has a fresh auto-created Player (`activateArenaPlayer`). Locking this
    // case as a test pins down the guard removal from f18ab38 — re-adding
    // the "you already have a linked player" block would silently kill the
    // canonical "claim my historical walk-in" feature.
    it('requestLinkPlayer() still succeeds when the requester already has a linked Player (claim-historical-walk-in flow)', async () => {
      const tx = requestTx({
        arena: { id: ARENA, ownerId: 'someone-else' },
        membership: { role: ROLES.MEMBER },
        ownPlayer: { id: 'own1', leftAt: null },
        target: { id: 'p1', userId: null, leftAt: null },
        existingForPlayer: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.requestLinkPlayer(ARENA, 'p1');
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      expect(tx.linkRequest.upsert).toHaveBeenCalledWith({
        where: { arenaId_userId: { arenaId: ARENA, userId: 'u1' } },
        create: { arenaId: ARENA, userId: 'u1', playerId: 'p1' },
        update: { playerId: 'p1' },
      });
    });

    it('requestLinkPlayer() blocks when the target is already linked', async () => {
      const tx = requestTx({
        arena: { id: ARENA, ownerId: 'someone-else' },
        membership: { role: ROLES.MEMBER },
        ownPlayer: null,
        target: { id: 'p1', userId: 'u9', leftAt: null },
        existingForPlayer: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.requestLinkPlayer(ARENA, 'p1');
      expect(result.error).toMatch(/already linked/i);
      expect(tx.linkRequest.upsert).not.toHaveBeenCalled();
    });

    it('requestLinkPlayer() blocks when another member already requested the same orphan', async () => {
      const tx = requestTx({
        arena: { id: ARENA, ownerId: 'someone-else' },
        membership: { role: ROLES.MEMBER },
        ownPlayer: null,
        target: { id: 'p1', userId: null, leftAt: null },
        existingForPlayer: { userId: 'someone-else' },
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.requestLinkPlayer(ARENA, 'p1');
      expect(result.error).toMatch(/another member already requested/i);
      expect(tx.linkRequest.upsert).not.toHaveBeenCalled();
    });

    it('requestLinkPlayer() maps a P2002 race to the same user-facing error', async () => {
      const upsertImpl = vi.fn(async () => {
        const err = new Error('unique violation');
        err.code = 'P2002';
        throw err;
      });
      const tx = requestTx({
        arena: { id: ARENA, ownerId: 'someone-else' },
        membership: { role: ROLES.MEMBER },
        ownPlayer: null,
        target: { id: 'p1', userId: null, leftAt: null },
        existingForPlayer: null,
        upsertImpl,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.requestLinkPlayer(ARENA, 'p1');
      expect(result.error).toMatch(/another member already requested/i);
    });

    it('requestLinkPlayer() maps a P2003 (FK gone) to "no longer exists"', async () => {
      const upsertImpl = vi.fn(async () => {
        const err = new Error('fk violation');
        err.code = 'P2003';
        throw err;
      });
      const tx = requestTx({
        arena: { id: ARENA, ownerId: 'someone-else' },
        membership: { role: ROLES.MEMBER },
        ownPlayer: null,
        target: { id: 'p1', userId: null, leftAt: null },
        existingForPlayer: null,
        upsertImpl,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.requestLinkPlayer(ARENA, 'p1');
      expect(result.error).toMatch(/no longer exists/i);
    });

    // --- approveLinkRequest / rejectLinkRequest / cancelLinkRequest -------

    /** Fake tx for approveLinkRequest that hands the request through `applyLinkPlayerToMember`. */
    const approveTx = ({ request, temp, member, ownPlayer, onCourt }) => ({
      $executeRaw: vi.fn(),
      linkRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        deleteMany: vi.fn(),
      },
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

    it('approveLinkRequest() merges and deletes the request row', async () => {
      const tx = approveTx({
        request: { id: 'r1', userId: 'u2', playerId: 'temp1' },
        temp: { id: 'temp1', userId: null, gamesPlayed: 0, rating: 1000 },
        member: { role: ROLES.MEMBER },
        ownPlayer: null,
        onCourt: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.approveLinkRequest(ARENA, 'r1');
      expect(result.ok).toBe(true);
      // Approval consumes the request after a successful link.
      expect(tx.linkRequest.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1' } });
    });

    it('approveLinkRequest() returns NO_REQUEST when the row is missing', async () => {
      const tx = approveTx({
        request: null,
        temp: null,
        member: null,
        ownPlayer: null,
        onCourt: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.approveLinkRequest(ARENA, 'r1');
      expect(result.error).toMatch(/no longer exists/i);
      expect(tx.linkRequest.deleteMany).not.toHaveBeenCalled();
    });

    it('approveLinkRequest() keeps the row when the member is on court (retriable)', async () => {
      const tx = approveTx({
        request: { id: 'r1', userId: 'u2', playerId: 'temp1' },
        temp: { id: 'temp1', userId: null, gamesPlayed: 1, rating: 1100 },
        member: { role: ROLES.MEMBER },
        ownPlayer: { id: 'own1', gamesPlayed: 3, wins: 2, losses: 1, rating: 1300 },
        onCourt: { id: 'cs1' },
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.approveLinkRequest(ARENA, 'r1');
      expect(result.error).toMatch(/on a court/i);
      expect(tx.linkRequest.deleteMany).not.toHaveBeenCalled();
    });

    it('approveLinkRequest() deletes the row on terminal ALREADY_LINKED failure', async () => {
      const tx = approveTx({
        request: { id: 'r1', userId: 'u2', playerId: 'temp1' },
        // Walk-in is no longer an orphan — applyLink returns ALREADY_LINKED.
        temp: { id: 'temp1', userId: 'someone', gamesPlayed: 0, rating: 1000 },
        member: { role: ROLES.MEMBER },
        ownPlayer: null,
        onCourt: null,
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.approveLinkRequest(ARENA, 'r1');
      expect(result.error).toMatch(/already linked/i);
      // Terminal failure consumes the row so it doesn't sit in the queue forever.
      expect(tx.linkRequest.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1' } });
    });

    it('rejectLinkRequest() deletes the request', async () => {
      const result = await actions.rejectLinkRequest(ARENA, 'r1');
      expect(result.ok).toBe(true);
      expect(prisma.linkRequest.deleteMany).toHaveBeenCalledWith({
        where: { id: 'r1', arenaId: ARENA },
      });
    });

    it('cancelLinkRequest() deletes the caller’s own pending request', async () => {
      const result = await actions.cancelLinkRequest(ARENA);
      expect(result.ok).toBe(true);
      expect(prisma.linkRequest.deleteMany).toHaveBeenCalledWith({
        where: { arenaId: ARENA, userId: 'u1' },
      });
    });
  });
});
