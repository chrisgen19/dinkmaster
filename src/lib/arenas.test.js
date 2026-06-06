import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma so the access gate is testable with no database. We only stub the
// methods these two loaders touch; `getUserPlayerStats` (called on the happy
// path) needs just `player.findMany` — returning [] makes it resolve to an empty
// stats bundle without reaching the leaderboard reads.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    arenaMembership: { findFirst: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    player: { findMany: vi.fn(), findUnique: vi.fn() },
    matchPlayer: { findMany: vi.fn() },
  },
}));
// Walk-in stats touch the weekly leaderboard for an active player; stub it so the
// aggregation resolves without the real leaderboard reads.
vi.mock('@/lib/leaderboard-server', () => ({
  getWeeklyLeaderboard: vi.fn(async () => ({ leaders: [] })),
}));

import { prisma } from '@/lib/prisma';
import { usersShareArena, getViewableUserProfile, getViewablePlayerProfile } from './arenas';

const VIEWER = 'viewer-1';
const TARGET = 'target-1';
const ARENA = 'arena-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usersShareArena', () => {
  it('returns true when a shared-arena membership row exists', async () => {
    prisma.arenaMembership.findFirst.mockResolvedValue({ id: 'm1' });
    await expect(usersShareArena(VIEWER, TARGET)).resolves.toBe(true);
    expect(prisma.arenaMembership.findFirst).toHaveBeenCalledWith({
      where: {
        userId: VIEWER,
        arena: { memberships: { some: { userId: TARGET } } },
      },
      select: { id: true },
    });
  });

  it('returns false when no shared arena is found', async () => {
    prisma.arenaMembership.findFirst.mockResolvedValue(null);
    await expect(usersShareArena(VIEWER, TARGET)).resolves.toBe(false);
  });

  it('short-circuits to false (no query) when an id is missing', async () => {
    await expect(usersShareArena('', TARGET)).resolves.toBe(false);
    await expect(usersShareArena(VIEWER, null)).resolves.toBe(false);
    expect(prisma.arenaMembership.findFirst).not.toHaveBeenCalled();
  });
});

describe('getViewableUserProfile', () => {
  it('returns null and never reads the user when no arena is shared', async () => {
    prisma.arenaMembership.findFirst.mockResolvedValue(null);
    const result = await getViewableUserProfile(TARGET, VIEWER);
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the target user no longer exists', async () => {
    prisma.arenaMembership.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(getViewableUserProfile(TARGET, VIEWER)).resolves.toBeNull();
  });

  it('returns name + stats (no email) when the arena is shared', async () => {
    prisma.arenaMembership.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.user.findUnique.mockResolvedValue({ name: 'Ada Lovelace' });
    prisma.player.findMany.mockResolvedValue([]); // empty -> stats resolve cleanly

    const result = await getViewableUserProfile(TARGET, VIEWER);
    expect(result.name).toBe('Ada Lovelace');
    expect(result.stats.totals).toBeDefined();
    expect(result).not.toHaveProperty('email');
    // Name-only select — never pull email for a non-self viewer.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: TARGET },
      select: { name: true },
    });
  });
});

describe('getViewablePlayerProfile', () => {
  it('returns null when the player does not exist', async () => {
    prisma.player.findUnique.mockResolvedValue(null);
    await expect(getViewablePlayerProfile('p1', VIEWER)).resolves.toBeNull();
    expect(prisma.arenaMembership.findUnique).not.toHaveBeenCalled();
  });

  it('redirects a linked player to its account profile (no membership check)', async () => {
    prisma.player.findUnique.mockResolvedValue({ id: 'p1', userId: 'acct-9', arenaId: ARENA });
    const result = await getViewablePlayerProfile('p1', VIEWER);
    expect(result).toEqual({ redirectUserId: 'acct-9' });
    expect(prisma.arenaMembership.findUnique).not.toHaveBeenCalled();
  });

  it('returns null for a walk-in when the viewer is not in its arena', async () => {
    prisma.player.findUnique.mockResolvedValue({ id: 'p1', userId: null, arenaId: ARENA, firstName: 'Sam' });
    prisma.arenaMembership.findUnique.mockResolvedValue(null);
    await expect(getViewablePlayerProfile('p1', VIEWER)).resolves.toBeNull();
    expect(prisma.matchPlayer.findMany).not.toHaveBeenCalled();
  });

  it('returns name + stats for a walk-in the viewer shares an arena with', async () => {
    prisma.player.findUnique.mockResolvedValue({
      id: 'p1', userId: null, arenaId: ARENA, firstName: 'Sam', lastName: 'Lee',
      gamesPlayed: 4, wins: 3, losses: 1, rating: 1080, queueOrder: 2, leftAt: null,
      arena: { name: 'Mirea Dinkers Club' },
    });
    prisma.arenaMembership.findUnique.mockResolvedValue({ id: 'm1' });
    prisma.matchPlayer.findMany.mockResolvedValue([]);

    const result = await getViewablePlayerProfile('p1', VIEWER);
    expect(result.name).toBe('Sam Lee');
    expect(result.stats.totals).toMatchObject({ arenas: 1, gamesPlayed: 4, wins: 3, losses: 1 });
    expect(result.stats.arenas).toHaveLength(1);
    expect(result.stats.arenas[0]).toMatchObject({ arenaId: ARENA, arenaName: 'Mirea Dinkers Club' });
  });
});
