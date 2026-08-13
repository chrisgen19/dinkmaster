import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma so `getState` is testable with no database. It reads five
// collections in parallel; the empty defaults below cover everything these
// tests don't care about.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: { findMany: vi.fn(async () => []) },
    court: { findMany: vi.fn(async () => []) },
    match: { findMany: vi.fn(async () => []) },
    partnership: { findMany: vi.fn(async () => []) },
    arena: { findUnique: vi.fn(async () => null) },
  },
}));

import { prisma } from '@/lib/prisma';
import { DEFAULT_TARGET_SCORE, DEFAULT_WIN_BY } from './match-defaults';
import { getState } from './data';

const ARENA = 'arena-1';

// The Arena row `getState` selects. Only the board-stream columns are on it.
const arenaRow = (overrides = {}) => ({
  lastSessionResetAt: null,
  offlineHolderLabel: null,
  offlineHeldAt: null,
  lastDeckFilled: null,
  winBy: 2,
  targetScore: 11,
  splitDeckByResult: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.player.findMany.mockResolvedValue([]);
  prisma.court.findMany.mockResolvedValue([]);
  prisma.match.findMany.mockResolvedValue([]);
  prisma.partnership.findMany.mockResolvedValue([]);
  prisma.arena.findUnique.mockResolvedValue(arenaRow());
});

describe('getState', () => {
  it('refuses an undefined arenaId rather than reading every arena', async () => {
    // Prisma drops `where: { arenaId: undefined }` entirely, so this guard is
    // the only thing between a bad call and a cross-arena read.
    await expect(getState(undefined)).rejects.toThrow('getState requires an arenaId');
    expect(prisma.player.findMany).not.toHaveBeenCalled();
  });

  describe('winBy', () => {
    // The margin rides the board stream so the score dialog validates against
    // the live rule instead of the page prop it was served with. Two managers,
    // one arena: without this the second tab keeps refusing (or wrongly
    // offering) an 11-10 until someone reloads, and (worse) freezes the stale
    // value onto an offline pending log, where it is hashed into the sync
    // fingerprint and returns the whole batch as a divergence.
    it('is selected from the Arena row', async () => {
      await getState(ARENA);
      expect(prisma.arena.findUnique).toHaveBeenCalledWith({
        where: { id: ARENA },
        select: expect.objectContaining({ winBy: true }),
      });
    });

    it("returns the arena's current margin", async () => {
      prisma.arena.findUnique.mockResolvedValue(arenaRow({ winBy: 1 }));
      await expect(getState(ARENA)).resolves.toMatchObject({ winBy: 1 });
    });

    it('falls back to the default when the arena row is missing', async () => {
      // A deleted arena mid-read yields null. The payload still has to carry a
      // usable margin: absence must not read as "sudden death" and start
      // accepting scorelines the server would refuse.
      prisma.arena.findUnique.mockResolvedValue(null);
      await expect(getState(ARENA)).resolves.toMatchObject({ winBy: DEFAULT_WIN_BY });
    });
  });

  describe('targetScore', () => {
    // Rides the board stream for the same reason `winBy` does, plus one of its
    // own: `board-fingerprint` hashes it FIRST in the rules string, so a tab
    // that goes offline holding a stale target strands the whole sync batch as
    // a divergence rather than just breaking one dialog.
    it('is selected from the Arena row', async () => {
      await getState(ARENA);
      expect(prisma.arena.findUnique).toHaveBeenCalledWith({
        where: { id: ARENA },
        select: expect.objectContaining({ targetScore: true }),
      });
    });

    it("returns the arena's current target", async () => {
      prisma.arena.findUnique.mockResolvedValue(arenaRow({ targetScore: 15 }));
      await expect(getState(ARENA)).resolves.toMatchObject({ targetScore: 15 });
    });

    it('falls back to the default when the arena row is missing', async () => {
      prisma.arena.findUnique.mockResolvedValue(null);
      await expect(getState(ARENA)).resolves.toMatchObject({
        targetScore: DEFAULT_TARGET_SCORE,
      });
    });

    it("does not collide with a match's own recorded target", async () => {
      // Two different meanings, one name: the top-level value is the rule new
      // games are judged by, each history row carries what THAT game was played
      // to. A correction dialog reads the row; the finish dialog reads the top.
      prisma.arena.findUnique.mockResolvedValue(arenaRow({ targetScore: 15 }));
      prisma.match.findMany.mockResolvedValue([
        {
          id: 'm1',
          courtName: 'Court 1',
          score1: 11,
          score2: 9,
          targetScore: 11,
          winBy: 2,
          editedAt: null,
          createdAt: new Date('2026-08-14T00:00:00.000Z'),
          players: [],
        },
      ]);
      const state = await getState(ARENA);
      expect(state.targetScore).toBe(15);
      expect(state.matchHistory[0].targetScore).toBe(11);
    });
  });

  describe('matchHistory provenance', () => {
    it("carries each match's own target and margin", async () => {
      prisma.match.findMany.mockResolvedValue([
        {
          id: 'm1',
          courtName: 'Court 1',
          score1: 11,
          score2: 10,
          targetScore: 11,
          winBy: 1,
          editedAt: null,
          createdAt: new Date('2026-08-13T00:00:00.000Z'),
          players: [],
        },
      ]);
      const state = await getState(ARENA);
      // The correction dialog seeds from these, so they must be the rules the
      // match was PLAYED under, never the arena's current ones.
      expect(state.matchHistory[0]).toMatchObject({ targetScore: 11, winBy: 1 });
    });

    it('passes a pre-column margin through as null rather than defaulting it', async () => {
      // 20260813150000 backfills these, so in practice no row is null. The
      // fallback still belongs to the reader (`updateMatchScore` and the
      // dialog), not to this payload, which reports what the row holds.
      prisma.match.findMany.mockResolvedValue([
        {
          id: 'm1',
          courtName: 'Court 1',
          score1: 11,
          score2: 9,
          targetScore: null,
          winBy: null,
          editedAt: null,
          createdAt: new Date('2026-08-13T00:00:00.000Z'),
          players: [],
        },
      ]);
      const state = await getState(ARENA);
      expect(state.matchHistory[0]).toMatchObject({ targetScore: null, winBy: null });
    });
  });
});
