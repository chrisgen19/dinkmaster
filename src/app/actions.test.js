import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    // `updateMany` is used outside a transaction by `updateArenaMatchmaking`,
    // which clears the courts' deck pointers when the mode is switched off.
    court: { findMany: vi.fn(), updateMany: vi.fn() },
    match: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
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
import { boardFingerprint } from '@/lib/board-fingerprint';
import * as actions from '@/app/actions';
import { applyFillCourtTx, applyMatchDeletionTx } from '@/lib/board-apply';

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
  ['updateMatchScore', () => actions.updateMatchScore(ARENA, 'm1', 11, 5)],
  ['deleteMatch', () => actions.deleteMatch(ARENA, 'm1')],
  ['addCourt', () => actions.addCourt(ARENA)],
  ['removeCourt', () => actions.removeCourt(ARENA, 'c1')],
  ['resetArena', () => actions.resetArena(ARENA)],
  ['updateArenaGeneral', () => actions.updateArenaGeneral(ARENA, { name: 'New' })],
  ['updateArenaSchedule', () => actions.updateArenaSchedule(ARENA, { days: [1, 3, 5] })],
  ['updateArenaMatchmaking', () => actions.updateArenaMatchmaking(ARENA, { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true, balancedPairing: true })],
  ['updateArenaMatchDefaults', () => actions.updateArenaMatchDefaults(ARENA, { targetScore: 11, autoMixDefault: true, leaderboardSize: 5, countOffScheduleGames: true, showPartnershipMatrix: false })],
  ['updateArenaSessions', () => actions.updateArenaSessions(ARENA, { autoResetOnSession: true })],
  ['prepareNextSession', () => actions.prepareNextSession(ARENA)],
  ['createArenaInvite', () => actions.createArenaInvite(ARENA, 'APPROVAL')],
  ['revokeArenaInvite', () => actions.revokeArenaInvite(ARENA, 'inv1')],
  ['checkInPlayer', () => actions.checkInPlayer(ARENA, 'p1')],
  ['checkOutPlayer', () => actions.checkOutPlayer(ARENA, 'p1')],
  ['syncOfflineEvents', () => actions.syncOfflineEvents(ARENA, { batchId: 'batch-12345', events: [], mode: 'strict', settings: { targetScore: 11 } })],
  ['declareOfflineHold', () => actions.declareOfflineHold(ARENA)],
  ['releaseOfflineHold', () => actions.releaseOfflineHold(ARENA)],
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

      // Every valid payload has to name all four booleans; `base` keeps the
      // table rows below readable while each test overrides just its own.
      const base = {
        starveThreshold: 2,
        emergencyWait: 4,
        skipRestoresPriority: true,
        skipPickReplacement: true,
        balancedPairing: true,
        splitDeckByResult: false,
      };

      it('persists valid thresholds and coerces numeric strings', async () => {
        const result = await actions.updateArenaMatchmaking(ARENA, { ...base, starveThreshold: '3', emergencyWait: '6' });
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          // Deck mode off also nulls the alternation pointer, so flipping it
          // back on later can't resume from a stale "winners went last".
          data: { starveThreshold: 3, emergencyWait: 6, skipRestoresPriority: true, skipPickReplacement: true, balancedPairing: true, splitDeckByResult: false, lastDeckFilled: null },
        });
        expect(result.matchmaking).toEqual({ starveThreshold: 3, emergencyWait: 6, skipRestoresPriority: true, skipPickReplacement: true, balancedPairing: true, splitDeckByResult: false });
      });

      it('coerces "true"/"false" string values for skipRestoresPriority', async () => {
        await actions.updateArenaMatchmaking(ARENA, { ...base, skipRestoresPriority: 'false', skipPickReplacement: 'true' });
        expect(prisma.arena.updateMany).toHaveBeenLastCalledWith({
          where: { id: ARENA },
          data: { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: false, skipPickReplacement: true, balancedPairing: true, splitDeckByResult: false, lastDeckFilled: null },
        });
      });

      it('coerces "true"/"false" string values for skipPickReplacement', async () => {
        await actions.updateArenaMatchmaking(ARENA, { ...base, skipPickReplacement: 'false' });
        expect(prisma.arena.updateMany).toHaveBeenLastCalledWith({
          where: { id: ARENA },
          data: { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: false, balancedPairing: true, splitDeckByResult: false, lastDeckFilled: null },
        });
      });

      it('coerces "true"/"false" string values for balancedPairing', async () => {
        await actions.updateArenaMatchmaking(ARENA, { ...base, balancedPairing: 'false' });
        expect(prisma.arena.updateMany).toHaveBeenLastCalledWith({
          where: { id: ARENA },
          data: { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true, balancedPairing: false, splitDeckByResult: false, lastDeckFilled: null },
        });
      });

      it('coerces "true"/"false" string values for splitDeckByResult', async () => {
        await actions.updateArenaMatchmaking(ARENA, { ...base, splitDeckByResult: 'true' });
        expect(prisma.arena.updateMany).toHaveBeenLastCalledWith({
          where: { id: ARENA },
          // Turning deck mode ON leaves the pointer alone — an arena mid-
          // session keeps whichever deck went last.
          data: { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true, skipPickReplacement: true, balancedPairing: true, splitDeckByResult: true },
        });
      });

      it('wipes lingering skipBoosted flags when toggling off', async () => {
        // After persisting `skipRestoresPriority: false`, the action must also
        // clear `Player.skipBoosted` for the arena so the next auto-mix can't
        // elevate paddles that were boosted while the setting was on.
        await actions.updateArenaMatchmaking(ARENA, { ...base, skipRestoresPriority: false });
        expect(prisma.player.updateMany).toHaveBeenCalledWith({
          where: { arenaId: ARENA, skipBoosted: true },
          data: { skipBoosted: false },
        });
      });

      it('does NOT wipe skipBoosted when the setting is being turned on', async () => {
        await actions.updateArenaMatchmaking(ARENA, base);
        // Scoped to the skipBoosted write specifically. `not.toHaveBeenCalled()`
        // would also assert that NO other cleanup touches Player, which the
        // deck-pin retirement below legitimately does.
        expect(prisma.player.updateMany).not.toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ skipBoosted: true }) }),
        );
      });

      it("retires the organizer's deck pins when win/lose decks are switched off", async () => {
        // Pins are inert while the mode is off, so leaving them looks harmless
        // — but re-enabling later would resurrect a four assembled under a
        // configuration nobody is looking at any more. Same argument the
        // courts' pointer cleanup above makes.
        await actions.updateArenaMatchmaking(ARENA, { ...base, splitDeckByResult: false });
        expect(prisma.player.updateMany).toHaveBeenCalledWith({
          where: { arenaId: ARENA, draftedDeck: { not: null } },
          data: { draftedDeck: null, draftedLocked: false },
        });
      });

      it('leaves the pins alone while the mode stays on', async () => {
        await actions.updateArenaMatchmaking(ARENA, { ...base, splitDeckByResult: true });
        expect(prisma.player.updateMany).not.toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ draftedDeck: { not: null } }) }),
        );
      });

      it('clears the courts\' deck pointers when win/lose decks are switched off', async () => {
        // Nulling `Arena.lastDeckFilled` isn't enough: a court filled while the
        // mode was on still carries its own pre-fill copy, and cancelFill
        // restores that copy unconditionally — putting the stale pointer right
        // back, ready for a later re-enable to resume from.
        await actions.updateArenaMatchmaking(ARENA, { ...base, splitDeckByResult: false });
        expect(prisma.court.updateMany).toHaveBeenCalledWith({
          where: { arenaId: ARENA, fillPrevDeck: { not: null } },
          data: { fillPrevDeck: null },
        });
      });

      it('leaves the courts alone when the mode is being turned on', async () => {
        await actions.updateArenaMatchmaking(ARENA, { ...base, splitDeckByResult: true });
        expect(prisma.court.updateMany).not.toHaveBeenCalled();
      });

      it('reports a clean error when the arena no longer exists', async () => {
        prisma.arena.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateArenaMatchmaking(ARENA, base);
        expect(result.error).toMatch(/no longer exists/i);
      });

      it.each([
        ['a zero starve threshold', { ...base, starveThreshold: 0 }],
        ['a fractional starve threshold', { ...base, starveThreshold: 2.5 }],
        ['a non-numeric starve threshold', { ...base, starveThreshold: 'lots' }],
        ['an emergency wait below the starve threshold', { ...base, starveThreshold: 4, emergencyWait: 2 }],
        ['an out-of-range starve threshold', { ...base, starveThreshold: MAX_WAIT_THRESHOLD + 1 }],
        ['an out-of-range emergency wait', { ...base, emergencyWait: MAX_WAIT_THRESHOLD + 1 }],
        ['a non-boolean skipRestoresPriority', { ...base, skipRestoresPriority: 'maybe' }],
        ['a non-boolean skipPickReplacement', { ...base, skipPickReplacement: 'maybe' }],
        ['a non-boolean balancedPairing', { ...base, balancedPairing: 'maybe' }],
        ['a missing balancedPairing', { ...base, balancedPairing: undefined }],
        ['a non-boolean splitDeckByResult', { ...base, splitDeckByResult: 'maybe' }],
        ['a missing splitDeckByResult', { ...base, splitDeckByResult: undefined }],
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

    describe('updateMatchScore()', () => {
      // A recorded 11-5 win for Team A (w1+w2) over Team B (l1+l2), rated at
      // +16 to Team A. The four therefore sit at 1016/1016/984/984, which is
      // exactly 1000 apiece once this match's delta is backed out.
      const MATCH = { id: 'm1', arenaId: ARENA, score1: 11, score2: 5, ratingDelta: 16 };
      const TEAM1 = ['w1', 'w2'];
      const TEAM2 = ['l1', 'l2'];
      const RATED = [
        { id: 'w1', rating: 1016 },
        { id: 'w2', rating: 1016 },
        { id: 'l1', rating: 984 },
        { id: 'l2', rating: 984 },
      ];

      /** tx double for the flip path: roster snapshot + live ratings. */
      const makeFlipTx = ({ snapshots, players = RATED, updatedCount = 1 } = {}) => ({
        $executeRaw: vi.fn(),
        matchPlayer: {
          findMany: vi.fn().mockResolvedValue(
            snapshots ?? [
              ...TEAM1.map((playerId) => ({ playerId, team: 1 })),
              ...TEAM2.map((playerId) => ({ playerId, team: 2 })),
            ],
          ),
        },
        player: { findMany: vi.fn().mockResolvedValue(players), update: vi.fn(), updateMany: vi.fn() },
        match: { updateMany: vi.fn().mockResolvedValue({ count: updatedCount }) },
      });

      beforeEach(() => {
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1' },
          arena: { id: ARENA, ownerId: 'u1', targetScore: 11 },
          role: ROLES.OWNER,
        });
        prisma.match.findUnique.mockResolvedValue(MATCH);
        prisma.match.updateMany.mockResolvedValue({ count: 1 });
      });

      it('persists a winner-preserving correction without touching ratings', async () => {
        const result = await actions.updateMatchScore(ARENA, 'm1', 11, 8);
        expect(result.error).toBeUndefined();
        expect(prisma.match.updateMany).toHaveBeenCalledWith({
          // Scoped by the scoreline it was computed against, so a second
          // manager's simultaneous correction is a clean miss.
          where: { id: 'm1', arenaId: ARENA, score1: 11, score2: 5 },
          data: { score1: 11, score2: 8, editedAt: expect.any(Date) },
        });
        // No reversal transaction: the winner did not change.
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('accepts numeric strings from the client', async () => {
        await actions.updateMatchScore(ARENA, 'm1', '13', '11');
        expect(prisma.match.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ score1: 13, score2: 11 }) }),
        );
      });

      it('no-ops when the scoreline is unchanged', async () => {
        const result = await actions.updateMatchScore(ARENA, 'm1', 11, 5);
        expect(result.error).toBeUndefined();
        expect(prisma.match.updateMany).not.toHaveBeenCalled();
      });

      it('reverses and re-rates the match when the winner flips', async () => {
        const tx = makeFlipTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.updateMatchScore(ARENA, 'm1', 5, 11);
        expect(result.error).toBeUndefined();

        // Backing out +16 puts all four at 1000; the flipped result then rates
        // an even matchup the other way, so team 2 gains what team 1 loses.
        const ratingFor = (id) => tx.player.update.mock.calls.find((c) => c[0].where.id === id)[0].data.rating;
        expect(ratingFor('w1')).toBe(984);
        expect(ratingFor('w2')).toBe(984);
        expect(ratingFor('l1')).toBe(1016);
        expect(ratingFor('l2')).toBe(1016);

        // The stored delta follows the new outcome, so the flip is itself
        // reversible — flipping back must land on the original ratings.
        expect(tx.match.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ ratingDelta: -16 }) }),
        );

        // W/L swaps: the old winners give one back and take a loss.
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: { in: TEAM1 }, wins: { gt: 0 } },
          data: { wins: { decrement: 1 } },
        });
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: { in: TEAM2 }, losses: { gt: 0 } },
          data: { losses: { decrement: 1 } },
        });
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: { in: TEAM2 } },
          data: { wins: { increment: 1 } },
        });
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: { in: TEAM1 } },
          data: { losses: { increment: 1 } },
        });
      });

      it('flipping back restores the ratings the match started from', async () => {
        // Round trip on the output of the previous test: 984/984/1016/1016 at
        // delta -16 must come back to 1016/1016/984/984 at delta +16.
        prisma.match.findUnique.mockResolvedValue({
          ...MATCH,
          score1: 5,
          score2: 11,
          ratingDelta: -16,
        });
        const tx = makeFlipTx({
          players: [
            { id: 'w1', rating: 984 },
            { id: 'w2', rating: 984 },
            { id: 'l1', rating: 1016 },
            { id: 'l2', rating: 1016 },
          ],
        });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.updateMatchScore(ARENA, 'm1', 11, 5);

        const ratingFor = (id) => tx.player.update.mock.calls.find((c) => c[0].where.id === id)[0].data.rating;
        expect(ratingFor('w1')).toBe(1016);
        expect(ratingFor('l1')).toBe(984);
        expect(tx.match.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ ratingDelta: 16 }) }),
        );
      });

      it('stays zero-sum and bounded when the four have played since', async () => {
        // The reconstruction subtracts this match's delta from CURRENT ratings,
        // so once the four have played on, it recovers "current minus this
        // match" rather than the true pre-match ratings, and the replacement
        // delta is computed from slightly-off strengths. Two invariants keep
        // that honest, and both are asserted here rather than argued:
        //
        //   1. Zero-sum — the correction moves points between the four, never
        //      invents or destroys them.
        //   2. Bounded — a correction only ever swaps ONE match's contribution,
        //      and any single delta is inside ±K (32), so no player can move by
        //      more than 2K however stale the match is. Errors cannot compound
        //      across corrections.
        const drifted = [
          { id: 'w1', rating: 1080 }, // won a lot since
          { id: 'w2', rating: 1016 },
          { id: 'l1', rating: 930 }, // lost a lot since
          { id: 'l2', rating: 984 },
        ];
        const totalBefore = drifted.reduce((sum, p) => sum + p.rating, 0);
        const tx = makeFlipTx({ players: drifted });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.updateMatchScore(ARENA, 'm1', 5, 11);

        const written = tx.player.update.mock.calls.map((c) => ({
          id: c[0].where.id,
          rating: c[0].data.rating,
        }));
        expect(written).toHaveLength(4);
        expect(written.reduce((sum, p) => sum + p.rating, 0)).toBe(totalBefore);
        for (const p of written) {
          const was = drifted.find((d) => d.id === p.id).rating;
          expect(Math.abs(p.rating - was)).toBeLessThanOrEqual(64);
        }
      });

      it('correcting a tie banks new counters without taking any back', async () => {
        // A tie recorded no win or loss for anyone, so the reversal has nothing
        // to decrement — it must only apply the new outcome's counters.
        prisma.match.findUnique.mockResolvedValue({
          ...MATCH,
          score1: 9,
          score2: 9,
          ratingDelta: 0, // an even tie moves nobody
        });
        const tx = makeFlipTx({
          players: [
            { id: 'w1', rating: 1000 },
            { id: 'w2', rating: 1000 },
            { id: 'l1', rating: 1000 },
            { id: 'l2', rating: 1000 },
          ],
        });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.updateMatchScore(ARENA, 'm1', 11, 9);
        expect(result.error).toBeUndefined();

        const counterCalls = tx.player.updateMany.mock.calls.map((c) => c[0]);
        expect(counterCalls).toHaveLength(2); // the new winner and loser only
        expect(JSON.stringify(counterCalls)).not.toMatch(/decrement/);
        expect(counterCalls).toContainEqual({
          where: { id: { in: TEAM1 } },
          data: { wins: { increment: 1 } },
        });
        expect(counterCalls).toContainEqual({
          where: { id: { in: TEAM2 } },
          data: { losses: { increment: 1 } },
        });
      });

      it('refuses a flip on a match recorded before rating deltas were stored', async () => {
        // Null delta means the rating effect was never recorded and cannot be
        // recovered — refuse rather than approximate.
        prisma.match.findUnique.mockResolvedValue({ ...MATCH, ratingDelta: null });
        const tx = makeFlipTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.updateMatchScore(ARENA, 'm1', 5, 11);
        expect(result.error).toMatch(/before the app tracked rating changes/i);
        expect(tx.player.update).not.toHaveBeenCalled();
        expect(tx.match.updateMany).not.toHaveBeenCalled();
      });

      it('refuses a flip when the roster no longer resolves to two a side', async () => {
        // `linkPlayerToMember` drops a duplicate participant row when a merge
        // puts both players in the same match; reversing a partial roster
        // would move some ratings and not others.
        const tx = makeFlipTx({
          snapshots: [
            { playerId: 'w1', team: 1 },
            { playerId: 'l1', team: 2 },
            { playerId: 'l2', team: 2 },
          ],
          players: RATED.slice(0, 3),
        });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.updateMatchScore(ARENA, 'm1', 5, 11);
        expect(result.error).toMatch(/roster is incomplete/i);
        expect(tx.player.update).not.toHaveBeenCalled();
      });

      it('refuses a flip whose optimistic write loses a race', async () => {
        // Another manager corrected the same row first, so the score predicate
        // misses and the callback throws — which is what makes the real
        // transaction discard the rating writes. The double can't roll back,
        // so assert the throw itself rather than claiming a rollback.
        const tx = makeFlipTx({ updatedCount: 0 });
        let threw = false;
        prisma.$transaction.mockImplementation(async (cb) => {
          try {
            return await cb(tx);
          } catch (err) {
            threw = true;
            throw err;
          }
        });

        const result = await actions.updateMatchScore(ARENA, 'm1', 5, 11);
        expect(result.error).toMatch(/changed while you were editing/i);
        expect(threw).toBe(true);
      });

      it('judges the correction by the target the match was played under', async () => {
        // The arena has since moved to 15, but this game was played to 11.
        // Correcting it to 11-7 must be legal — validating against today's
        // target would tell the manager the winner never reached 15.
        prisma.match.findUnique.mockResolvedValue({ ...MATCH, targetScore: 11 });
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1' },
          arena: { id: ARENA, ownerId: 'u1', targetScore: 15 },
          role: ROLES.OWNER,
        });

        const result = await actions.updateMatchScore(ARENA, 'm1', 11, 7);
        expect(result.error).toBeUndefined();
        expect(prisma.match.updateMany).toHaveBeenCalled();
      });

      it('holds an old match to its own target when the arena has lowered it', async () => {
        // Played to 15, arena now set to 11. A 12-10 "correction" was never a
        // legal result for this game and must not become one retroactively.
        prisma.match.findUnique.mockResolvedValue({
          ...MATCH,
          score1: 15,
          score2: 9,
          targetScore: 15,
        });
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1' },
          arena: { id: ARENA, ownerId: 'u1', targetScore: 11 },
          role: ROLES.OWNER,
        });

        const result = await actions.updateMatchScore(ARENA, 'm1', 12, 10);
        expect(result.error).toMatch(/must reach 15/i);
        expect(prisma.match.updateMany).not.toHaveBeenCalled();
      });

      it('falls back to the arena target for a match recorded before it was captured', async () => {
        prisma.match.findUnique.mockResolvedValue({ ...MATCH, targetScore: null });
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1' },
          arena: { id: ARENA, ownerId: 'u1', targetScore: 15 },
          role: ROLES.OWNER,
        });

        // 11-7 is illegal under the arena's current 15, which is the only
        // rule we have for a row that never recorded its own.
        const result = await actions.updateMatchScore(ARENA, 'm1', 11, 7);
        expect(result.error).toMatch(/must reach 15/i);
      });

      it.each([
        ['a tie', 11, 11],
        ['a winner below the target', 9, 5],
        ['a margin under two', 11, 10],
      ])('rejects %s and writes nothing', async (_label, s1, s2) => {
        const result = await actions.updateMatchScore(ARENA, 'm1', s1, s2);
        expect(result.error).toBeTruthy();
        expect(prisma.match.updateMany).not.toHaveBeenCalled();
      });

      it('refuses a match id belonging to another arena', async () => {
        prisma.match.findUnique.mockResolvedValueOnce({ ...MATCH, arenaId: 'other_arena' });
        const result = await actions.updateMatchScore(ARENA, 'm1', 11, 8);
        expect(result.error).toMatch(/no longer exists/i);
        expect(prisma.match.updateMany).not.toHaveBeenCalled();
      });

      it('reports a clean error when the match is gone', async () => {
        prisma.match.findUnique.mockResolvedValueOnce(null);
        const result = await actions.updateMatchScore(ARENA, 'm1', 11, 8);
        expect(result.error).toMatch(/no longer exists/i);
        expect(prisma.match.updateMany).not.toHaveBeenCalled();
      });

      it('reports a clean error when the match is deleted mid-correction', async () => {
        prisma.match.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await actions.updateMatchScore(ARENA, 'm1', 11, 8);
        expect(result.error).toMatch(/changed while you were editing/i);
      });
    });


    describe('deleteMatch()', () => {
      const MATCH = {
        id: 'm1',
        arenaId: ARENA,
        score1: 11,
        score2: 5,
        ratingDelta: 16,
        createdAt: new Date('2026-07-27T20:00:00.000Z'),
      };
      const TEAM1 = ['w1', 'w2'];
      const TEAM2 = ['l1', 'l2'];
      const SNAPSHOTS = [
        ...TEAM1.map((playerId) => ({ playerId, team: 1 })),
        ...TEAM2.map((playerId) => ({ playerId, team: 2 })),
      ];
      const RATED = [
        { id: 'w1', rating: 1016 },
        { id: 'w2', rating: 1016 },
        { id: 'l1', rating: 984 },
        { id: 'l2', rating: 984 },
      ];

      // The tx double re-reads the match and the newest id under the lock, so
      // each test can stage what a concurrent action committed while this
      // delete queued for that lock.
      const makeTx = ({ removed = 1, fresh = MATCH, lastSessionResetAt = null } = {}) => ({
        $executeRaw: vi.fn(),
        matchPlayer: { findMany: vi.fn().mockResolvedValue(SNAPSHOTS) },
        player: { findMany: vi.fn().mockResolvedValue(RATED), update: vi.fn(), updateMany: vi.fn() },
        partnership: { updateMany: vi.fn() },
        arena: { findUnique: vi.fn().mockResolvedValue({ lastSessionResetAt }) },
        match: {
          findUnique: vi.fn().mockResolvedValue(fresh),
          deleteMany: vi.fn().mockResolvedValue({ count: removed }),
        },
      });

      beforeEach(() => {
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1' },
          arena: { id: ARENA, ownerId: 'u1', targetScore: 11 },
          role: ROLES.OWNER,
        });
        prisma.match.findUnique.mockResolvedValue(MATCH);
      });

      it('undoes the finish and the fill, then removes the row', async () => {
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.deleteMatch(ARENA, 'm1');
        expect(result.error).toBeUndefined();

        // Elo returns to where it was before the match.
        const ratingFor = (id) => tx.player.update.mock.calls.find((c) => c[0].where.id === id)[0].data.rating;
        expect(ratingFor('w1')).toBe(1000);
        expect(ratingFor('l1')).toBe(1000);

        // The finish's win/loss comes back out...
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: { in: TEAM1 }, wins: { gt: 0 } },
          data: { wins: { decrement: 1 } },
        });
        // ...and so does the FILL's games bump, which a correction leaves alone
        // because the game still happened.
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: { in: [...TEAM1, ...TEAM2] }, arenaId: ARENA, gamesPlayed: { gt: 0 } },
          data: { gamesPlayed: { decrement: 1 } },
        });
        // Both pairings are given back to the variety algorithm.
        expect(tx.partnership.updateMany).toHaveBeenCalledTimes(2);

        expect(tx.match.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', arenaId: ARENA } });
      });

      it('deletes a match that later games have followed', async () => {
        // The point of scoping to the session rather than the newest row: a
        // duplicate spotted at the end of the night, several games later, is
        // the case that actually happens.
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.deleteMatch(ARENA, 'm1');
        expect(result.error).toBeUndefined();
        expect(tx.match.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', arenaId: ARENA } });
      });

      it('refuses a match from a previous session', async () => {
        // Before the boundary its partnership contribution was already wiped
        // by the reset, so the reversal can't be unwound cleanly.
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1' },
          arena: {
            id: ARENA,
            ownerId: 'u1',
            targetScore: 11,
            lastSessionResetAt: new Date('2026-08-03T00:00:00.000Z'),
          },
          role: ROLES.OWNER,
        });

        const result = await actions.deleteMatch(ARENA, 'm1');
        expect(result.error).toMatch(/earlier session/i);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('refuses when a session reset commits while the delete waits for the lock', async () => {
        // `prepareNextSession` takes the same queue lock, so it can close the
        // session between the fast-path check and the reversal.
        const tx = makeTx({ lastSessionResetAt: new Date('2026-08-03T00:00:00.000Z') });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.deleteMatch(ARENA, 'm1');
        expect(result.error).toMatch(/earlier session/i);
        expect(tx.player.update).not.toHaveBeenCalled();
        expect(tx.match.deleteMany).not.toHaveBeenCalled();
      });

      it('refuses a match recorded before rating deltas were stored', async () => {
        // Staged on the re-read as well as the pre-lock read: the row fetched
        // under the lock is the one the reversal actually uses.
        prisma.match.findUnique.mockResolvedValue({ ...MATCH, ratingDelta: null });
        const tx = makeTx({ fresh: { ...MATCH, ratingDelta: null } });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.deleteMatch(ARENA, 'm1');
        expect(result.error).toMatch(/before the app tracked rating changes/i);
        expect(tx.match.deleteMany).not.toHaveBeenCalled();
        expect(tx.player.update).not.toHaveBeenCalled();
      });

      it('refuses a match id belonging to another arena', async () => {
        prisma.match.findUnique.mockResolvedValue({ ...MATCH, arenaId: 'other_arena' });
        const result = await actions.deleteMatch(ARENA, 'm1');
        expect(result.error).toMatch(/no longer exists/i);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('unbumps partnerships for a match played since the last reset', async () => {
        const tx = makeTx({ lastSessionResetAt: new Date('2026-07-27T00:00:00.000Z') });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.deleteMatch(ARENA, 'm1');
        expect(tx.partnership.updateMany).toHaveBeenCalledTimes(2);
      });

      // `deleteMatch` refuses a pre-reset match outright, so the helper's own
      // guard is defence in depth for any future caller — tested directly
      // rather than left as unreachable code nobody checks.
      it('applyMatchDeletionTx leaves partnerships alone across a session reset', async () => {
        // A reset wipes Partnership but keeps Match rows, so a pre-reset match
        // has no contribution left in the current ledger. Unbumping would eat
        // a count THIS session's fills recorded. `gamesPlayed` is cumulative,
        // so it still comes back out.
        const tx = makeTx({ lastSessionResetAt: new Date('2026-08-03T00:00:00.000Z') });
        await applyMatchDeletionTx(tx, ARENA, { match: MATCH });

        expect(tx.partnership.updateMany).not.toHaveBeenCalled();
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: { in: [...TEAM1, ...TEAM2] }, arenaId: ARENA, gamesPlayed: { gt: 0 } },
          data: { gamesPlayed: { decrement: 1 } },
        });
        expect(tx.match.deleteMany).toHaveBeenCalled();
      });

      it('reverses the re-read delta, not the one read before the lock', async () => {
        // A winner-flipping correction committed in between, replacing +16
        // with -16. Reversing the stale value would move all four the wrong
        // way; the row re-read under the lock is the one that counts.
        const tx = makeTx({ fresh: { ...MATCH, score1: 5, score2: 11, ratingDelta: -16 } });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.deleteMatch(ARENA, 'm1');

        // Backing out -16 lifts team 1 from 1016 to 1032 — using the stale
        // +16 would have dropped them to 1000.
        const ratingFor = (id) => tx.player.update.mock.calls.find((c) => c[0].where.id === id)[0].data.rating;
        expect(ratingFor('w1')).toBe(1032);
        expect(ratingFor('l1')).toBe(968);
      });

      it('reports a clean error when the match vanished while waiting for the lock', async () => {
        const tx = makeTx({ fresh: null });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.deleteMatch(ARENA, 'm1');
        expect(result.error).toMatch(/already removed/i);
        expect(tx.player.update).not.toHaveBeenCalled();
      });

      it('reports a clean error when the row vanished mid-delete', async () => {
        const tx = makeTx({ removed: 0 });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.deleteMatch(ARENA, 'm1');
        expect(result.error).toMatch(/already removed/i);
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

    describe('syncOfflineEvents()', () => {
      // Board the mocked transaction exposes: five players, a..e queued in
      // order, one vacant court, no partnerships. Mirrors what
      // readBoardStateTx would assemble, so the "matching" client
      // fingerprint is computed from the same data.
      const PLAYER_ROWS = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
        id,
        queueOrder: i + 1,
        waitRounds: 0,
        gamesPlayed: 0,
        gamesOffset: 0,
        wins: 0,
        losses: 0,
        rating: 1000,
        skipBoosted: false,
      }));
      const ARENA_SETTINGS = {
        targetScore: 11,
        starveThreshold: 2,
        emergencyWait: 4,
        skipRestoresPriority: true,
        skipPickReplacement: true,
        balancedPairing: true,
      };
      const matchingFingerprint = () =>
        boardFingerprint(
          { players: PLAYER_ROWS, queue: ['a', 'b', 'c', 'd', 'e'], courts: [], history: {} },
          ARENA_SETTINGS,
        );
      const batchInput = (overrides = {}) => ({
        batchId: 'batch-0001-abcd',
        base: { fetchedAt: 1, fingerprint: matchingFingerprint() },
        settings: { targetScore: 11 },
        events: [],
        enteredAt: new Date(Date.now() - 60_000).toISOString(),
        mode: 'strict',
        ...overrides,
      });
      // This block installs $transaction implementations with a sync-specific
      // tx shape; drop them after each test so later describes (which may
      // rely on the default no-op $transaction) never see our tx object.
      afterEach(() => {
        prisma.$transaction.mockReset();
      });

      const makeTx = (overrides = {}) => ({
        $executeRaw: vi.fn(),
        offlineSyncBatch: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
        arena: { findUnique: vi.fn().mockResolvedValue({ ...ARENA_SETTINGS }), updateMany: vi.fn() },
        player: {
          findMany: vi.fn().mockResolvedValue(PLAYER_ROWS),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn(),
          findFirst: vi.fn(),
          aggregate: vi.fn().mockResolvedValue({ _max: { queueOrder: 5 } }),
          create: vi.fn(),
        },
        court: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        courtSlot: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
        partnership: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), updateMany: vi.fn() },
        match: { create: vi.fn() },
        ...overrides,
      });

      it('rejects a malformed envelope without opening a transaction', async () => {
        for (const bad of [
          { batchId: 'x' }, // too short
          { mode: 'yolo' },
          { events: 'nope' },
          { settings: { targetScore: 'eleven' } },
        ]) {
          const result = await actions.syncOfflineEvents(ARENA, batchInput(bad));
          expect(result.error).toMatch(/invalid sync batch/i);
        }
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('returns alreadySynced for a retried batch and applies nothing', async () => {
        const tx = makeTx({
          offlineSyncBatch: {
            findUnique: vi.fn().mockResolvedValue({ id: 'batch-0001-abcd', appliedEventIds: ['e1'], skippedCount: 0 }),
            create: vi.fn(),
          },
        });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(ARENA, batchInput({ events: [{ id: 'e1', type: 'checkOut', payload: { playerId: 'a' } }] }));
        expect(result.alreadySynced).toBe(true);
        expect(result.appliedIds).toEqual(['e1']);
        expect(tx.offlineSyncBatch.create).not.toHaveBeenCalled();
        expect(tx.player.updateMany).not.toHaveBeenCalled();
      });

      it('strict mode: fingerprint mismatch returns divergence with ZERO writes', async () => {
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({
            base: { fetchedAt: 1, fingerprint: 'deadbeef' },
            events: [{ id: 'e1', type: 'checkOut', payload: { playerId: 'a' } }],
          }),
        );
        expect(result.divergence).toBe(true);
        expect(result.appliedIds).toBeUndefined();
        expect(tx.player.updateMany).not.toHaveBeenCalled();
        expect(tx.offlineSyncBatch.create).not.toHaveBeenCalled();
      });

      it('strict mode: reads every hashed rule, including the pairing mode', async () => {
        // Direct guard on the `arena.findUnique` SELECT. It has to be asserted
        // explicitly: the Prisma mock returns its canned row regardless of the
        // select, so no behavioural test can notice a dropped field. If one is
        // dropped, the server fingerprints that rule from `undefined` while the
        // device used its real value, and strict sync reports a phantom
        // divergence for every arena that set it.
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));
        await actions.syncOfflineEvents(ARENA, batchInput());

        const [{ select }] = tx.arena.findUnique.mock.calls[0];
        expect(select).toEqual({
          targetScore: true,
          starveThreshold: true,
          emergencyWait: true,
          skipRestoresPriority: true,
          skipPickReplacement: true,
          balancedPairing: true,
          splitDeckByResult: true,
        });
      });

      it('strict mode: a legacy-pairing arena syncs clean when the device agrees', async () => {
        const legacy = { ...ARENA_SETTINGS, balancedPairing: false };
        const tx = makeTx({
          arena: { findUnique: vi.fn().mockResolvedValue(legacy), updateMany: vi.fn() },
        });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({
            base: {
              fetchedAt: 1,
              fingerprint: boardFingerprint(
                { players: PLAYER_ROWS, queue: ['a', 'b', 'c', 'd', 'e'], courts: [], history: {} },
                legacy,
              ),
            },
            events: [{ id: 'e1', type: 'checkOut', payload: { playerId: 'e' } }],
          }),
        );
        expect(result.divergence).toBeUndefined();
        expect(result.appliedIds).toEqual(['e1']);
      });

      it('strict mode: matching fingerprint applies events in order and records the batch', async () => {
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({ events: [{ id: 'e1', type: 'checkOut', payload: { playerId: 'e' } }] }),
        );
        expect(result.error).toBeUndefined();
        expect(result.divergence).toBeUndefined();
        expect(result.appliedIds).toEqual(['e1']);
        expect(result.skipped).toEqual([]);
        // The checkOut applied through the shared board-apply path.
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: 'e', arenaId: ARENA, leftAt: null, queueOrder: { not: null } },
          data: { queueOrder: null, waitRounds: 0, skipBoosted: false, draftedDeck: null, draftedLocked: false },
        });
        expect(tx.offlineSyncBatch.create).toHaveBeenCalledWith({
          data: {
            id: 'batch-0001-abcd',
            arenaId: ARENA,
            deviceLabel: null,
            appliedEventIds: ['e1'],
            skippedCount: 0,
          },
        });
      });

      it('strict mode: one failing event rolls the whole batch back as divergence', async () => {
        // fillCourt fails its vacant->playing claim (court taken concurrently).
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({
            events: [
              { id: 'e1', type: 'fillCourt', payload: { courtId: 'c1' }, outcome: { players: ['a', 'b', 'c', 'd'], team1: ['a', 'b'], team2: ['c', 'd'] } },
            ],
          }),
        );
        expect(result.divergence).toBe(true);
        expect(tx.offlineSyncBatch.create).not.toHaveBeenCalled();
      });

      it('best-effort mode: skips the failing event, applies the rest, reports both', async () => {
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({
            mode: 'best-effort',
            events: [
              { id: 'e1', type: 'fillCourt', payload: { courtId: 'c1' }, outcome: { players: ['a', 'b', 'c', 'd'], team1: ['a', 'b'], team2: ['c', 'd'] } },
              { id: 'e2', type: 'checkOut', payload: { playerId: 'e' } },
            ],
          }),
        );
        expect(result.appliedIds).toEqual(['e2']);
        expect(result.skipped).toEqual([{ id: 'e1', type: 'fillCourt', reason: 'COURT_UNAVAILABLE' }]);
        expect(tx.offlineSyncBatch.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ appliedEventIds: ['e2'], skippedCount: 1 }),
        });
      });

      it('rejects an addPlayer event whose id is not a client off_ uuid', async () => {
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({
            mode: 'best-effort',
            events: [
              { id: 'e1', type: 'addPlayer', payload: { playerId: 'evil-cuid-like', firstName: 'Mallory' } },
              { id: 'e2', type: 'addPlayer', payload: { playerId: 'off_1b671a64-40d5-491e-99b0-da01ff1f3341', firstName: 'Ana' } },
            ],
          }),
        );
        expect(result.skipped).toEqual([{ id: 'e1', type: 'addPlayer', reason: 'BAD_EVENT' }]);
        expect(result.appliedIds).toEqual(['e2']);
        expect(tx.player.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ id: 'off_1b671a64-40d5-491e-99b0-da01ff1f3341', firstName: 'Ana' }),
        });
      });

      it('rejects a checkOut event with no playerId instead of clearing the whole rack', async () => {
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({
            mode: 'best-effort',
            // A corrupted/crafted event with an empty payload: Prisma would
            // drop the undefined `id` filter and updateMany would clear every
            // queued player. It must be skipped as BAD_EVENT, never applied.
            events: [
              { id: 'e1', type: 'checkOut', payload: {} },
              { id: 'e2', type: 'checkOut', payload: { playerId: 'e' } },
            ],
          }),
        );
        expect(result.skipped).toEqual([{ id: 'e1', type: 'checkOut', reason: 'BAD_EVENT' }]);
        expect(result.appliedIds).toEqual(['e2']);
        // Only the valid, id-scoped checkOut reached the database.
        expect(tx.player.updateMany).toHaveBeenCalledTimes(1);
        expect(tx.player.updateMany).toHaveBeenCalledWith({
          where: { id: 'e', arenaId: ARENA, leftAt: null, queueOrder: { not: null } },
          data: { queueOrder: null, waitRounds: 0, skipBoosted: false, draftedDeck: null, draftedLocked: false },
        });
      });

      it('best-effort mode: a structurally malformed event is skipped, later valid events still apply', async () => {
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({
            mode: 'best-effort',
            events: [
              { id: 'e1' }, // missing type: structural BAD_EVENT
              { id: 'e2', type: 'checkOut', payload: { playerId: 'e' } },
            ],
          }),
        );
        expect(result.divergence).toBeUndefined();
        expect(result.skipped).toEqual([{ id: 'e1', type: undefined, reason: 'BAD_EVENT' }]);
        expect(result.appliedIds).toEqual(['e2']);
        expect(tx.offlineSyncBatch.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ appliedEventIds: ['e2'], skippedCount: 1 }),
        });
      });

      it('releases the advisory offline hold in the same transaction, scoped to its owner', async () => {
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1', firstName: 'Chris', lastName: 'Diomampo' },
          arena: { id: ARENA, ownerId: 'u1' },
          role: ROLES.OWNER,
        });
        const tx = makeTx({
          arena: {
            findUnique: vi.fn().mockResolvedValue({ ...ARENA_SETTINGS }),
            updateMany: vi.fn(),
          },
        });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.syncOfflineEvents(
          ARENA,
          batchInput({ events: [{ id: 'e1', type: 'checkOut', payload: { playerId: 'e' } }] }),
        );
        // Scoped by label: a second manager who declared a hold after this
        // session started must keep their notice while they're still offline.
        expect(tx.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA, offlineHolderLabel: 'Chris D.' },
          data: { offlineHolderLabel: null, offlineHeldAt: null },
        });
      });

      it('clamps a future endMatch occurredAt to sync time for Match.createdAt', async () => {
        const slots = [
          { playerId: 'a', team: 1, player: { firstName: 'A', lastName: null, rating: 1000 } },
          { playerId: 'b', team: 1, player: { firstName: 'B', lastName: null, rating: 1000 } },
          { playerId: 'c', team: 2, player: { firstName: 'C', lastName: null, rating: 1000 } },
          { playerId: 'd', team: 2, player: { firstName: 'D', lastName: null, rating: 1000 } },
        ];
        const tx = makeTx({
          court: {
            findMany: vi.fn().mockResolvedValue([]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }), // claim succeeds
            findUnique: vi.fn().mockResolvedValue({ id: 'c1', name: 'Court 1' }),
            update: vi.fn(),
          },
          courtSlot: { findMany: vi.fn().mockResolvedValue(slots), findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
        });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const before = Date.now();
        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({
            mode: 'best-effort',
            events: [
              {
                id: 'e1',
                type: 'endMatch',
                occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // future clock
                payload: { courtId: 'c1', score1: '11', score2: '7', autoMix: false },
                outcome: { recycleOrder: ['d', 'a', 'c', 'b'], mixedOrder: null },
              },
            ],
          }),
        );
        expect(result.appliedIds).toEqual(['e1']);
        const created = tx.match.create.mock.calls[0][0].data;
        expect(created.createdAt).toBeInstanceOf(Date);
        expect(created.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(created.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
        expect(created.score1).toBe(11);
        expect(created.score2).toBe(7);
        // Provenance comes from the BATCH's settings snapshot, i.e. the target
        // this scoreline was validated against offline — not whatever the
        // arena is set to at sync time.
        expect(created.targetScore).toBe(11);
        expect(created.ratingDelta).toBeGreaterThan(0); // team 1 won 11-7
      });

      it('gives each synced match a distinct createdAt even when the clock is ahead', async () => {
        // A device running fast clamps EVERY event to the same `now`. Equal
        // timestamps leave `ORDER BY createdAt DESC` free to return the tied
        // matches in any order, and `recentResults` takes the first result it
        // sees per player — so the balanced split could classify someone by an
        // older game. Strictly increasing stamps remove the tie at the source.
        const slots = [
          { playerId: 'a', team: 1, player: { firstName: 'A', lastName: null, rating: 1000 } },
          { playerId: 'b', team: 1, player: { firstName: 'B', lastName: null, rating: 1000 } },
          { playerId: 'c', team: 2, player: { firstName: 'C', lastName: null, rating: 1000 } },
          { playerId: 'd', team: 2, player: { firstName: 'D', lastName: null, rating: 1000 } },
        ];
        const tx = makeTx({
          court: {
            findMany: vi.fn().mockResolvedValue([]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUnique: vi.fn().mockResolvedValue({ id: 'c1', name: 'Court 1' }),
            update: vi.fn(),
          },
          courtSlot: { findMany: vi.fn().mockResolvedValue(slots), findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
        });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const endMatch = (id) => ({
          id,
          type: 'endMatch',
          occurredAt: ahead, // identical, future-dated: all clamp to `now`
          payload: { courtId: 'c1', score1: '11', score2: '7', autoMix: false },
          outcome: { recycleOrder: ['d', 'a', 'c', 'b'], mixedOrder: null },
        });

        const result = await actions.syncOfflineEvents(
          ARENA,
          batchInput({ mode: 'best-effort', events: [endMatch('e1'), endMatch('e2'), endMatch('e3')] }),
        );

        expect(result.appliedIds).toEqual(['e1', 'e2', 'e3']);
        const stamps = tx.match.create.mock.calls.map((c) => c[0].data.createdAt.getTime());
        expect(stamps).toHaveLength(3);
        // Strictly increasing, in the order the manager played them.
        expect(stamps[1]).toBeGreaterThan(stamps[0]);
        expect(stamps[2]).toBeGreaterThan(stamps[1]);
      });
    });

    describe('offline hold', () => {
      it('declareOfflineHold() stamps the label from the authenticated account', async () => {
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1', firstName: 'Chris', lastName: 'Diomampo' },
          arena: { id: ARENA, ownerId: 'u1' },
          role: ROLES.OWNER,
        });
        prisma.arena.updateMany.mockResolvedValue({ count: 1 });

        const result = await actions.declareOfflineHold(ARENA);
        expect(result.error).toBeUndefined();
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { offlineHolderLabel: 'Chris D.', offlineHeldAt: expect.any(Date) },
        });
      });

      it('declareOfflineHold() falls back to the core name field', async () => {
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1', name: 'Solo Organizer' },
          arena: { id: ARENA, ownerId: 'u1' },
          role: ROLES.OWNER,
        });
        prisma.arena.updateMany.mockResolvedValue({ count: 1 });

        await actions.declareOfflineHold(ARENA);
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { offlineHolderLabel: 'Solo', offlineHeldAt: expect.any(Date) },
        });
      });

      it('releaseOfflineHold() clears both columns, but only its own hold', async () => {
        requireArenaManager.mockResolvedValue({
          user: { id: 'u1', firstName: 'Chris', lastName: 'Diomampo' },
          arena: { id: ARENA, ownerId: 'u1' },
          role: ROLES.OWNER,
        });
        prisma.arena.updateMany.mockResolvedValue({ count: 1 });

        const result = await actions.releaseOfflineHold(ARENA);
        expect(result.error).toBeUndefined();
        // Label-scoped so one manager's exit can't clear another's active
        // hold (last-writer-wins means the displayed holder may be someone else).
        expect(prisma.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA, offlineHolderLabel: 'Chris D.' },
          data: { offlineHolderLabel: null, offlineHeldAt: null },
        });
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
          data: { queueOrder: null, waitRounds: 0, skipBoosted: false, draftedDeck: null, draftedLocked: false },
        });
        // Reset stamped via updateMany (count-guarded) so a concurrent delete
        // is a clean error, not an uncaught P2025.
        expect(tx.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          // The deck alternation resets with the session boundary: the new
          // session's fills classify off matches after it, so a pointer from
          // last week's games must not carry over.
          data: { lastSessionResetAt: expect.any(Date), lastDeckFilled: null },
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
        expect(data).toEqual({
          queueOrder: null,
          waitRounds: 0,
          skipBoosted: false,
          draftedDeck: null,
          draftedLocked: false,
        });
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
          data: { queueOrder: null, waitRounds: 0, skipBoosted: false, draftedDeck: null, draftedLocked: false },
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
        // The reset also clears the win/lose deck alternation, which points at
        // matches it just deleted.
        arena: { updateMany: vi.fn() },
        player: {
          findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.resetArena(ARENA);
      expect(tx.arena.updateMany).toHaveBeenCalledWith({
        where: { id: ARENA },
        data: { lastDeckFilled: null },
      });
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

    it('endMatch() records the match provenance the correction path needs', async () => {
      // `ratingDelta` is team 1's swing; zero-sum and shared by teammates, so
      // it is the whole rating effect of this match in one integer. Asserted
      // against the ratings actually written, not a hard-coded K, so the two
      // can't drift apart. `targetScore` pins the rules the game was played
      // under, since the arena's target can change afterwards.
      const slot = (playerId, team) => ({
        playerId,
        team,
        player: { id: playerId, firstName: playerId, lastName: null, rating: 1000 },
      });
      const tx = {
        $executeRaw: vi.fn(),
        court: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
      prisma.court.findMany.mockResolvedValue([]);
      prisma.player.count.mockResolvedValue(0);
      requireArenaManager.mockResolvedValue({
        user: { id: 'u1' },
        arena: { id: ARENA, ownerId: 'u1', targetScore: 15 },
        role: ROLES.OWNER,
      });

      await actions.endMatch(ARENA, 'c1', 15, 5, false);

      const { data } = tx.match.create.mock.calls[0][0];
      const ratingFor = (id) =>
        tx.player.update.mock.calls.find((c) => c[0].where.id === id && 'rating' in c[0].data)[0]
          .data.rating;
      expect(data.ratingDelta).toBe(ratingFor('w1') - 1000);
      expect(data.ratingDelta).toBe(1000 - ratingFor('l1')); // zero-sum
      expect(data.ratingDelta).toBeGreaterThan(0); // team 1 won
      // The target the score was validated against, not the default.
      expect(data.targetScore).toBe(15);
      expect(data.editedAt).toBeUndefined(); // a fresh match is not an edit
    });

    it('endMatch() records no delta when the court is not two-a-side', async () => {
      // Malformed court: the Elo guard skips, so there is nothing to reverse
      // later and the column stays null ("unknown") rather than 0 ("no swing").
      const slot = (playerId, team) => ({
        playerId,
        team,
        player: { id: playerId, firstName: playerId, lastName: null, rating: 1000 },
      });
      const tx = {
        $executeRaw: vi.fn(),
        court: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ id: 'c1', name: 'Court 1' }),
        },
        courtSlot: {
          findMany: vi.fn().mockResolvedValue([slot('w1', 1), slot('l1', 2), slot('l2', 2)]),
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
      prisma.court.findMany.mockResolvedValue([]);
      prisma.player.count.mockResolvedValue(0);

      await actions.endMatch(ARENA, 'c1', 11, 5, false);

      expect(tx.match.create.mock.calls[0][0].data.ratingDelta).toBeNull();
    });

    // The finish and the auto-mix share one transaction so viewers never see
    // the recycled-but-unmixed rack (a manager stacking against that frame gets
    // a different four than the rack showed). These two pin both halves of that
    // arrangement: one commit, and a mix failure that still saves the match.
    const finishTxMock = ({ queuedCount = 5, arena = { starveThreshold: 2, emergencyWait: 4, skipRestoresPriority: true } } = {}) => {
      const slot = (playerId, team) => ({
        playerId,
        team,
        player: { id: playerId, firstName: playerId, lastName: null, rating: 1000 },
      });
      return {
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
          count: vi.fn().mockResolvedValue(queuedCount),
          findMany: vi.fn().mockResolvedValue([
            { id: 'q1', gamesPlayed: 0, gamesOffset: 0, waitRounds: 3, skipBoosted: false },
            { id: 'q2', gamesPlayed: 4, gamesOffset: 0, waitRounds: 0, skipBoosted: false },
          ]),
          updateMany: vi.fn(),
          update: vi.fn(),
        },
        match: { create: vi.fn() },
        arena: { findUnique: vi.fn().mockResolvedValue(arena) },
      };
    };

    it('endMatch() mixes the rack in the SAME transaction as the finish', async () => {
      const tx = finishTxMock();
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));
      prisma.court.findMany.mockResolvedValue([]);

      const result = await actions.endMatch(ARENA, 'c1', 11, 5, true);

      // One commit: two would publish an intermediate board over the realtime
      // NOTIFY that a fill could then race against.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // The mix renumbered the rack inside that same transaction — longest
      // waiting (q1, protected band) ahead of the fresher q2.
      expect(tx.player.update).toHaveBeenCalledWith({ where: { id: 'q1' }, data: { queueOrder: 1 } });
      expect(tx.player.update).toHaveBeenCalledWith({ where: { id: 'q2' }, data: { queueOrder: 2 } });
      expect(result.notification).toMatch(/Silo-Buster/);
    });

    it('endMatch() lets any other mix failure roll the finish back', async () => {
      // The other half of the single-commit trade-off. ARENA_GONE is swallowed
      // (below) because it throws off a null read with the transaction still
      // healthy; a real infrastructure failure must NOT be, or the mix would be
      // skipped silently and the rack left in the recycled-but-unmixed order
      // this PR exists to stop anyone from seeing.
      //
      // Injected on `player.findMany`, which ONLY `applyAutoMixTx` calls in this
      // path — failing `player.updateMany` instead would abort inside
      // `applyEndMatchTx` (the wins/losses increments run first) and the test
      // would pass without the mix ever being reached.
      const tx = finishTxMock();
      tx.player.findMany.mockRejectedValue(new Error('P1001'));
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));
      prisma.court.findMany.mockResolvedValue([]);

      await expect(actions.endMatch(ARENA, 'c1', 11, 5, true)).rejects.toThrow('P1001');
      // It got past the finish and into the mix — the failure is the mix's.
      expect(tx.match.create).toHaveBeenCalled();
      expect(tx.arena.findUnique).toHaveBeenCalled();
      // What protects the match is the rejection escaping the transaction
      // callback (Prisma then rolls back); the writes issued against this mock
      // before the throw are exactly what the real rollback discards, so
      // asserting they never happened would be asserting the wrong thing.
    });

    it('endMatch() degrades gracefully when the arena vanishes during auto-mix', async () => {
      // The arena row is gone by the time the mix reads it. That throws off a
      // null read rather than a failed statement, so the transaction is still
      // healthy and the finish must still commit.
      const tx = finishTxMock({ arena: null });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));
      prisma.court.findMany.mockResolvedValue([]);

      const result = await actions.endMatch(ARENA, 'c1', 11, 5, true);

      // Match recorded; mix bailed cleanly with no notification.
      expect(result.error).toBeUndefined();
      expect(result.state).toBeDefined();
      expect(result.notification).toBe('');
      expect(tx.match.create).toHaveBeenCalled();
      expect(tx.arena.findUnique).toHaveBeenCalled();
      // The mix reads the queued set only after the arena row resolves, so a
      // missing arena means it never got as far as reordering anyone. (The
      // finish's own recycle writes queueOrder, so asserting on those writes
      // would not distinguish the two.)
      expect(tx.player.findMany).not.toHaveBeenCalled();
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
    // Win/lose decks: `winners` names the racked ids whose last game was a win;
    // everyone else is a loser. Off by default, so the classic single-bucket
    // rack (and every test above) is unchanged.
    splitDeckByResult = false,
    winners = [],
  } = {}) => ({
    $executeRaw: vi.fn(),
    arena: {
      findUnique: vi.fn().mockResolvedValue({
        skipRestoresPriority,
        skipPickReplacement,
        splitDeckByResult,
        lastSessionResetAt: null,
      }),
    },
    match: {
      findMany: vi.fn().mockResolvedValue(
        winners.length === 0
          ? []
          : [
              {
                score1: 11,
                score2: 6,
                players: [
                  ...winners.map((playerId) => ({ playerId, team: 1 })),
                  ...rackIds
                    .filter((id) => !winners.includes(id))
                    .map((playerId) => ({ playerId, team: 2 })),
                ],
              },
            ],
      ),
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

  it('deck mode: promotes the next paddle from the SAME deck, leaving the other deck alone', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    // Rack: w1 l1 w2 l2 w3 l3 w4 l4 w5 — winners at odd positions, losers at
    // even. w1 is on the winners deck; skipping them must pull w5 (the fifth
    // winner) into the freed winners slot and leave every loser untouched.
    const rack = ['w1', 'l1', 'w2', 'l2', 'w3', 'l3', 'w4', 'l4', 'w5'];
    const tx = txWithRack(rack, {
      splitDeckByResult: true,
      winners: ['w1', 'w2', 'w3', 'w4', 'w5'],
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.skipPlayer(ARENA, 'w1');

    expect(result.notification).toBe('Marked Next in Line — top priority on the next mix.');
    const updates = tx.player.update.mock.calls.map((c) => c[0]);
    // The winners' rack slots (1,3,5,7,9) are rewritten with the new deck
    // order w2,w3,w4,w5,w1; the losers' slots (2,4,6,8) are never touched.
    expect(updates).toContainEqual({ where: { id: 'w2' }, data: { queueOrder: 1 } });
    expect(updates).toContainEqual({ where: { id: 'w3' }, data: { queueOrder: 3 } });
    expect(updates).toContainEqual({ where: { id: 'w4' }, data: { queueOrder: 5 } });
    expect(updates).toContainEqual({ where: { id: 'w5' }, data: { queueOrder: 7 } });
    expect(updates).toContainEqual({ where: { id: 'w1' }, data: { queueOrder: 9 } });
    expect(updates).toContainEqual({ where: { id: 'w1' }, data: { skipBoosted: true } });
    for (const loser of ['l1', 'l2', 'l3', 'l4']) {
      expect(updates).not.toContainEqual(expect.objectContaining({ where: { id: loser } }));
    }
  });

  it('deck mode: refuses when nobody is waiting behind that deck', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-me' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-me' });
    // Nine racked, so the rack as a whole has depth — but the winners deck is
    // exactly four, so there is no same-deck paddle to take the freed slot.
    const rack = ['w1', 'l1', 'w2', 'l2', 'w3', 'l3', 'w4', 'l4', 'l5'];
    const tx = txWithRack(rack, {
      splitDeckByResult: true,
      winners: ['w1', 'w2', 'w3', 'w4'],
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    const result = await actions.skipPlayer(ARENA, 'w1');

    expect(result.notification).toBe('');
    expect(tx.player.update).not.toHaveBeenCalled();
  });

  it('deck mode: rejects a manager pick from the other deck', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u-mgr' });
    prisma.player.findFirst.mockResolvedValue({ userId: 'u-other' });
    requireArenaManager.mockResolvedValue({ user: { id: 'u-mgr' }, arena: { id: ARENA }, role: ROLES.OWNER });
    const rack = ['w1', 'l1', 'w2', 'l2', 'w3', 'l3', 'w4', 'l4', 'w5'];
    const tx = txWithRack(rack, {
      splitDeckByResult: true,
      winners: ['w1', 'w2', 'w3', 'w4', 'w5'],
    });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    // l5 doesn't exist; l4 does, but it's in the losers deck — not a candidate
    // for a winners-deck slot, so the pick is refused rather than silently
    // auto-filling with someone the manager didn't choose.
    const result = await actions.skipPlayer(ARENA, 'w1', 'l4');

    expect(result.error).toBe('That replacement is no longer available. Pick again.');
    expect(tx.player.update).not.toHaveBeenCalled();
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
    { id: 'p1', queueOrder: 1, waitRounds: 0, rating: 1000 },
    { id: 'p2', queueOrder: 2, waitRounds: 0, rating: 1000 },
    { id: 'p3', queueOrder: 3, waitRounds: 0, rating: 1000 },
    { id: 'p4', queueOrder: 4, waitRounds: 0, rating: 1000 },
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
      // The fill reads the arena's pairing mode and session boundary before
      // splitting the four.
      arena: {
        findUnique: vi.fn().mockResolvedValue({
          balancedPairing: true,
          lastSessionResetAt: null,
          splitDeckByResult: false,
          lastDeckFilled: null,
        }),
        // Only written in deck mode (advancing the W/L alternation).
        updateMany: vi.fn(),
      },
      // Recent matches feed the losers-partner-winners team split; an empty
      // history means nobody has a recent result, so the split falls through
      // to the rating/partnership tie-breaks.
      match: {
        findMany: vi.fn().mockResolvedValue([]),
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

  it('scopes the recent-results query to the current session', async () => {
    // `prepareNextSession` keeps Match rows but wipes Partnership so the split
    // starts unbiased by last week; the other input to that same split has to
    // honour the boundary too, or tonight's first fills classify players by a
    // result from a previous session. The offline engine filters the same
    // boundary (board-engine.test.js) — match history isn't fingerprinted, so
    // the two paths can only be kept in step by asserting both.
    const resetAt = new Date('2026-07-27T00:00:00.000Z');
    const tx = makeTx();
    tx.arena.findUnique.mockResolvedValue({ balancedPairing: true, lastSessionResetAt: resetAt });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.fillCourt(ARENA, COURT);

    expect(tx.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { arenaId: ARENA, createdAt: { gte: resetAt } } }),
    );
  });

  it('queries every match when the arena has never been reset', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.fillCourt(ARENA, COURT);

    expect(tx.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { arenaId: ARENA } }),
    );
  });

  it('breaks recent-match ties by id, exactly as getState does', async () => {
    // `recentResults` keeps each player's FIRST hit walking newest-first, so
    // two rows sharing a `createdAt` (possible for matches synced from an older
    // offline batch — see the same tie-break in `getState`) must not be ordered
    // differently here. The client derives its decks from getState's array and
    // the offline engine reads that same array, so this query is the only one
    // of the three that could drift — and a drift puts a player in a different
    // deck, rejecting the client's `expected` four.
    const tx = makeTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.fillCourt(ARENA, COURT);

    expect(tx.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    );
  });

  // The on-deck guard. A fill used to name no players at all — it took
  // whatever reached the front of the rack by the time the transaction ran, so
  // any reorder between the manager's last repaint and their tap (an auto-mix
  // on a finish, a sub-out jumping to #1, another manager's fill) stacked four
  // players the manager never saw, and reported success.
  describe('on-deck guard', () => {
    const ON_DECK = ['p1', 'p2', 'p3', 'p4'];

    it('stacks the four when the rack still starts with them', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.fillCourt(ARENA, COURT, ON_DECK);

      expect(result.error).toBeUndefined();
      expect(tx.courtSlot.createMany).toHaveBeenCalled();
    });

    it('accepts the four in any order — the team split is decided server-side', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.fillCourt(ARENA, COURT, ['p4', 'p2', 'p1', 'p3']);

      expect(result.error).toBeUndefined();
      expect(tx.courtSlot.createMany).toHaveBeenCalled();
    });

    it('refuses — and stacks nobody — when the rack reordered under the manager', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      // p4 was mixed away and p9 took the last on-deck slot after this
      // manager's screen was painted.
      const result = await actions.fillCourt(ARENA, COURT, ['p1', 'p2', 'p3', 'p9']);

      expect(result.error).toBe('The court or queue changed while loading. Please try again.');
      // Refused before any write: no dequeue, no slots. (The court claim rolls
      // back with the transaction.)
      expect(tx.player.updateMany).not.toHaveBeenCalled();
      expect(tx.courtSlot.createMany).not.toHaveBeenCalled();
      // Fresh rack comes back so the manager can re-tap against the truth.
      expect(result.state).toBeDefined();
    });

    it('falls back to the old behavior when no on-deck four is sent', async () => {
      // A client running cached JS from an earlier deploy (installable PWA)
      // omits the argument; it must still be able to stack a court.
      const tx = makeTx();
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.fillCourt(ARENA, COURT);

      expect(result.error).toBeUndefined();
      expect(tx.courtSlot.createMany).toHaveBeenCalled();
    });

    it.each([
      ['a short list', ['p1', 'p2', 'p3']],
      ['a non-array', 'p1,p2,p3,p4'],
      ['non-string ids', ['p1', 'p2', 'p3', 42]],
      ['blank ids', ['p1', 'p2', 'p3', '']],
    ])('ignores a malformed on-deck list (%s) rather than refusing the fill', async (_label, expected) => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.fillCourt(ARENA, COURT, expected);

      expect(result.error).toBeUndefined();
      expect(tx.courtSlot.createMany).toHaveBeenCalled();
    });
  });

  // Win/lose decks: the four are the front of a deck rather than the front of
  // the rack, so `fillCourt` no longer stacks a prefix of the queue.
  describe('win/lose decks', () => {
    // Eight racked paddles. w1-w4 won their last game, l1-l4 lost theirs, and
    // the rack interleaves them so a deck fill is provably NOT a prefix.
    const RACK = [
      { id: 'w1', queueOrder: 1, waitRounds: 0, rating: 1000 },
      { id: 'l1', queueOrder: 2, waitRounds: 0, rating: 1000 },
      { id: 'w2', queueOrder: 3, waitRounds: 0, rating: 1000 },
      { id: 'l2', queueOrder: 4, waitRounds: 0, rating: 1000 },
      { id: 'w3', queueOrder: 5, waitRounds: 0, rating: 1000 },
      { id: 'l3', queueOrder: 6, waitRounds: 0, rating: 1000 },
      { id: 'w4', queueOrder: 7, waitRounds: 0, rating: 1000 },
      { id: 'l4', queueOrder: 8, waitRounds: 0, rating: 1000 },
    ];
    const WINNERS = ['w1', 'w2', 'w3', 'w4'];
    const LOSERS = ['l1', 'l2', 'l3', 'l4'];
    const MATCHES = [
      {
        score1: 11,
        score2: 6,
        players: [
          ...WINNERS.map((playerId) => ({ playerId, team: 1 })),
          ...LOSERS.map((playerId) => ({ playerId, team: 2 })),
        ],
      },
    ];

    function makeDeckTx({ lastDeckFilled = null, rack = RACK, matches = MATCHES } = {}) {
      const tx = makeTx();
      tx.arena.findUnique.mockResolvedValue({
        balancedPairing: true,
        lastSessionResetAt: null,
        splitDeckByResult: true,
        lastDeckFilled,
      });
      tx.player.findMany = vi
        .fn()
        .mockResolvedValueOnce(rack)
        // The bumped set: whoever is still racked after the four are dequeued.
        .mockResolvedValueOnce([]);
      tx.match.findMany.mockResolvedValue(matches);
      return tx;
    }

    /** The four ids the fill actually dequeued. */
    const stacked = (tx) => tx.player.updateMany.mock.calls[0][0].where.id.in;

    it('stacks the winners deck, not the top of the rack', async () => {
      const tx = makeDeckTx({ lastDeckFilled: 'L' });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      const result = await actions.fillCourt(ARENA, COURT, WINNERS);

      expect(result.error).toBeUndefined();
      expect(stacked(tx)).toEqual(WINNERS);
      expect(tx.arena.updateMany).toHaveBeenCalledWith({
        where: { id: ARENA },
        data: { lastDeckFilled: 'W' },
      });
    });

    it('alternates to the losers deck when the winners went last', async () => {
      const tx = makeDeckTx({ lastDeckFilled: 'W' });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.fillCourt(ARENA, COURT, LOSERS);

      expect(stacked(tx)).toEqual(LOSERS);
      expect(tx.arena.updateMany).toHaveBeenCalledWith({
        where: { id: ARENA },
        data: { lastDeckFilled: 'L' },
      });
    });

    it('snapshots each player\'s real rack position, not their deck position', async () => {
      // cancelFill restores from these, so a losers-deck fill has to record
      // queueOrder 2/4/6/8 — not 1/2/3/4.
      const tx = makeDeckTx({ lastDeckFilled: 'W' });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.fillCourt(ARENA, COURT, LOSERS);

      const [{ data }] = tx.courtSlot.createMany.mock.calls[0];
      expect(data.map((s) => s.prevQueueOrder).sort((x, y) => x - y)).toEqual([2, 4, 6, 8]);
    });

    it('records the pre-fill pointer on the court so cancelFill can rewind it', async () => {
      const tx = makeDeckTx({ lastDeckFilled: 'W' });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.fillCourt(ARENA, COURT, LOSERS);

      expect(tx.court.update).toHaveBeenCalledWith({
        where: { id: COURT },
        data: expect.objectContaining({ fillPrevDeck: 'W' }),
      });
    });

    it('refuses when the manager was looking at the other deck', async () => {
      const tx = makeDeckTx({ lastDeckFilled: 'L' });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      // The alternation reached the winners, but this manager's screen still
      // showed the losers as up next.
      const result = await actions.fillCourt(ARENA, COURT, LOSERS);

      expect(result.error).toBe('The court or queue changed while loading. Please try again.');
      expect(tx.player.updateMany).not.toHaveBeenCalled();
      expect(tx.courtSlot.createMany).not.toHaveBeenCalled();
    });

    it('falls back to the classic top four when neither deck is full', async () => {
      // Six racked, three winners / three losers: no deck can stack.
      const short = RACK.slice(0, 6);
      const tx = makeDeckTx({
        lastDeckFilled: 'L',
        rack: short,
        matches: [
          {
            score1: 11,
            score2: 6,
            players: [
              ...['w1', 'w2', 'w3'].map((playerId) => ({ playerId, team: 1 })),
              ...['l1', 'l2', 'l3'].map((playerId) => ({ playerId, team: 2 })),
            ],
          },
        ],
      });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.fillCourt(ARENA, COURT);

      expect(stacked(tx)).toEqual(['w1', 'l1', 'w2', 'l2']);
      // A mixed fill credits neither deck with a turn.
      expect(tx.arena.updateMany).toHaveBeenCalledWith({
        where: { id: ARENA },
        data: { lastDeckFilled: null },
      });
    });

    it('leaves the pointer untouched when the mode is off', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await actions.fillCourt(ARENA, COURT);

      expect(tx.arena.updateMany).not.toHaveBeenCalled();
    });

    it('skips the recent-match query when replaying a recorded outcome', async () => {
      // A sync batch replays many fills inside ONE transaction holding the
      // queue lock; a recorded outcome already names the four AND the split, so
      // querying for results per event is pure lock-hold cost.
      const tx = makeDeckTx({ lastDeckFilled: 'L' });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await applyFillCourtTx(tx, ARENA, {
        courtId: COURT,
        outcome: {
          players: WINNERS,
          team1: ['w1', 'w2'],
          team2: ['w3', 'w4'],
          deck: 'W',
        },
      });

      expect(tx.match.findMany).not.toHaveBeenCalled();
      expect(stacked(tx)).toEqual(WINNERS);
    });

    it('refuses a recorded outcome whose deck is outside W/L/null', async () => {
      // The recorded deck is written straight into `lastDeckFilled`, which
      // drives `nextDeck` and the sync fingerprint.
      const tx = makeDeckTx({ lastDeckFilled: 'L' });
      prisma.$transaction.mockImplementation(async (cb) => cb(tx));

      await expect(
        applyFillCourtTx(tx, ARENA, {
          courtId: COURT,
          outcome: {
            players: WINNERS,
            team1: ['w1', 'w2'],
            team2: ['w3', 'w4'],
            deck: 'X',
          },
        }),
      ).rejects.toThrow('OUTCOME_MISMATCH');
      expect(tx.courtSlot.createMany).not.toHaveBeenCalled();
    });

    // Hand-topping a short deck: the organizer fills the empty slots from the
    // rack and stacks that four themselves.
    describe('a hand-assembled four', () => {
      // Only two recent winners, so the winners deck can't stack on its own.
      const SHORT = [
        { id: 'w1', queueOrder: 1, waitRounds: 0, rating: 1000 },
        { id: 'l1', queueOrder: 2, waitRounds: 0, rating: 1000 },
        { id: 'w2', queueOrder: 3, waitRounds: 0, rating: 1000 },
        { id: 'l2', queueOrder: 4, waitRounds: 0, rating: 1000 },
        { id: 'l3', queueOrder: 5, waitRounds: 0, rating: 1000 },
        { id: 'l4', queueOrder: 6, waitRounds: 0, rating: 1000 },
      ];
      const SHORT_MATCHES = [
        {
          score1: 11,
          score2: 6,
          players: [
            { playerId: 'w1', team: 1 },
            { playerId: 'w2', team: 1 },
            { playerId: 'l1', team: 2 },
            { playerId: 'l2', team: 2 },
          ],
        },
      ];
      const HAND_PICKED = ['w1', 'w2', 'l3', 'l4'];

      const shortTx = (over = {}) =>
        makeDeckTx({ rack: SHORT, matches: SHORT_MATCHES, ...over });

      it('stacks exactly the four the organizer named', async () => {
        const tx = shortTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.fillCourt(ARENA, COURT, HAND_PICKED, {
          players: HAND_PICKED,
          deck: 'W',
        });

        expect(result.error).toBeUndefined();
        expect(stacked(tx)).toEqual(HAND_PICKED);
      });

      it('counts as that deck\'s turn, so the rotation moves on', async () => {
        // The organizer pressed the winners' button, however the four were
        // assembled — otherwise the same deck could go out twice running.
        const tx = shortTx({ lastDeckFilled: 'L' });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.fillCourt(ARENA, COURT, HAND_PICKED, { players: HAND_PICKED, deck: 'W' });

        expect(tx.arena.updateMany).toHaveBeenCalledWith({
          where: { id: ARENA },
          data: { lastDeckFilled: 'W' },
        });
      });

      it('refuses when one of the four already left the rack', async () => {
        const tx = shortTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const gone = ['w1', 'w2', 'l3', 'departed'];
        const result = await actions.fillCourt(ARENA, COURT, gone, { players: gone, deck: 'W' });

        expect(result.error).toBe('The court or queue changed while loading. Please try again.');
        expect(tx.player.updateMany).not.toHaveBeenCalled();
        expect(tx.courtSlot.createMany).not.toHaveBeenCalled();
      });

      it('refuses a four naming the same paddle twice', async () => {
        const tx = shortTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const dupes = ['w1', 'w1', 'l3', 'l4'];
        const result = await actions.fillCourt(ARENA, COURT, dupes, { players: dupes, deck: 'W' });

        expect(result.error).toBe('The court or queue changed while loading. Please try again.');
        expect(tx.courtSlot.createMany).not.toHaveBeenCalled();
      });

      it('ignores a malformed payload and stacks automatically instead', async () => {
        // A garbled manual payload must not fail the tap — it falls back to the
        // ordinary deck selection, which here is the four losers.
        const tx = shortTx({ lastDeckFilled: 'W' });
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        const result = await actions.fillCourt(ARENA, COURT, undefined, {
          players: ['w1', 'w2'],
          deck: 'X',
        });

        expect(result.error).toBeUndefined();
        expect(stacked(tx)).toEqual(['l1', 'l2', 'l3', 'l4']);
      });

      it('is ignored entirely when the arena is not running decks', async () => {
        // Outside deck mode there are no decks to top up, so the classic top
        // four stack regardless of what was sent.
        const tx = makeTx();
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await actions.fillCourt(ARENA, COURT, undefined, {
          players: ['p4', 'p3', 'p2', 'p1'],
          deck: 'W',
        });

        expect(stacked(tx)).toEqual(['p1', 'p2', 'p3', 'p4']);
      });
    });
  });

  it('records the exact bumped player ids on the court for cancelFill to reverse', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.fillCourt(ARENA, COURT);

    // cancelFill scopes its waitRounds decrement to EXACTLY these ids — anyone
    // recycled into the queue by a later finish must not be touched.
    expect(tx.court.update).toHaveBeenCalledWith({
      where: { id: COURT },
      // `fillPrevDeck` rides along on the same write: null here because this
      // arena isn't running win/lose decks.
      data: { fillBumpedPlayerIds: ['p5', 'p6'], fillPrevDeck: null },
    });
  });
});

