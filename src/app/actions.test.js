import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the auth guards, the state reader, and Prisma so the actions run with
// no database. These tests cover authorization and pure-logic guards.
vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(),
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
    player: { count: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    joinRequest: { upsert: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
    linkRequest: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    arenaInvite: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { getCurrentUser, requireUser, requireArenaOwner, requireArenaManager } from '@/lib/session';
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
  ['cancelFill', () => actions.cancelFill(ARENA, 'c1')],
  ['editCourtLineup', () => actions.editCourtLineup(ARENA, 'c1', ['p1', 'p2'], ['p3', 'p4'])],
  ['endMatch', () => actions.endMatch(ARENA, 'c1', 11, 5, true)],
  ['addCourt', () => actions.addCourt(ARENA)],
  ['removeCourt', () => actions.removeCourt(ARENA, 'c1')],
  ['resetArena', () => actions.resetArena(ARENA)],
  ['updateArenaGeneral', () => actions.updateArenaGeneral(ARENA, { name: 'New' })],
  ['updateArenaSchedule', () => actions.updateArenaSchedule(ARENA, { days: [1, 3, 5] })],
  ['updateArenaMatchmaking', () => actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true })],
  ['updateArenaMatchDefaults', () => actions.updateArenaMatchDefaults(ARENA, { targetScore: 11, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true })],
  ['updateArenaSessions', () => actions.updateArenaSessions(ARENA, { autoResetOnSession: true })],
  ['prepareNextSession', () => actions.prepareNextSession(ARENA)],
  ['createArenaInvite', () => actions.createArenaInvite(ARENA, 'APPROVAL')],
  ['revokeArenaInvite', () => actions.revokeArenaInvite(ARENA, 'inv1')],
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
  ['redeemArenaInvite', () => actions.redeemArenaInvite('code123')],
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
        const result = await actions.updateArenaMatchmaking(ARENA, { starveThreshold: '3', emergencyWait: '6', skipRestoresPriority: true, skipPickReplacement: true });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { starveThreshold: 3, emergencyWait: 6, skipRestoresPriority: true, skipPickReplacement: true },
        });
        expect(result.matchmaking).toEqual({ starveThreshold: 3, emergencyWait: 6, skipRestoresPriority: true, skipPickReplacement: true });
      });

      it('coerces "true"/"false" string values for skipRestoresPriority', async () => {
        await actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: 'false', skipPickReplacement: 'true' });
        expect(prisma.arena.updateMany).toHaveBeenLastCalledWith({
          where: { id: ARENA },
          data: { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: false, skipPickReplacement: true },
        });
      });

      it('coerces "true"/"false" string values for skipPickReplacement', async () => {
        await actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: 'false' });
        expect(prisma.arena.updateMany).toHaveBeenLastCalledWith({
          where: { id: ARENA },
          data: { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: false },
        });
      });

      it('wipes lingering skipBoosted flags when toggling off', async () => {
        // After persisting `skipRestoresPriority: false`, the action must also
        // clear `Player.skipBoosted` for the arena so the next auto-mix can't
        // elevate paddles that were boosted while the setting was on.
        await actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: false, skipPickReplacement: true });
        expect(prisma.player.updateMany).toHaveBeenCalledWith({
          where: { arenaId: ARENA, skipBoosted: true },
          data: { skipBoosted: false },
        });
      });

      it('does NOT wipe skipBoosted when the setting is being turned on', async () => {
        await actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true });
        expect(prisma.player.updateMany).not.toHaveBeenCalled();
      });

      it('reports a clean error when the arena no longer exists', async () => {
        prisma.arena.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true });
        expect(result.error).toMatch(/no longer exists/i);
      });

      it.each([
        ['a zero starve threshold', { starveThreshold: 0, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true }],
        ['a fractional starve threshold', { starveThreshold: 2.5, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true }],
        ['a non-numeric starve threshold', { starveThreshold: 'lots', emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true }],
        ['an emergency wait below the starve threshold', { starveThreshold: 4, emergencyWait: 2, skipRestoresPriority: true, skipPickReplacement: true }],
        ['an out-of-range starve threshold', { starveThreshold: MAX_WAIT_THRESHOLD + 1, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true }],
        ['an out-of-range emergency wait', { starveThreshold: 2, emergencyWait: MAX_WAIT_THRESHOLD + 1, skipRestoresPriority: true, skipPickReplacement: true }],
        ['a non-boolean skipRestoresPriority', { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: 'maybe', skipPickReplacement: true }],
        ['a non-boolean skipPickReplacement', { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: 'maybe' }],
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
          showPartnershipMatrix: 'true',
        });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { targetScore: 15, autoMixDefault: false, leaderboardSize: 10, countOffScheduleGames: true, showPartnershipMatrix: true },
        });
      });

      it('reports a clean error when the arena no longer exists', async () => {
        prisma.arena.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateArenaMatchDefaults(ARENA, {
          targetScore: 11, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true, showPartnershipMatrix: false,
        });
        expect(result.error).toMatch(/no longer exists/i);
      });

      it.each([
        ['a zero target score', { targetScore: 0, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true, showPartnershipMatrix: false }],
        ['a fractional target score', { targetScore: 11.5, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true, showPartnershipMatrix: false }],
        ['an out-of-range target score', { targetScore: MAX_TARGET_SCORE + 1, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true, showPartnershipMatrix: false }],
        ['an out-of-range leaderboard size', { targetScore: 11, autoMixDefault: true, leaderboardSize: MAX_LEADERBOARD_SIZE + 1, countOffScheduleGames: true, showPartnershipMatrix: false }],
        ['a non-boolean autoMixDefault', { targetScore: 11, autoMixDefault: 'maybe', leaderboardSize: 5, countOffScheduleGames: true, showPartnershipMatrix: false }],
        ['a non-boolean countOffScheduleGames', { targetScore: 11, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: 1, showPartnershipMatrix: false }],
        ['a non-boolean showPartnershipMatrix', { targetScore: 11, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true, showPartnershipMatrix: 'maybe' }],
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
        // Every active player pulled off the rack with waitRounds reset
        // and any pending skip-boost cleared.
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { arenaId: ARENA, leftAt: null },
          data: { queueOrder: null, waitRounds: 0, skipBoosted: false },
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
        // The player update sets only queue/wait/boost fields — never wins/losses/rating/gamesPlayed.
        const data = tx.player.updateMany.mock.calls[0][0].data;
        expect(data).toEqual({ queueOrder: null, waitRounds: 0, skipBoosted: false });
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
          data: { queueOrder: 4, waitRounds: 0, skipBoosted: false, gamesOffset: 6 },
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
          data: { queueOrder: null, waitRounds: 0, skipBoosted: false },
        });
      });
    });

    describe('createArena()', () => {
      beforeEach(() => {
        requireUser.mockResolvedValue({
          user: { id: 'u1', firstName: 'Alice', lastName: 'Anders' },
        });
        prisma.arena.create.mockResolvedValue({ id: 'a-new', name: 'My Arena' });
      });

      it('accepts a plain name string (legacy signature) and creates the arena', async () => {
        const result = await actions.createArena('My Arena');
        expect(result.error).toBeUndefined();
        expect(result.arena).toEqual({ id: 'a-new', name: 'My Arena' });
        const call = prisma.arena.create.mock.calls[0][0];
        expect(call.data.name).toBe('My Arena');
        expect(call.data.description).toBeNull();
        expect(call.data.scheduleDays).toEqual([]);
        expect(call.data.scheduleStart).toBeNull();
        expect(call.data.scheduleEnd).toBeNull();
        expect(call.data.timezone).toBe('Asia/Manila');
      });

      it('persists description + normalized schedule from an object payload', async () => {
        const result = await actions.createArena({
          name: '  Court Kings  ',
          description: '  Saturday night open play  ',
          scheduleDays: [5, 1, 3, 1],
          scheduleStart: '18:00',
          scheduleEnd: '22:00',
          timezone: 'Asia/Singapore',
        });
        expect(result.error).toBeUndefined();
        const call = prisma.arena.create.mock.calls[0][0];
        expect(call.data.name).toBe('Court Kings');
        expect(call.data.description).toBe('Saturday night open play');
        expect(call.data.scheduleDays).toEqual([1, 3, 5]);
        expect(call.data.scheduleStart).toBe('18:00');
        expect(call.data.scheduleEnd).toBe('22:00');
        expect(call.data.timezone).toBe('Asia/Singapore');
      });

      it('null-coerces a blank description and empty schedule times', async () => {
        await actions.createArena({ name: 'My Arena', description: '   ', scheduleStart: '', scheduleEnd: '' });
        const call = prisma.arena.create.mock.calls[0][0];
        expect(call.data.description).toBeNull();
        expect(call.data.scheduleStart).toBeNull();
        expect(call.data.scheduleEnd).toBeNull();
        expect(call.data.timezone).toBe('Asia/Manila');
      });

      it.each([
        ['a blank name', { name: '   ' }],
        ['an over-long name', { name: 'x'.repeat(81) }],
        ['an over-long description', { name: 'OK', description: 'x'.repeat(281) }],
        ['an out-of-range day', { name: 'OK', scheduleDays: [7] }],
        ['a partial-numeric day string', { name: 'OK', scheduleDays: ['1x'] }],
        ['a blank day string', { name: 'OK', scheduleDays: [''] }],
        ['a hex-shaped day string', { name: 'OK', scheduleDays: ['0x1'] }],
        ['a malformed start time', { name: 'OK', scheduleStart: '6pm' }],
        ['an end before the start', { name: 'OK', scheduleStart: '22:00', scheduleEnd: '18:00' }],
        ['an unrecognized timezone', { name: 'OK', timezone: 'Mars/Olympus' }],
      ])('rejects %s and writes nothing', async (_label, input) => {
        const result = await actions.createArena(input);
        expect(result.error).toBeTruthy();
        expect(prisma.arena.create).not.toHaveBeenCalled();
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
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('updateMemberRole() refuses to change the owner', async () => {
      const result = await actions.updateMemberRole(ARENA, 'u1', ROLES.MEMBER);
      expect(result.error).toBeTruthy();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('updateMemberRole() demotes and revokes invite links in one locked transaction', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        arenaMembership: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        arenaInvite: { updateMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.updateMemberRole(ARENA, 'u2', ROLES.MEMBER);
      expect(result.error).toBeUndefined();
      expect(tx.$executeRaw).toHaveBeenCalled(); // invite lock held
      // Role flip and link revocation share the same transaction.
      expect(tx.arenaMembership.updateMany).toHaveBeenCalled();
      expect(tx.arenaInvite.updateMany).toHaveBeenCalledWith({
        where: { arenaId: ARENA, createdBy: 'u2', active: true },
        data: { active: false },
      });
    });

    it('updateMemberRole() does not touch invites when promoting to organizer', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        arenaMembership: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        arenaInvite: { updateMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.updateMemberRole(ARENA, 'u2', ROLES.ORGANIZER);
      expect(result.error).toBeUndefined();
      expect(tx.arenaInvite.updateMany).not.toHaveBeenCalled();
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
        arenaInvite: { updateMany: vi.fn() },
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
      // Removed members can't keep handing out invite links they created.
      expect(tx.arenaInvite.updateMany).toHaveBeenCalledWith({
        where: { arenaId: ARENA, createdBy: 'u2', active: true },
        data: { active: false },
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
      matchPlayer: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
        updateMany: vi.fn(),
      },
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
      // The matches `temp1` is already in are looked up so colliding `own1`
      // rows can be dropped before the re-point — otherwise the re-point would
      // violate the (matchId, playerId) unique constraint.
      expect(tx.matchPlayer.findMany).toHaveBeenCalledWith({
        where: { playerId: 'temp1' },
        select: { matchId: true },
      });
      // Order matters: the walk-in `update` claims (arenaId, userId), so the
      // existing `ownPlayer` must be deleted FIRST or the @@unique constraint
      // fires with P2002. Lock the ordering here so a future reorder is loud.
      const deleteOrder = tx.player.deleteMany.mock.invocationCallOrder[0];
      const updateOrder = tx.player.update.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(updateOrder);
    });

    it('linkPlayerToMember() drops colliding MatchPlayer rows before re-pointing', async () => {
      // Both players already appear in match `m1` (the walk-in and the member's
      // auto-player shared a court before linking). Re-pointing `own1` onto
      // `temp1` there would violate the (matchId, playerId) unique constraint,
      // so the colliding `own1` row must be deleted first.
      const tx = linkTx({
        temp: { id: 'temp1', userId: null, gamesPlayed: 1, rating: 1100 },
        member: { role: ROLES.MEMBER },
        ownPlayer: { id: 'own1', gamesPlayed: 3, wins: 2, losses: 1, rating: 1300 },
        onCourt: null,
      });
      tx.matchPlayer.findMany.mockResolvedValue([{ matchId: 'm1' }]);
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.linkPlayerToMember(ARENA, 'temp1', 'u2');
      expect(result.error).toBeUndefined();
      expect(tx.matchPlayer.deleteMany).toHaveBeenCalledWith({
        where: { playerId: 'own1', matchId: { in: ['m1'] } },
      });
      // The collision drop must run before the re-point, or `updateMany` would
      // recreate the duplicate the delete just removed.
      const dropOrder = tx.matchPlayer.deleteMany.mock.invocationCallOrder[0];
      const repointOrder = tx.matchPlayer.updateMany.mock.invocationCallOrder[0];
      expect(dropOrder).toBeLessThan(repointOrder);
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
      matchPlayer: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
        updateMany: vi.fn(),
      },
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

describe('skipPlayer() — hybrid self/manager authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No-op the tx: these tests assert the auth *decision* (reach the write
    // vs return early), not the queue mutation. (clearAllMocks keeps a leaked
    // callback-invoking impl from other suites, so override it explicitly.)
    prisma.$transaction.mockImplementation(async () => undefined);
  });

  it('rejects an unauthenticated caller and writes nothing', async () => {
    getCurrentUser.mockResolvedValue(null);
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.error).toBe('Please sign in.');
    expect(prisma.player.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets a member skip their OWN paddle even when the manager guard rejects them', async () => {
    // Self-skip auth passes regardless of manager status. We still call
    // `requireArenaManager` up front (so a manager skipping their own paddle
    // can use the replacement picker), but a non-manager whose paddle this
    // is must still be allowed through.
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    requireArenaManager.mockResolvedValue({ error: ERR });
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.error).toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('lets a manager skip someone else’s paddle', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-mgr' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-other' });
    requireArenaManager.mockResolvedValue({ user: { id: 'u-mgr' }, arena: { id: ARENA }, role: ROLES.OWNER });
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.error).toBeUndefined();
    expect(requireArenaManager).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('blocks a non-manager from skipping someone else’s paddle', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-x' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-other' });
    requireArenaManager.mockResolvedValue({ error: ERR });
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.error).toBe('You can only rest your own paddle.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('a walk-in (no account) can only be skipped by a manager', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-x' });
    prisma.player.findFirst.mockResolvedValue({ userId: null });
    requireArenaManager.mockResolvedValue({ error: ERR });
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.error).toBe('You can only rest your own paddle.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Helper: a tx stub whose ordered rack is `rackIds`, used to drive the
  // eligibility checks inside the transaction. `skipRestoresPriority` toggles
  // between the new "Next in Line" behavior (default) and the legacy
  // back-of-rack reset. `skipPickReplacement` controls whether a manager's
  // `replacementId` is honored (default on).
  const txWithRack = (rackIds, {
    maxOrder = rackIds.length,
    skipRestoresPriority = true,
    skipPickReplacement = true,
  } = {}) => ({
    $executeRaw: vi.fn(),
    arena: {
      findUnique: vi.fn().mockResolvedValue({ skipRestoresPriority, skipPickReplacement }),
    },
    player: {
      findMany: vi
        .fn()
        .mockResolvedValue(rackIds.map((id, i) => ({ id, queueOrder: i + 1 }))),
      aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: maxOrder } }),
      update: vi.fn(),
    },
  });

  it('On (default): stamps Next-in-Line and pushes the paddle just past on-deck', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    // p1 on deck (index 0); rack of 6 means someone waits behind on-deck.
    const tx = txWithRack(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.notification).toBe('Marked Next in Line — top priority on the next mix.');
    // p1 lands at position ON_DECK_SIZE+1 (5); the four bumped-up players take 1..4.
    // Last write is the skipBoosted flag on the skipped paddle.
    const updates = tx.player.update.mock.calls.map((c) => c[0]);
    expect(updates).toContainEqual({ where: { id: 'p2' }, data: { queueOrder: 1 } });
    expect(updates).toContainEqual({ where: { id: 'p3' }, data: { queueOrder: 2 } });
    expect(updates).toContainEqual({ where: { id: 'p4' }, data: { queueOrder: 3 } });
    expect(updates).toContainEqual({ where: { id: 'p5' }, data: { queueOrder: 4 } });
    expect(updates).toContainEqual({ where: { id: 'p1' }, data: { queueOrder: 5 } });
    expect(updates).toContainEqual({ where: { id: 'p1' }, data: { skipBoosted: true } });
    // p6 was already at position 6 — no rewrite needed.
    expect(updates).not.toContainEqual(expect.objectContaining({ where: { id: 'p6' } }));
  });

  it('Off (legacy) + auto-pick: ONE write — skipped paddle to the back, first-waiting auto-promotes', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    // Rack of 5: p1 on deck (index 0). Off-mode auto-pick does NOT renumber
    // the rack — the skipped paddle goes to max+1 and the first waiting paddle
    // (p5) promotes by queueOrder on its own. Minimal write volume under the
    // lock (the prior single-row behavior, restored after the picker refactor).
    const tx = txWithRack(['p1', 'p2', 'p3', 'p4', 'p5'], { maxOrder: 5, skipRestoresPriority: false });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.notification).toBe('Paddle sent to the back of the rack.');
    // Exactly one player.update — the skipped paddle, combining position +
    // wait reset + boost clear. p2..p5 are NOT rewritten.
    expect(tx.player.update).toHaveBeenCalledTimes(1);
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { queueOrder: 6, waitRounds: 0, skipBoosted: false },
    });
  });

  it('Off (legacy) + manual pick: TWO writes — replacement into freed slot, skipped to back', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-mgr' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-other' });
    requireArenaManager.mockResolvedValue({ user: { id: 'u-mgr' }, arena: { id: ARENA }, role: ROLES.OWNER });
    // Off-mode, manager picks G (index 6) to fill C's freed slot (C is index 2,
    // queueOrder 3). Minimal writes: G takes queueOrder 3, C goes to back.
    const tx = txWithRack(['A', 'B', 'C', 'D', 'E', 'F', 'G'], { maxOrder: 7, skipRestoresPriority: false });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'C', 'G');
    expect(result.error).toBeUndefined();
    expect(result.notification).toBe('Paddle sent to the back of the rack.');
    expect(tx.player.update).toHaveBeenCalledTimes(2);
    expect(tx.player.update).toHaveBeenCalledWith({ where: { id: 'G' }, data: { queueOrder: 3 } });
    expect(tx.player.update).toHaveBeenCalledWith({
      where: { id: 'C' },
      data: { queueOrder: 8, waitRounds: 0, skipBoosted: false },
    });
  });

  it('returns NO notification on a no-op skip (paddle already left the rack)', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    const tx = txWithRack(['p2', 'p3', 'p4', 'p5', 'p6']); // p1 not present
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.error).toBeUndefined();
    expect(result.notification).toBe('');
    expect(tx.player.update).not.toHaveBeenCalled();
  });

  it('rejects skipping an OFF-deck paddle server-side, even for the owner (no-op)', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    // p1 sits at index 5 — past the on-deck group — so a direct POST can't move
    // it (and can't dodge the fairness rules) despite passing self-auth.
    const tx = txWithRack(['a', 'b', 'c', 'd', 'e', 'p1', 'g', 'h']);
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.notification).toBe('');
    expect(tx.player.update).not.toHaveBeenCalled();
  });

  it('rejects skipping when nobody waits behind the on-deck group (no-op)', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    const tx = txWithRack(['p1', 'b', 'c', 'd']); // exactly ON_DECK_SIZE, none waiting
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'p1');
    expect(result.notification).toBe('');
    expect(tx.player.update).not.toHaveBeenCalled();
  });

  // --- Manager replacement picker (skipPickReplacement) ----------------------
  // A manager can name which waiting paddle fills the freed on-deck slot.
  // The picker is gated on (a) manager auth, (b) the arena's
  // `skipPickReplacement` setting, and (c) the replacement still being in the
  // waiting pool at lock time. Any failure falls back to auto-pick (first
  // waiting), EXCEPT a raced replacement which returns a clean error so the
  // manager can pick again rather than misfiring.

  it('Manager + picker: lands the picked paddle in the freed on-deck slot', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-mgr' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-other' });
    requireArenaManager.mockResolvedValue({ user: { id: 'u-mgr' }, arena: { id: ARENA }, role: ROLES.OWNER });
    // Rack: A B C D E F G — on-deck = A B C D (indices 0..3). Skip C (index 2),
    // pick G (index 6).
    const tx = txWithRack(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'C', 'G');
    expect(result.error).toBeUndefined();
    expect(result.notification).toBe('Marked Next in Line — top priority on the next mix.');
    const updates = tx.player.update.mock.calls.map((c) => c[0]);
    // Expected order: A(1), B(2), D(3), G(4), C(5), E(6), F(7).
    expect(updates).toContainEqual({ where: { id: 'D' }, data: { queueOrder: 3 } });
    expect(updates).toContainEqual({ where: { id: 'G' }, data: { queueOrder: 4 } });
    expect(updates).toContainEqual({ where: { id: 'C' }, data: { queueOrder: 5 } });
    expect(updates).toContainEqual({ where: { id: 'E' }, data: { queueOrder: 6 } });
    expect(updates).toContainEqual({ where: { id: 'F' }, data: { queueOrder: 7 } });
    expect(updates).toContainEqual({ where: { id: 'C' }, data: { skipBoosted: true } });
    // A, B kept their positions — no rewrite for them.
    expect(updates).not.toContainEqual(expect.objectContaining({ where: { id: 'A' } }));
    expect(updates).not.toContainEqual(expect.objectContaining({ where: { id: 'B' } }));
  });

  it('Raced replacement (no longer in waiting) surfaces a clean error and no-ops', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-mgr' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-other' });
    requireArenaManager.mockResolvedValue({ user: { id: 'u-mgr' }, arena: { id: ARENA }, role: ROLES.OWNER });
    // Manager picks "ghost" which isn't in the queue (already pulled to a court).
    const tx = txWithRack(['A', 'B', 'C', 'D', 'E', 'F']);
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'C', 'ghost');
    expect(result.error).toMatch(/no longer available/i);
    expect(tx.player.update).not.toHaveBeenCalled();
  });

  it('Replacement that is on-deck (not in waiting) is rejected with a distinct message', async () => {
    // The picker UI only lists waiting paddles, but a malformed POST could
    // name an on-deck paddle. Server enforces the waiting constraint and uses
    // a different message than the raced case so the cause is debuggable.
    getCurrentUser.mockResolvedValue({ id: 'u-mgr' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-other' });
    requireArenaManager.mockResolvedValue({ user: { id: 'u-mgr' }, arena: { id: ARENA }, role: ROLES.OWNER });
    // B is on-deck (index 1) — can't be a replacement.
    const tx = txWithRack(['A', 'B', 'C', 'D', 'E', 'F']);
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'C', 'B');
    expect(result.error).toMatch(/already on deck/i);
    expect(result.error).not.toMatch(/no longer available/i);
    expect(tx.player.update).not.toHaveBeenCalled();
  });

  it('Non-manager picker is silently ignored — falls back to auto-pick', async () => {
    // A non-manager somehow sends a replacementId (UI never offers this, but
    // a direct POST could). Server falls back to auto-pick rather than
    // erroring, so the skip still completes.
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    requireArenaManager.mockResolvedValue({ error: ERR });
    const tx = txWithRack(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    // p1 is the caller's own paddle (self-skip ok). They try to pick p7,
    // but since they aren't a manager, the server uses auto-pick (p5, first
    // waiting) — same as if no replacementId were sent.
    const result = await actions.skipPlayer(ARENA, 'p1', 'p7');
    expect(result.error).toBeUndefined();
    const updates = tx.player.update.mock.calls.map((c) => c[0]);
    // Auto-pick path: p5 fills slot 4, p1 lands at 5, p7 stays at original 7.
    expect(updates).toContainEqual({ where: { id: 'p5' }, data: { queueOrder: 4 } });
    expect(updates).toContainEqual({ where: { id: 'p1' }, data: { queueOrder: 5 } });
    expect(updates).not.toContainEqual({ where: { id: 'p7' }, data: { queueOrder: 4 } });
  });

  it('Setting off: manager picker is silently ignored — falls back to auto-pick', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-mgr' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-other' });
    requireArenaManager.mockResolvedValue({ user: { id: 'u-mgr' }, arena: { id: ARENA }, role: ROLES.OWNER });
    // skipPickReplacement off — even a manager's pick is ignored.
    const tx = txWithRack(['A', 'B', 'C', 'D', 'E', 'F', 'G'], { skipPickReplacement: false });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));
    const result = await actions.skipPlayer(ARENA, 'C', 'G');
    expect(result.error).toBeUndefined();
    const updates = tx.player.update.mock.calls.map((c) => c[0]);
    // Auto-pick: E (first waiting) fills slot 4, C lands at 5.
    expect(updates).toContainEqual({ where: { id: 'E' }, data: { queueOrder: 4 } });
    expect(updates).toContainEqual({ where: { id: 'C' }, data: { queueOrder: 5 } });
    // G stays at its original position 7 — not promoted.
    expect(updates).not.toContainEqual({ where: { id: 'G' }, data: { queueOrder: 4 } });
  });
});

