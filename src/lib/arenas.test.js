import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma so the access gates are testable with no database. We only stub the
// methods these loaders touch; the walk-in happy path runs `buildPlayerStats`,
// which needs just `player.findMany`/`matchPlayer.findMany` (returning []) and the
// mocked weekly leaderboard below.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    arena: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn() },
    player: { findMany: vi.fn(), findUnique: vi.fn() },
    matchPlayer: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/leaderboard-server', () => ({
  getWeeklyLeaderboard: vi.fn(async () => ({ leaders: [] })),
}));

import { prisma } from '@/lib/prisma';
import {
  usersShareArena,
  getViewableUserProfile,
  getViewablePlayerProfile,
  listUserArenas,
  listPublicArenas,
  countPublicArenas,
} from './arenas';

const VIEWER = 'viewer-1';
const TARGET = 'target-1';
const ARENA = 'arena-1';

// "Belongs to an arena" predicate the gates build for a user (member OR owner).
const inArena = (userId) => ({ OR: [{ ownerId: userId }, { memberships: { some: { userId } } }] });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usersShareArena', () => {
  it('returns true when an arena lists both users (member or owner)', async () => {
    prisma.arena.findFirst.mockResolvedValue({ id: ARENA });
    await expect(usersShareArena(VIEWER, TARGET)).resolves.toBe(true);
    // Both sides honor ownerId, not just membership rows.
    expect(prisma.arena.findFirst).toHaveBeenCalledWith({
      where: { AND: [inArena(VIEWER), inArena(TARGET)] },
      select: { id: true },
    });
  });

  it('returns false when no arena lists both', async () => {
    prisma.arena.findFirst.mockResolvedValue(null);
    await expect(usersShareArena(VIEWER, TARGET)).resolves.toBe(false);
  });

  it('short-circuits to false (no query) when an id is missing', async () => {
    await expect(usersShareArena('', TARGET)).resolves.toBe(false);
    await expect(usersShareArena(VIEWER, null)).resolves.toBe(false);
    expect(prisma.arena.findFirst).not.toHaveBeenCalled();
  });
});

describe('getViewableUserProfile', () => {
  it('returns null and never reads the user when no arena is shared', async () => {
    prisma.arena.findFirst.mockResolvedValue(null);
    const result = await getViewableUserProfile(TARGET, VIEWER);
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the target user no longer exists', async () => {
    prisma.arena.findFirst.mockResolvedValue({ id: ARENA });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(getViewableUserProfile(TARGET, VIEWER)).resolves.toBeNull();
  });

  it('returns name + stats (no email) when the arena is shared', async () => {
    prisma.arena.findFirst.mockResolvedValue({ id: ARENA });
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
    expect(prisma.arena.findFirst).not.toHaveBeenCalled();
  });

  it('redirects a linked player to its account profile when an arena is shared', async () => {
    prisma.player.findUnique.mockResolvedValue({ id: 'p1', userId: 'acct-9', arenaId: ARENA });
    prisma.arena.findFirst.mockResolvedValue({ id: ARENA }); // shares an arena
    const result = await getViewablePlayerProfile('p1', VIEWER);
    expect(result).toEqual({ redirectUserId: 'acct-9' });
  });

  it('returns null for a linked player with no shared arena (no account-id leak)', async () => {
    prisma.player.findUnique.mockResolvedValue({ id: 'p1', userId: 'acct-9', arenaId: ARENA });
    prisma.arena.findFirst.mockResolvedValue(null); // no shared arena
    await expect(getViewablePlayerProfile('p1', VIEWER)).resolves.toBeNull();
  });

  it('returns null for a walk-in when the viewer is not in its arena', async () => {
    prisma.player.findUnique.mockResolvedValue({ id: 'p1', userId: null, arenaId: ARENA, firstName: 'Sam' });
    prisma.arena.findFirst.mockResolvedValue(null);
    await expect(getViewablePlayerProfile('p1', VIEWER)).resolves.toBeNull();
    expect(prisma.matchPlayer.findMany).not.toHaveBeenCalled();
    // Gate honors ownerId, not just membership.
    expect(prisma.arena.findFirst).toHaveBeenCalledWith({
      where: { id: ARENA, OR: [{ ownerId: VIEWER }, { memberships: { some: { userId: VIEWER } } }] },
      select: { id: true },
    });
  });

  it('returns name + stats for a walk-in the viewer shares an arena with', async () => {
    prisma.player.findUnique.mockResolvedValue({
      id: 'p1', userId: null, arenaId: ARENA, firstName: 'Sam', lastName: 'Lee',
      gamesPlayed: 4, wins: 3, losses: 1, rating: 1080, queueOrder: 2, leftAt: null,
      arena: { name: 'Mirea Dinkers Club' },
    });
    prisma.arena.findFirst.mockResolvedValue({ id: ARENA }); // viewer in the arena
    prisma.matchPlayer.findMany.mockResolvedValue([]);

    const result = await getViewablePlayerProfile('p1', VIEWER);
    expect(result.name).toBe('Sam Lee');
    expect(result.stats.totals).toMatchObject({ arenas: 1, gamesPlayed: 4, wins: 3, losses: 1 });
    expect(result.stats.arenas).toHaveLength(1);
    expect(result.stats.arenas[0]).toMatchObject({ arenaId: ARENA, arenaName: 'Mirea Dinkers Club' });
  });
});

describe('arena directory queries', () => {
  beforeEach(() => {
    prisma.arena.findMany.mockResolvedValue([]);
    prisma.arena.count.mockResolvedValue(0);
  });

  it('listUserArenas asks for owned OR joined arenas, unpaged', () => {
    listUserArenas(VIEWER);
    const [args] = prisma.arena.findMany.mock.calls[0];
    expect(args.where).toEqual(inArena(VIEWER));
    // No take: this half is bounded by how many arenas one person belongs to,
    // and it's the half they came for.
    expect(args.take).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });

  it('listPublicArenas pages, and excludes what the viewer already has', () => {
    listPublicArenas({ excludeIds: ['a', 'b'], skip: 24, take: 12 });
    const [args] = prisma.arena.findMany.mock.calls[0];
    expect(args.where).toEqual({ id: { notIn: ['a', 'b'] } });
    expect(args).toMatchObject({ skip: 24, take: 12 });
  });

  it('orders the public list by a stable key, not createdAt alone', () => {
    // Two arenas created in the same millisecond could otherwise swap places
    // between the page-1 and page-2 queries, so a row appears twice or never.
    listPublicArenas({ skip: 0, take: 12 });
    const [args] = prisma.arena.findMany.mock.calls[0];
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('omits the exclusion filter when the viewer has no arenas', () => {
    // An empty `notIn` is dropped by Prisma anyway; not building it keeps the
    // guest query trivially readable in logs.
    listPublicArenas({ excludeIds: [], skip: 0, take: 12 });
    expect(prisma.arena.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('counts with the same filter the list uses', async () => {
    // If these two disagree, the pager promises pages that render empty.
    await countPublicArenas({ excludeIds: ['a'] });
    listPublicArenas({ excludeIds: ['a'], skip: 0, take: 12 });
    expect(prisma.arena.count.mock.calls[0][0].where).toEqual(
      prisma.arena.findMany.mock.calls[0][0].where,
    );
  });

  it('counts only active players, so departed rows do not inflate a card', async () => {
    listPublicArenas({ skip: 0, take: 12 });
    const [args] = prisma.arena.findMany.mock.calls[0];
    expect(args.include._count.select.players).toEqual({ where: { leftAt: null } });
  });
});
