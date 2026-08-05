import { describe, it, expect, vi } from 'vitest';
import { canonicalPair, currentActivity, resolveMatchActivityId } from './board-apply';

// These cover the activity-resolution helpers only. The rest of board-apply is
// exercised through `src/app/actions.test.js`, which drives the appliers via the
// server actions with a stubbed transaction client.

const LIVE = { id: 'live-1', arenaId: 'a1', status: 'LIVE' };

/** A transaction stub with just the delegates these helpers touch. */
const makeTx = ({ live = LIVE, containing = null, timezone = 'Asia/Manila' } = {}) => ({
  activity: {
    // `currentActivity` filters on status LIVE; `resolveMatchActivityId` filters
    // on a window containing the instant. One stub serves both by branching on
    // whether the caller asked for a window.
    findFirst: vi.fn(async ({ where }) => (where.startsAt ? containing : live)),
    create: vi.fn(async ({ data }) => ({ id: 'created-1', ...data })),
  },
  arena: {
    findUnique: vi.fn(async () => (timezone ? { timezone } : null)),
  },
});

describe('canonicalPair', () => {
  it('sorts so each pair has exactly one row regardless of argument order', () => {
    expect(canonicalPair('b', 'a')).toEqual(['a', 'b']);
    expect(canonicalPair('a', 'b')).toEqual(['a', 'b']);
  });
});

describe('currentActivity', () => {
  it('returns the open activity when there is one', async () => {
    const tx = makeTx();
    await expect(currentActivity(tx, 'a1')).resolves.toEqual(LIVE);
    expect(tx.activity.create).not.toHaveBeenCalled();
  });

  it('opens one on demand so a board write never fails for want of an activity', async () => {
    const tx = makeTx({ live: null });
    const opened = await currentActivity(tx, 'a1');

    expect(opened.status).toBe('LIVE');
    // MANUAL, so the schedule materializer never mistakes it for one of its own.
    expect(opened.source).toBe('MANUAL');
    expect(opened.timezone).toBe('Asia/Manila');
    expect(opened.openedAt).toEqual(opened.startsAt);
  });

  it('throws ARENA_GONE rather than creating an orphan when the arena vanished', async () => {
    const tx = makeTx({ live: null, timezone: null });
    await expect(currentActivity(tx, 'a1')).rejects.toThrow('ARENA_GONE');
  });
});

describe('resolveMatchActivityId', () => {
  it('uses the open activity for an online finish (no occurredAt)', async () => {
    const tx = makeTx();
    await expect(resolveMatchActivityId(tx, 'a1', null)).resolves.toBe(LIVE.id);
  });

  it('attributes a synced offline match to the activity its window contains', async () => {
    // The scenario this exists for: played through Tuesday's session, synced on
    // Thursday. Without the window lookup every one of Tuesday's matches would
    // be stamped with Thursday's activity, silently moving a whole night's
    // records onto the wrong night.
    const tuesday = { id: 'tuesday', arenaId: 'a1', status: 'COMPLETED' };
    const tx = makeTx({ live: { id: 'thursday', arenaId: 'a1', status: 'LIVE' }, containing: tuesday });

    const occurredAt = new Date('2026-05-19T19:30:00Z');
    await expect(resolveMatchActivityId(tx, 'a1', occurredAt)).resolves.toBe('tuesday');

    // Bounds are half-open [startsAt, endsAt) and cancelled nights are excluded.
    const [{ where }] = tx.activity.findFirst.mock.calls[0];
    expect(where).toMatchObject({
      arenaId: 'a1',
      startsAt: { lte: occurredAt },
      endsAt: { gt: occurredAt },
      status: { not: 'CANCELLED' },
    });
  });

  it('falls back to the open activity when no window contains the instant', async () => {
    // An unscheduled arena, or a match played outside every materialized window.
    const tx = makeTx({ containing: null });
    const occurredAt = new Date('2026-05-19T19:30:00Z');
    await expect(resolveMatchActivityId(tx, 'a1', occurredAt)).resolves.toBe(LIVE.id);
  });
});
