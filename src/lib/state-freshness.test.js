import { describe, it, expect, beforeEach } from 'vitest';
import { nextStateStamp, createStateFreshnessGuard } from './state-freshness';

describe('nextStateStamp', () => {
  beforeEach(() => {
    delete globalThis.__dinkStateStampLast;
  });

  it('is strictly increasing across rapid calls (no same-millisecond ties)', () => {
    const stamps = Array.from({ length: 1000 }, () => nextStateStamp());
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
  });

  it('stays wall-clock anchored when calls are sparse', () => {
    const before = Date.now();
    const stamp = nextStateStamp();
    expect(stamp).toBeGreaterThanOrEqual(before);
  });

  it('shares the counter via globalThis (separate module instances stay ordered)', () => {
    const a = nextStateStamp();
    // Simulate another bundle's instance reading the same global slot.
    expect(globalThis.__dinkStateStampLast).toBe(a);
    const b = nextStateStamp();
    expect(b).toBeGreaterThan(a);
  });
});

describe('createStateFreshnessGuard', () => {
  it('applies the first snapshot for a key', () => {
    const guard = createStateFreshnessGuard();
    expect(guard('arena-1', { fetchedAt: 100 })).toBe(true);
  });

  it('rejects a snapshot older than one already applied', () => {
    const guard = createStateFreshnessGuard();
    guard('arena-1', { fetchedAt: 100 });
    expect(guard('arena-1', { fetchedAt: 99 })).toBe(false);
  });

  it('applies a fresher snapshot and advances the floor', () => {
    const guard = createStateFreshnessGuard();
    guard('arena-1', { fetchedAt: 100 });
    expect(guard('arena-1', { fetchedAt: 101 })).toBe(true);
    expect(guard('arena-1', { fetchedAt: 100 })).toBe(false);
  });

  it('applies an equal stamp (duplicate of the same frame is idempotent)', () => {
    const guard = createStateFreshnessGuard();
    guard('arena-1', { fetchedAt: 100 });
    expect(guard('arena-1', { fetchedAt: 100 })).toBe(true);
  });

  it('always applies a stampless payload (older shape, rolling deploy)', () => {
    const guard = createStateFreshnessGuard();
    guard('arena-1', { fetchedAt: 100 });
    expect(guard('arena-1', {})).toBe(true);
    // ...and a stampless apply must not regress the floor.
    expect(guard('arena-1', { fetchedAt: 99 })).toBe(false);
  });

  it('tracks keys independently', () => {
    const guard = createStateFreshnessGuard();
    guard('arena-1', { fetchedAt: 100 });
    expect(guard('arena-2', { fetchedAt: 50 })).toBe(true);
    expect(guard('arena-1', { fetchedAt: 50 })).toBe(false);
  });

  it('handles a null/undefined state without throwing (treated as stampless)', () => {
    const guard = createStateFreshnessGuard();
    expect(guard('arena-1', null)).toBe(true);
    expect(guard('arena-1', undefined)).toBe(true);
  });
});
