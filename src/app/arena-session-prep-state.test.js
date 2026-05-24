import { describe, it, expect } from 'vitest';
import { deriveState } from './arena-session-prep-state';

// Tue/Thu 18:00–22:00 UTC, matching the sessions.js test fixture.
const sched = (overrides = {}) => ({
  days: [2, 4],
  start: '18:00',
  end: '22:00',
  timezone: 'UTC',
  ...overrides,
});

// 2026-05-19 is a Tuesday in UTC; 2026-05-20 Wed; 2026-05-21 Thu.
const at = (iso) => new Date(iso);

describe('deriveState', () => {
  it('returns kind "none" (no reset) when the arena has no schedule', () => {
    const s = deriveState({ schedule: sched({ days: [] }), lastSessionResetAt: null, now: at('2026-05-19T12:00:00Z') });
    expect(s.kind).toBe('none');
    expect(s.needsReset).toBe(false);
  });

  it('returns kind "live" with no reset CTA during a session', () => {
    const s = deriveState({ schedule: sched(), lastSessionResetAt: null, now: at('2026-05-19T19:00:00Z') });
    expect(s.kind).toBe('live');
    expect(s.needsReset).toBe(false);
  });

  it('returns kind "between" on an off-day with a future session', () => {
    // Wednesday noon → next session is Thursday.
    const s = deriveState({ schedule: sched(), lastSessionResetAt: null, now: at('2026-05-20T12:00:00Z') });
    expect(s.kind).toBe('between');
    expect(s.session.start.toISOString()).toBe('2026-05-21T18:00:00.000Z');
  });

  it('returns kind "imminent" within the hour before a session starts', () => {
    // Tue 17:30 → session at 18:00 is 30 min away (< IMMINENT_WINDOW_MS).
    const s = deriveState({ schedule: sched(), lastSessionResetAt: null, now: at('2026-05-19T17:30:00Z') });
    expect(s.kind).toBe('imminent');
    expect(s.msToStart).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  describe('needsReset gating', () => {
    // Wednesday: a between day with the next session on Thursday. The prior
    // session ended Tue 22:00, so a reset stamped after that = "prepared".
    const now = at('2026-05-20T12:00:00Z');

    it('is true when auto-reset is on and the session is not yet prepped', () => {
      const s = deriveState({ schedule: sched(), lastSessionResetAt: null, autoResetOnSession: true, now });
      expect(s.needsReset).toBe(true);
      expect(s.prepared).toBe(false);
    });

    it('is false when auto-reset is OFF, even if not prepped', () => {
      const s = deriveState({ schedule: sched(), lastSessionResetAt: null, autoResetOnSession: false, now });
      expect(s.needsReset).toBe(false);
    });

    it('is false once the upcoming session is already prepped', () => {
      // Reset stamped Wed 09:00 — after the prior Tue session ended (Tue 22:00).
      const s = deriveState({
        schedule: sched(),
        lastSessionResetAt: '2026-05-20T09:00:00Z',
        autoResetOnSession: true,
        now,
      });
      expect(s.prepared).toBe(true);
      expect(s.needsReset).toBe(false);
    });

    it('treats a stale reset (before the prior session ended) as not prepped', () => {
      // Reset stamped last Friday — older than the prior Tue session's end.
      const s = deriveState({
        schedule: sched(),
        lastSessionResetAt: '2026-05-15T09:00:00Z',
        autoResetOnSession: true,
        now,
      });
      expect(s.prepared).toBe(false);
      expect(s.needsReset).toBe(true);
    });

    it('defaults autoResetOnSession to true when omitted', () => {
      const s = deriveState({ schedule: sched(), lastSessionResetAt: null, now });
      expect(s.needsReset).toBe(true);
    });
  });
});
