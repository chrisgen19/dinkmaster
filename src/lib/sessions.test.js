import { describe, it, expect } from 'vitest';
import {
  sessionWindow,
  currentSession,
  nextSession,
  lastSession,
  IMMINENT_WINDOW_MS,
} from '@/lib/sessions';

// All tests pin `now` explicitly so weekday-derived behavior is deterministic.
// 2026-05-19 is a Tuesday in UTC; 2026-05-20 Wed; 2026-05-21 Thu.

/** Schedule helper — Tue/Thu 18:00–22:00 in UTC by default. */
const sched = (overrides = {}) => ({
  days: [2, 4], // Tue, Thu (JS getDay)
  start: '18:00',
  end: '22:00',
  timezone: 'UTC',
  ...overrides,
});

describe('sessionWindow', () => {
  it('returns null when scheduleDays is empty', () => {
    const win = sessionWindow(sched({ days: [] }), new Date('2026-05-19T18:30:00Z'));
    expect(win).toBeNull();
  });

  it('returns null when today is not a scheduled day', () => {
    // 2026-05-20 is a Wednesday; schedule is Tue/Thu.
    const win = sessionWindow(sched(), new Date('2026-05-20T18:30:00Z'));
    expect(win).toBeNull();
  });

  it('returns the start/end of today when today is a scheduled day', () => {
    const win = sessionWindow(sched(), new Date('2026-05-19T12:00:00Z')); // Tue noon
    expect(win.start.toISOString()).toBe('2026-05-19T18:00:00.000Z');
    expect(win.end.toISOString()).toBe('2026-05-19T22:00:00.000Z');
  });

  it('shifts the window by the timezone offset', () => {
    // Asia/Manila is UTC+8, so local Tue 18:00 = 10:00 UTC.
    const win = sessionWindow(sched({ timezone: 'Asia/Manila' }), new Date('2026-05-19T02:00:00Z'));
    expect(win.start.toISOString()).toBe('2026-05-19T10:00:00.000Z');
    expect(win.end.toISOString()).toBe('2026-05-19T14:00:00.000Z');
  });

  it('falls back to the whole day when start/end are missing', () => {
    const win = sessionWindow(sched({ start: null, end: null }), new Date('2026-05-19T12:00:00Z'));
    expect(win.start.toISOString()).toBe('2026-05-19T00:00:00.000Z');
    expect(win.end.toISOString()).toBe('2026-05-19T23:59:00.000Z');
  });

  it('coerces overnight (start >= end) to whole-day in V1', () => {
    // 22:00–02:00 isn't supported yet; we coerce to 00:00–23:59 to avoid an
    // empty window. The test pins the V1 contract — when overnight support
    // lands, update this to assert the real cross-midnight window.
    const win = sessionWindow(sched({ start: '22:00', end: '02:00' }), new Date('2026-05-19T12:00:00Z'));
    expect(win.start.toISOString()).toBe('2026-05-19T00:00:00.000Z');
    expect(win.end.toISOString()).toBe('2026-05-19T23:59:00.000Z');
  });
});

describe('currentSession', () => {
  it('returns the window when now is inside it', () => {
    const win = currentSession(sched(), new Date('2026-05-19T19:30:00Z'));
    expect(win).not.toBeNull();
    expect(win.start.toISOString()).toBe('2026-05-19T18:00:00.000Z');
  });

  it('returns null at the exact end (right-open interval)', () => {
    expect(currentSession(sched(), new Date('2026-05-19T22:00:00Z'))).toBeNull();
  });

  it('returns null before the session starts on a scheduled day', () => {
    expect(currentSession(sched(), new Date('2026-05-19T17:59:00Z'))).toBeNull();
  });

  it('returns null on an off-schedule day even mid-window', () => {
    expect(currentSession(sched(), new Date('2026-05-20T19:00:00Z'))).toBeNull();
  });
});

describe('nextSession', () => {
  it('returns null when no days are scheduled', () => {
    expect(nextSession(sched({ days: [] }), new Date('2026-05-19T12:00:00Z'))).toBeNull();
  });

  it('returns todays session when now is before its start on a scheduled day', () => {
    const win = nextSession(sched(), new Date('2026-05-19T10:00:00Z')); // Tue morning
    expect(win.start.toISOString()).toBe('2026-05-19T18:00:00.000Z');
  });

  it('returns the next scheduled day when today is past the window', () => {
    const win = nextSession(sched(), new Date('2026-05-19T22:30:00Z')); // Tue late evening
    expect(win.start.toISOString()).toBe('2026-05-21T18:00:00.000Z'); // Thu
  });

  it('skips off-schedule days', () => {
    const win = nextSession(sched(), new Date('2026-05-20T12:00:00Z')); // Wed noon
    expect(win.start.toISOString()).toBe('2026-05-21T18:00:00.000Z'); // Thu
  });

  it('picks the closer of multiple scheduled days', () => {
    // Mon + Fri schedule; on a Tuesday the closer next is Friday.
    const win = nextSession(sched({ days: [1, 5] }), new Date('2026-05-19T12:00:00Z'));
    expect(win.start.toISOString()).toBe('2026-05-22T18:00:00.000Z'); // Fri
  });

  it('wraps to next week when today is the only scheduled day and it has passed', () => {
    // Tuesday-only schedule, Tue 23:00 → next session is next Tue.
    const win = nextSession(sched({ days: [2] }), new Date('2026-05-19T23:00:00Z'));
    expect(win.start.toISOString()).toBe('2026-05-26T18:00:00.000Z');
  });

  it('flags imminent sessions for banner consumers via IMMINENT_WINDOW_MS', () => {
    // Sanity check the export so the UI layer doesn't ship its own threshold.
    const win = nextSession(sched(), new Date('2026-05-19T17:30:00Z')); // 30 min before
    expect(win.start.getTime() - new Date('2026-05-19T17:30:00Z').getTime()).toBeLessThan(IMMINENT_WINDOW_MS);
  });
});

describe('lastSession', () => {
  it('returns null when no days are scheduled', () => {
    expect(lastSession(sched({ days: [] }), new Date('2026-05-19T12:00:00Z'))).toBeNull();
  });

  it('returns today when today is a scheduled day and the session has ended', () => {
    const win = lastSession(sched(), new Date('2026-05-19T23:00:00Z')); // Tue, after end
    expect(win.start.toISOString()).toBe('2026-05-19T18:00:00.000Z');
  });

  it('skips a currently-live session and returns the one before it', () => {
    // Mid-Tue-session: today is "current", so "last" is the prior Thu. Callers
    // wanting "active OR most recent" check currentSession first.
    const win = lastSession(sched(), new Date('2026-05-19T19:00:00Z'));
    expect(win.start.toISOString()).toBe('2026-05-14T18:00:00.000Z'); // prior Thu
  });

  it('returns the previous scheduled day when today has no session yet', () => {
    // Tue 10:00 — today's session is still upcoming, so "last" is the prior Thu.
    const win = lastSession(sched(), new Date('2026-05-19T10:00:00Z'));
    expect(win.start.toISOString()).toBe('2026-05-14T18:00:00.000Z'); // prior Thu
  });

  it('skips off-schedule days going backward', () => {
    const win = lastSession(sched(), new Date('2026-05-20T12:00:00Z')); // Wed noon
    expect(win.start.toISOString()).toBe('2026-05-19T18:00:00.000Z'); // prior Tue
  });
});