describe('cancelFill() — return four players to the rack without recording a match', () => {
  const COURT = 'court-1';

  // Build a fresh tx mock for cancelFill: covers every prisma call the action
  // makes inside the transaction. court.updateMany returns count: 1 by default
  // (the happy "atomic claim" path); each test overrides specifics.
  function makeTx({ slots, bumpedIds = [], others = [], courtClaimCount = 1, prevDeck = null } = {}) {
    return {
      $executeRaw: vi.fn(),
      // cancelFill rewinds the win/lose deck alternation to the court's
      // `fillPrevDeck`, so the arena delegate has to be present even for
      // arenas that don't run deck mode (where it writes null over null).
      arena: { updateMany: vi.fn() },
      court: {
        findFirst: vi.fn().mockResolvedValue({
          fillBumpedPlayerIds: bumpedIds,
          fillPrevDeck: prevDeck,
        }),
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

  it('rewinds the win/lose deck alternation to the pointer the fill found', async () => {
    // A cancelled stack must not cost the other deck its turn: the winners
    // were stacked over "losers went last", so undoing it puts the pointer
    // back to L and the winners are up next again.
    const tx = makeTx({ slots: FULL_SLOTS, prevDeck: 'L' });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.cancelFill(ARENA, COURT);

    expect(tx.arena.updateMany).toHaveBeenCalledWith({
      where: { id: ARENA },
      data: { lastDeckFilled: 'L' },
    });
  });

  it('writes a null pointer for an arena not running decks', async () => {
    // `fillPrevDeck` is always null outside deck mode, so this is null over
    // null — asserted so the write can never carry a stale value instead.
    const tx = makeTx({ slots: FULL_SLOTS });
    prisma.$transaction.mockImplementation(async (cb) => cb(tx));

    await actions.cancelFill(ARENA, COURT);

    expect(tx.arena.updateMany).toHaveBeenCalledWith({
      where: { id: ARENA },
      data: { lastDeckFilled: null },
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
      data: { status: 'vacant', fillBumpedPlayerIds: [], fillPrevDeck: null },
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
      data: {
        gamesPlayed: { increment: 1 },
        queueOrder: null,
        waitRounds: 0,
        skipBoosted: false,
        draftedDeck: null,
        draftedLocked: false,
      },
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