describe('fillCourt() — snapshot rack state for cancelFill', () => {
  // The snapshot writes (CourtSlot.prevQueueOrder/prevWaitRounds and
  // Court.fillBumpedPlayerIds) are the INPUT contract that cancelFill relies on.
  // A regression here turns every future cancel into a silent NO_SNAPSHOT no-op,
  // so this asserts the writes happen exactly as cancelFill expects.
  const COURT = 'court-1';

  // The four about to be stacked, in queueOrder order (positions 1..4 with no
  // waiting at fill time). Plus two players still behind them in the rack —
  // those are the ones whose waitRounds get bumped by the fill.
  const TOP_FOUR = [
    { id: 'p1', queueOrder: 1, waitRounds: 0 },
    { id: 'p2', queueOrder: 2, waitRounds: 0 },
    { id: 'p3', queueOrder: 3, waitRounds: 0 },
    { id: 'p4', queueOrder: 4, waitRounds: 0 },
  ];
  const BEHIND = [{ id: 'p5' }, { id: 'p6' }];

  function makeTx() {
    return {
      $executeRaw: vi.fn(),
      court: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), // atomic claim succeeds
        update: vi.fn(),
      },
      player: {
        // Two findMany calls in fillCourt: first the top 4, then the rack
        // behind them (the "bumped" set captured for cancelFill).
        findMany: vi.fn()
          .mockResolvedValueOnce(TOP_FOUR)
          .mockResolvedValueOnce(BEHIND),
        updateMany: vi.fn().mockResolvedValue({ count: 4 }), // dequeue succeeds
      },
      partnership: {
        findMany: vi.fn().mockResolvedValue([]), // no prior partnerships
        upsert: vi.fn(),
      },
      courtSlot: {
        createMany: vi.fn(),
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    requireArenaManager.mockResolvedValue({
      user: { id: 'u1' },
      arena: { id: ARENA, ownerId: 'u1' },
      role: ROLES.OWNER,
    });
  });

  it('writes prevQueueOrder/prevWaitRounds onto every CourtSlot it creates', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.fillCourt(ARENA, COURT);

    // Every slot must carry the player's pre-fill rack state; cancelFill needs
    // both fields non-null or it refuses with NO_SNAPSHOT.
    const [{ data }] = tx.courtSlot.createMany.mock.calls[0];
    expect(data).toHaveLength(4);
    for (const slot of data) {
      const source = TOP_FOUR.find((p) => p.id === slot.playerId);
      expect(slot.prevQueueOrder).toBe(source.queueOrder);
      expect(slot.prevWaitRounds).toBe(source.waitRounds);
      expect([1, 2]).toContain(slot.team);
    }
  });

  it('records the exact bumped player ids on the court for cancelFill to reverse', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.fillCourt(ARENA, COURT);

    // cancelFill scopes its waitRounds decrement to EXACTLY these ids — anyone
    // recycled into the queue by a later finish must not be touched.
    expect(tx.court.update).toHaveBeenCalledWith({
      where: { id: COURT },
      data: { fillBumpedPlayerIds: ['p5', 'p6'] },
    });
  });
});

describe('cancelFill() — return four players to the rack without recording a match', () => {
  const COURT = 'court-1';

  // Build a fresh tx mock for cancelFill: covers every prisma call the action
  // makes inside the transaction. court.updateMany returns count: 1 by default
  // (the happy "atomic claim" path); each test overrides specifics.
  function makeTx({ slots, bumpedIds = [], others = [], courtClaimCount = 1 } = {}) {
    return {
      $executeRaw: vi.fn(),
      court: {
        findFirst: vi.fn().mockResolvedValue({ fillBumpedPlayerIds: bumpedIds }),
        updateMany: vi.fn().mockResolvedValue({ count: courtClaimCount }),
      },
      courtSlot: {
        findMany: vi.fn().mockResolvedValue(slots),
        deleteMany: vi.fn(),
      },
      player: {
        update: vi.fn(),
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue(others.map((id) => ({ id }))),
      },
      partnership: {
        updateMany: vi.fn(),
      },
    };
  }

  // A complete 4-slot court with snapshot data filled in. Players were at
  // queue positions 1..4 with no waiting (waitRounds: 0) at fill time.
  const FULL_SLOTS = [
    { playerId: 'p1', team: 1, prevQueueOrder: 1, prevWaitRounds: 0 },
    { playerId: 'p2', team: 1, prevQueueOrder: 2, prevWaitRounds: 0 },
    { playerId: 'p3', team: 2, prevQueueOrder: 3, prevWaitRounds: 0 },
    { playerId: 'p4', team: 2, prevQueueOrder: 4, prevWaitRounds: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    requireArenaManager.mockResolvedValue({
      user: { id: 'u1' },
      arena: { id: ARENA, ownerId: 'u1' },
      role: ROLES.OWNER,
    });
  });

  it('restores waitRounds, decrements gamesPlayed with a floor, and renumbers 1..N with the four first', async () => {
    const tx = makeTx({
      slots: FULL_SLOTS,
      bumpedIds: ['p5'],
      others: ['p5', 'p6'], // already queued behind the four
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.cancelFill(ARENA, COURT);
    expect(result.error).toBeUndefined();

    // Court flipped vacant AND bookkeeping cleared on the same claim.
    expect(tx.court.updateMany).toHaveBeenCalledWith({
      where: { id: COURT, arenaId: ARENA, status: 'playing' },
      data: { status: 'vacant', fillBumpedPlayerIds: [] },
    });

    // waitRounds restored via plain update; gamesPlayed decremented via
    // updateMany with `gt: 0` guard so it can never go negative.
    for (const s of FULL_SLOTS) {
      expect(tx.player.update).toHaveBeenCalledWith({
        where: { id: s.playerId },
        data: { waitRounds: s.prevWaitRounds },
      });
      expect(tx.player.updateMany).toHaveBeenCalledWith({
        where: { id: s.playerId, gamesPlayed: { gt: 0 } },
        data: { gamesPlayed: { decrement: 1 } },
      });
    }

    // Renumber: cancelled four come first in their original relative order,
    // then the rest of the rack, densely 1..N.
    const renumberCalls = tx.player.update.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => 'queueOrder' in (arg.data ?? {}));
    expect(renumberCalls.map((c) => [c.where.id, c.data.queueOrder])).toEqual([
      ['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4], ['p5', 5], ['p6', 6],
    ]);

    // Slots deleted last so the snapshot is readable throughout the action.
    expect(tx.courtSlot.deleteMany).toHaveBeenCalledWith({ where: { courtId: COURT } });
  });

  it('reverses the wait-round bump for only the players the fill actually bumped, not whoever is queued now', async () => {
    const tx = makeTx({
      slots: FULL_SLOTS,
      bumpedIds: ['p5', 'p6'], // exactly who fillCourt bumped
      others: ['p5', 'p6', 'p7'], // p7 joined later, must NOT be decremented
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.cancelFill(ARENA, COURT);

    // The wait-round decrement uses { in: bumpedIds }, not a blanket scan of
    // currently-queued players — so p7 (who joined after the fill) is safe.
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['p5', 'p6'] },
        arenaId: ARENA,
        leftAt: null,
        queueOrder: { not: null },
        waitRounds: { gt: 0 },
      },
      data: { waitRounds: { decrement: 1 } },
    });
  });

  it('decrements the two partnership counts (one per team) with the gt:0 guard', async () => {
    const tx = makeTx({ slots: FULL_SLOTS });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.cancelFill(ARENA, COURT);

    // unbumpPartnership floors at 0 via `count: { gt: 0 }`. Pair ids are
    // canonical (sorted), so [p1,p2] and [p3,p4] in this fixture.
    expect(tx.partnership.updateMany).toHaveBeenCalledWith({
      where: { playerA: 'p1', playerB: 'p2', count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
    expect(tx.partnership.updateMany).toHaveBeenCalledWith({
      where: { playerA: 'p3', playerB: 'p4', count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  });

  it('returns a user-visible error and writes nothing when the court is already vacant (NOT_PLAYING)', async () => {
    const tx = makeTx({ slots: FULL_SLOTS, courtClaimCount: 0 });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.cancelFill(ARENA, COURT);
    expect(result.error).toMatch(/no longer active/i);
    // The atomic claim failed — nothing else should have been mutated.
    expect(tx.courtSlot.deleteMany).not.toHaveBeenCalled();
    expect(tx.player.update).not.toHaveBeenCalled();
  });

  it.each([
    ['prevQueueOrder', { ...FULL_SLOTS[0], prevQueueOrder: null }],
    ['prevWaitRounds', { ...FULL_SLOTS[0], prevWaitRounds: null }],
  ])('refuses with a clear error when %s is null on any slot (NO_SNAPSHOT)', async (_label, bad) => {
    const tx = makeTx({ slots: [bad, FULL_SLOTS[1], FULL_SLOTS[2], FULL_SLOTS[3]] });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.cancelFill(ARENA, COURT);
    expect(result.error).toMatch(/started before cancel/i);
    expect(tx.courtSlot.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses with a clear error when the court does not have exactly four slots (INVALID_COURT)', async () => {
    const tx = makeTx({ slots: FULL_SLOTS.slice(0, 3) });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.cancelFill(ARENA, COURT);
    expect(result.error).toMatch(/unexpected state/i);
    expect(tx.courtSlot.deleteMany).not.toHaveBeenCalled();
    expect(tx.player.update).not.toHaveBeenCalled();
  });
});

describe('editCourtLineup() — manual partner swap / substitution', () => {
  const COURT = 'court-1';

  // The current on-court four: p1+p2 (Team A) vs p3+p4 (Team B), each carrying
  // the pre-fill snapshot cancelFill relies on.
  const SLOTS = [
    { playerId: 'p1', team: 1, prevQueueOrder: 1, prevWaitRounds: 0 },
    { playerId: 'p2', team: 1, prevQueueOrder: 2, prevWaitRounds: 0 },
    { playerId: 'p3', team: 2, prevQueueOrder: 3, prevWaitRounds: 0 },
    { playerId: 'p4', team: 2, prevQueueOrder: 4, prevWaitRounds: 0 },
  ];

  // Build a tx mock covering every prisma call the action makes. `incoming` is
  // the subbed-in lookup (player.findMany #1); `others` is the rack-renumber
  // lookup (player.findMany #2). Substitutions always have BOTH (|added| ===
  // |removed|), so the ordered mock chain holds; a pure swap fires neither.
  function makeTx({
    court = { id: COURT, fillBumpedPlayerIds: [] }, // null => NOT_PLAYING
    slots = SLOTS,
    incoming = [],
    others = [],
    onCourt = null, // courtSlot.findFirst — is a subbed-in player already on a court?
    skipRestoresPriority = true, // arena.findUnique in the removed branch
  } = {}) {
    return {
      $executeRaw: vi.fn(),
      arena: {
        findUnique: vi.fn().mockResolvedValue({ skipRestoresPriority }),
      },
      court: {
        findFirst: vi.fn().mockResolvedValue(court),
        update: vi.fn(),
      },
      courtSlot: {
        findMany: vi.fn().mockResolvedValue(slots),
        findFirst: vi.fn().mockResolvedValue(onCourt),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      player: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce(incoming)
          .mockResolvedValueOnce(others.map((id) => ({ id }))),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn(),
      },
      partnership: {
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    requireArenaManager.mockResolvedValue({
      user: { id: 'u1' },
      arena: { id: ARENA, ownerId: 'u1' },
      role: ROLES.OWNER,
    });
  });

  it('rejects an invalid lineup before opening a transaction', async () => {
    const result = await actions.editCourtLineup(ARENA, COURT, ['p1', 'p1'], ['p3', 'p4']);
    expect(result.error).toMatch(/four different players/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('substitutes a waiting paddle: dequeues the incoming, returns the outgoing to the FRONT, swaps game credit', async () => {
    // Sub OUT p4, sub IN p5 (waiting at queueOrder 7). Team B becomes p3+p5.
    const tx = makeTx({
      incoming: [{ id: 'p5', queueOrder: 7, waitRounds: 0 }],
      others: ['p6', 'p7'], // other waiters left in the rack
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.editCourtLineup(ARENA, COURT, ['p1', 'p2'], ['p3', 'p5']);
    expect(result.error).toBeUndefined();

    // Incoming dequeued exactly like fillCourt (game credited, pulled off rack).
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p5'] } },
      data: { gamesPlayed: { increment: 1 }, queueOrder: null, waitRounds: 0, skipBoosted: false },
    });
    // Outgoing loses its game credit (floored).
    expect(tx.player.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p4'] }, gamesPlayed: { gt: 0 } },
      data: { gamesPlayed: { decrement: 1 } },
    });
    // Outgoing renumbered to the FRONT (waitRounds reset); others keep theirs.
    const renumber = tx.player.update.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => 'queueOrder' in (arg.data ?? {}));
    expect(renumber.map((c) => [c.where.id, c.data.queueOrder])).toEqual([
      ['p4', 1], ['p6', 2], ['p7', 3],
    ]);
    // Subbed-out paddle is returned as Next-in-Line (skipRestoresPriority on):
    // pre-stack waitRounds restored from the slot snapshot (0 in this fixture)
    // and skipBoosted set so the next auto-mix lifts them above emergency.
    const p4Update = renumber.find((c) => c.where.id === 'p4').data;
    expect(p4Update.waitRounds).toBe(0);
    expect(p4Update.skipBoosted).toBe(true);
    // Other waiters keep their wait fairness — only queueOrder is rewritten.
    expect(renumber.find((c) => c.where.id === 'p6').data).not.toHaveProperty('waitRounds');
    expect(renumber.find((c) => c.where.id === 'p6').data).not.toHaveProperty('skipBoosted');

    // Incoming slot carries its pre-edit rack snapshot for a later cancelFill.
    const [{ data: created }] = tx.courtSlot.createMany.mock.calls[0];
    const p5Slot = created.find((s) => s.playerId === 'p5');
    expect(p5Slot).toMatchObject({ team: 2, prevQueueOrder: 7, prevWaitRounds: 0 });

    // Partnership delta: p3 was with p4, now with p5 — unbump old, bump new.
    expect(tx.partnership.updateMany).toHaveBeenCalledWith({
      where: { playerA: 'p3', playerB: 'p4', count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
    expect(tx.partnership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { playerA_playerB: { playerA: 'p3', playerB: 'p5' } } }),
    );
  });

  it('falls back to the legacy reset for the subbed-out paddle when skipRestoresPriority is OFF', async () => {
    // Same sub as above, but the arena disables the Next-in-Line band. The
    // returned paddle should match legacy skip (waitRounds 0, skipBoosted false).
    const tx = makeTx({
      incoming: [{ id: 'p5', queueOrder: 7, waitRounds: 0 }],
      others: ['p6'],
      skipRestoresPriority: false,
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.editCourtLineup(ARENA, COURT, ['p1', 'p2'], ['p3', 'p5']);

    const p4Update = tx.player.update.mock.calls
      .map(([arg]) => arg)
      .find((arg) => arg.where.id === 'p4').data;
    expect(p4Update.waitRounds).toBe(0);
    expect(p4Update.skipBoosted).toBe(false);
  });

  it('keeps the fill-bump bookkeeping exact when subbing in a paddle the original fill bumped', async () => {
    // p5 was bumped by this court's original fill, so its current waitRounds (1)
    // includes that +1, and it is still in fillBumpedPlayerIds.
    const tx = makeTx({
      court: { id: COURT, fillBumpedPlayerIds: ['p5', 'p6'] },
      incoming: [{ id: 'p5', queueOrder: 7, waitRounds: 1 }],
      others: ['p6'],
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.editCourtLineup(ARENA, COURT, ['p1', 'p2'], ['p3', 'p5']);

    // Snapshot stores the PRE-bump value (1 - 1 = 0) so cancelFill restores the
    // true pre-fill fairness, not the inflated one.
    const [{ data: created }] = tx.courtSlot.createMany.mock.calls[0];
    expect(created.find((s) => s.playerId === 'p5').prevWaitRounds).toBe(0);
    // And the player is dropped from the court's bump set so a later sub-out +
    // cancel can't reverse a wait credit they since earned elsewhere.
    expect(tx.court.update).toHaveBeenCalledWith({
      where: { id: COURT },
      data: { fillBumpedPlayerIds: ['p6'] },
    });
  });

  it('handles a pure team-side swap: rewrites slot teams, touches no game counts or partnerships', async () => {
    const tx = makeTx(); // no incoming/others — nobody enters or leaves the rack
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    // Same four, teams swapped: p3+p4 become Team A, p1+p2 become Team B.
    const result = await actions.editCourtLineup(ARENA, COURT, ['p3', 'p4'], ['p1', 'p2']);
    expect(result.error).toBeUndefined();

    const [{ data: created }] = tx.courtSlot.createMany.mock.calls[0];
    expect(created.filter((s) => s.team === 1).map((s) => s.playerId).sort()).toEqual(['p3', 'p4']);
    expect(created.filter((s) => s.team === 2).map((s) => s.playerId).sort()).toEqual(['p1', 'p2']);

    // Same partnerships, so no count changes; no one moved, so no game-count edits.
    expect(tx.partnership.updateMany).not.toHaveBeenCalled();
    expect(tx.partnership.upsert).not.toHaveBeenCalled();
    expect(tx.player.update).not.toHaveBeenCalled();
    expect(tx.player.updateMany).not.toHaveBeenCalled();
  });

  it('errors and writes nothing when the court is no longer playing (NOT_PLAYING)', async () => {
    const tx = makeTx({ court: null });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.editCourtLineup(ARENA, COURT, ['p1', 'p2'], ['p3', 'p5']);
    expect(result.error).toMatch(/no longer active/i);
    expect(tx.courtSlot.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    ['fewer than four slots', SLOTS.slice(0, 3)],
    ['a malformed 3/1 team split', [
      { playerId: 'p1', team: 1, prevQueueOrder: 1, prevWaitRounds: 0 },
      { playerId: 'p2', team: 1, prevQueueOrder: 2, prevWaitRounds: 0 },
      { playerId: 'p3', team: 1, prevQueueOrder: 3, prevWaitRounds: 0 },
      { playerId: 'p4', team: 2, prevQueueOrder: 4, prevWaitRounds: 0 },
    ]],
  ])('refuses with a clear error on %s (INVALID_COURT)', async (_label, slots) => {
    const tx = makeTx({ slots });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.editCourtLineup(ARENA, COURT, ['p1', 'p2'], ['p3', 'p5']);
    expect(result.error).toMatch(/unexpected state/i);
    expect(tx.courtSlot.deleteMany).not.toHaveBeenCalled();
  });

  it('errors when a subbed-in paddle is no longer waiting (QUEUE_CHANGED)', async () => {
    // diff.added = [p5] but the lookup returns nobody (it raced onto a court / left).
    const tx = makeTx({ incoming: [], others: ['p6'] });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.editCourtLineup(ARENA, COURT, ['p1', 'p2'], ['p3', 'p5']);
    expect(result.error).toMatch(/no longer available|try again/i);
    expect(tx.courtSlot.deleteMany).not.toHaveBeenCalled();
  });
});

describe('invite links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireArenaManager.mockResolvedValue({
      user: { id: 'u1' },
      arena: { id: ARENA, ownerId: 'u1' },
      role: ROLES.OWNER,
    });
    requireUser.mockResolvedValue({ user: { id: 'u1' } });
  });

  describe('createArenaInvite()', () => {
    it('rejects an unknown mode and writes nothing', async () => {
      const result = await actions.createArenaInvite(ARENA, 'BOGUS');
      expect(result.error).toMatch(/invalid invite/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('takes the per-arena lock and reuses an existing active invite of that mode', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        arenaMembership: { findUnique: vi.fn().mockResolvedValue({ role: ROLES.OWNER }) },
        arenaInvite: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'inv1', code: 'abc', mode: 'APPROVAL', createdAt: new Date('2026-01-01'),
          }),
          create: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.createArenaInvite(ARENA, 'APPROVAL');
      expect(result.ok).toBe(true);
      expect(result.invite).toMatchObject({ id: 'inv1', code: 'abc', mode: 'APPROVAL' });
      expect(tx.$executeRaw).toHaveBeenCalled(); // advisory lock acquired
      expect(tx.arenaInvite.create).not.toHaveBeenCalled();
    });

    it('mints a fresh invite when none of that mode is active', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        arenaMembership: { findUnique: vi.fn().mockResolvedValue({ role: ROLES.ORGANIZER }) },
        arenaInvite: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'inv2', code: 'xyz', mode: 'AUTO_JOIN', createdAt: new Date('2026-02-02'),
          }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.createArenaInvite(ARENA, 'AUTO_JOIN');
      expect(result.ok).toBe(true);
      expect(result.invite).toMatchObject({ id: 'inv2', code: 'xyz', mode: 'AUTO_JOIN' });
      expect(tx.arenaInvite.create).toHaveBeenCalledTimes(1);
      const arg = tx.arenaInvite.create.mock.calls[0][0];
      expect(arg.data).toMatchObject({ arenaId: ARENA, mode: 'AUTO_JOIN', createdBy: 'u1' });
      expect(typeof arg.data.code).toBe('string');
    });

    it('aborts under the lock when the caller no longer manages the arena', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        // Demoted/removed between requireArenaManager and acquiring the lock.
        arenaMembership: { findUnique: vi.fn().mockResolvedValue({ role: ROLES.MEMBER }) },
        arenaInvite: { findFirst: vi.fn(), create: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.createArenaInvite(ARENA, 'AUTO_JOIN');
      expect(result.error).toMatch(/no longer have permission/i);
      expect(tx.arenaInvite.findFirst).not.toHaveBeenCalled();
      expect(tx.arenaInvite.create).not.toHaveBeenCalled();
    });
  });

  describe('revokeArenaInvite()', () => {
    it('locks the arena and deactivates the invite scoped to the arena', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        arenaMembership: { findUnique: vi.fn().mockResolvedValue({ role: ROLES.OWNER }) },
        arenaInvite: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.revokeArenaInvite(ARENA, 'inv1');
      expect(result.ok).toBe(true);
      expect(tx.$executeRaw).toHaveBeenCalled(); // serialized against redeem
      expect(tx.arenaInvite.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv1', arenaId: ARENA, active: true },
        data: { active: false },
      });
    });

    it('aborts under the lock when the caller no longer manages the arena', async () => {
      const tx = {
        $executeRaw: vi.fn(),
        arenaMembership: { findUnique: vi.fn().mockResolvedValue({ role: ROLES.MEMBER }) },
        arenaInvite: { updateMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.revokeArenaInvite(ARENA, 'inv1');
      expect(result.error).toMatch(/no longer have permission/i);
      expect(tx.arenaInvite.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('redeemArenaInvite()', () => {
    it('errors on an unknown or revoked code', async () => {
      prisma.arenaInvite.findFirst.mockResolvedValue(null);
      const result = await actions.redeemArenaInvite('nope');
      expect(result.error).toMatch(/no longer valid/i);
    });

    it('short-circuits to ALREADY_MEMBER when the redeemer owns the arena', async () => {
      prisma.arenaInvite.findFirst.mockResolvedValue({
        mode: 'AUTO_JOIN', arenaId: ARENA, arena: { ownerId: 'u1' },
      });
      const result = await actions.redeemArenaInvite('code123');
      expect(result).toMatchObject({ ok: true, status: 'ALREADY_MEMBER', arenaId: ARENA });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('short-circuits to ALREADY_MEMBER for an existing member', async () => {
      prisma.arenaInvite.findFirst.mockResolvedValue({
        mode: 'AUTO_JOIN', arenaId: ARENA, arena: { ownerId: 'owner' },
      });
      prisma.arenaMembership.findUnique.mockResolvedValue({ role: ROLES.MEMBER });
      const result = await actions.redeemArenaInvite('code123');
      expect(result).toMatchObject({ ok: true, status: 'ALREADY_MEMBER' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('files a pending JoinRequest for an APPROVAL invite', async () => {
      prisma.arenaInvite.findFirst.mockResolvedValue({
        mode: 'APPROVAL', arenaId: ARENA, arena: { ownerId: 'owner' },
      });
      prisma.arenaMembership.findUnique.mockResolvedValue(null);
      const tx = {
        $executeRaw: vi.fn(),
        arenaInvite: { findFirst: vi.fn().mockResolvedValue({ id: 'inv1' }) }, // still live
        arenaMembership: { findUnique: vi.fn().mockResolvedValue(null) }, // still not a member
        joinRequest: { upsert: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.redeemArenaInvite('code123');
      expect(result).toMatchObject({ ok: true, status: 'PENDING', arenaId: ARENA });
      expect(tx.joinRequest.upsert).toHaveBeenCalledWith({
        where: { arenaId_userId: { arenaId: ARENA, userId: 'u1' } },
        create: { arenaId: ARENA, userId: 'u1' },
        update: {},
      });
    });

    it('APPROVAL returns ALREADY_MEMBER (no request) if the user joined mid-redeem', async () => {
      prisma.arenaInvite.findFirst.mockResolvedValue({
        mode: 'APPROVAL', arenaId: ARENA, arena: { ownerId: 'owner' },
      });
      prisma.arenaMembership.findUnique.mockResolvedValue(null); // pre-tx: not a member
      const tx = {
        $executeRaw: vi.fn(),
        arenaInvite: { findFirst: vi.fn().mockResolvedValue({ id: 'inv1' }) },
        // In-tx re-check: admitted since the pre-check (e.g. another request approved).
        arenaMembership: { findUnique: vi.fn().mockResolvedValue({ id: 'm1' }) },
        joinRequest: { upsert: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.redeemArenaInvite('code123');
      expect(result).toMatchObject({ ok: true, status: 'ALREADY_MEMBER', arenaId: ARENA });
      expect(tx.joinRequest.upsert).not.toHaveBeenCalled();
    });

    it('auto-joins as a MEMBER + queued player for an AUTO_JOIN invite', async () => {
      prisma.arenaInvite.findFirst.mockResolvedValue({
        mode: 'AUTO_JOIN', arenaId: ARENA, arena: { ownerId: 'owner' },
      });
      prisma.arenaMembership.findUnique.mockResolvedValue(null);
      const tx = {
        $executeRaw: vi.fn(),
        arenaInvite: { findFirst: vi.fn().mockResolvedValue({ id: 'inv1' }) }, // re-check: still live
        arenaMembership: { upsert: vi.fn() },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', firstName: 'Al', lastName: 'Pal' }) },
        // Existing active player → activateArenaPlayer returns early, no create.
        player: { findUnique: vi.fn().mockResolvedValue({ id: 'p1', gamesPlayed: 0, leftAt: null, queueOrder: 1 }) },
        joinRequest: { deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.redeemArenaInvite('code123');
      expect(result).toMatchObject({ ok: true, status: 'JOINED', arenaId: ARENA });
      expect(tx.arenaMembership.upsert).toHaveBeenCalledWith({
        where: { arenaId_userId: { arenaId: ARENA, userId: 'u1' } },
        create: { arenaId: ARENA, userId: 'u1', role: ROLES.MEMBER },
        update: {},
      });
    });

    it('aborts when the invite is revoked between the read and the write (in-tx re-check)', async () => {
      prisma.arenaInvite.findFirst.mockResolvedValue({
        mode: 'AUTO_JOIN', arenaId: ARENA, arena: { ownerId: 'owner' },
      });
      prisma.arenaMembership.findUnique.mockResolvedValue(null);
      const tx = {
        $executeRaw: vi.fn(),
        arenaInvite: { findFirst: vi.fn().mockResolvedValue(null) }, // revoked mid-redeem
        arenaMembership: { upsert: vi.fn() },
        user: { findUnique: vi.fn() },
        player: { findUnique: vi.fn() },
        joinRequest: { upsert: vi.fn(), deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.redeemArenaInvite('code123');
      expect(result.error).toMatch(/no longer valid/i);
      expect(tx.arenaMembership.upsert).not.toHaveBeenCalled();
      expect(tx.joinRequest.upsert).not.toHaveBeenCalled();
    });

    it('aborts AUTO_JOIN cleanly when the user row is gone (no membership written)', async () => {
      prisma.arenaInvite.findFirst.mockResolvedValue({
        mode: 'AUTO_JOIN', arenaId: ARENA, arena: { ownerId: 'owner' },
      });
      prisma.arenaMembership.findUnique.mockResolvedValue(null);
      const tx = {
        $executeRaw: vi.fn(),
        arenaInvite: { findFirst: vi.fn().mockResolvedValue({ id: 'inv1' }) }, // still live
        arenaMembership: { upsert: vi.fn() },
        user: { findUnique: vi.fn().mockResolvedValue(null) }, // account vanished mid-redeem
        player: { findUnique: vi.fn() },
        joinRequest: { deleteMany: vi.fn() },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.redeemArenaInvite('code123');
      expect(result.error).toBeTruthy();
      expect(tx.arenaMembership.upsert).not.toHaveBeenCalled();
    });
  });
});
