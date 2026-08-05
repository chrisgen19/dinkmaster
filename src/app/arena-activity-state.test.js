import { describe, it, expect } from 'vitest';
import { deriveActivityBannerState } from './arena-activity-state';

// 2026-05-19 is a Tuesday in UTC; 2026-05-21 Thu. Activity rows carry ISO
// strings, matching what `getState` / the route props ship to the client.
const at = (iso) => new Date(iso);
const activity = (id, startsAt, endsAt) => ({ id, startsAt, endsAt });

const TUE = activity('tue', '2026-05-19T18:00:00Z', '2026-05-19T22:00:00Z');
const THU = activity('thu', '2026-05-21T18:00:00Z', '2026-05-21T22:00:00Z');

describe('deriveActivityBannerState', () => {
  it('returns kind "none" when there is no upcoming activity', () => {
    const s = deriveActivityBannerState({ nextActivity: null, now: at('2026-05-20T12:00:00Z') });
    expect(s.kind).toBe('none');
    expect(s.needsReset).toBe(false);
  });

  it('returns kind "live" with no CTA while the open activity is running', () => {
    const s = deriveActivityBannerState({
      currentActivity: TUE,
      nextActivity: THU,
      now: at('2026-05-19T19:00:00Z'),
    });
    expect(s.kind).toBe('live');
    expect(s.needsReset).toBe(false);
  });

  it('treats an impromptu activity as live too — no schedule rule required', () => {
    // A MANUAL row opened on an unscheduled day still suppresses the banner.
    const adhoc = activity('adhoc', '2026-05-20T09:00:00Z', '2026-05-20T21:00:00Z');
    const s = deriveActivityBannerState({
      currentActivity: adhoc,
      nextActivity: THU,
      now: at('2026-05-20T12:00:00Z'),
    });
    expect(s.kind).toBe('live');
  });

  it('returns kind "between" on an off-day with a future activity', () => {
    const s = deriveActivityBannerState({
      currentActivity: TUE,
      nextActivity: THU,
      now: at('2026-05-20T12:00:00Z'), // Wednesday noon
    });
    expect(s.kind).toBe('between');
    expect(s.activity.id).toBe('thu');
  });

  it('flips to "imminent" inside the hour before the start', () => {
    const s = deriveActivityBannerState({
      currentActivity: TUE,
      nextActivity: THU,
      now: at('2026-05-21T17:30:00Z'),
    });
    expect(s.kind).toBe('imminent');
    expect(s.msToStart).toBe(30 * 60 * 1000);
  });

  describe('prepared — identity, not timestamp arithmetic', () => {
    it('is true once the open activity IS the next one up', () => {
      // The manager opened Thursday's session early: same row, so prepped.
      const s = deriveActivityBannerState({
        currentActivity: THU,
        nextActivity: THU,
        now: at('2026-05-21T17:00:00Z'),
      });
      expect(s.prepared).toBe(true);
      expect(s.needsReset).toBe(false);
    });

    it('is false while the open activity is still the previous night', () => {
      const s = deriveActivityBannerState({
        currentActivity: TUE,
        nextActivity: THU,
        now: at('2026-05-20T12:00:00Z'),
      });
      expect(s.prepared).toBe(false);
      expect(s.needsReset).toBe(true);
    });

    it('is false when no activity is open at all', () => {
      const s = deriveActivityBannerState({
        currentActivity: null,
        nextActivity: THU,
        now: at('2026-05-20T12:00:00Z'),
      });
      expect(s.prepared).toBe(false);
      expect(s.needsReset).toBe(true);
    });

    it('does not move when the schedule is edited', () => {
      // The old timestamp heuristic compared lastSessionResetAt against a
      // RECOMPUTED previous-session boundary, so changing scheduleDays silently
      // rewrote whether tonight counted as prepped. Row identity cannot drift:
      // the same two rows give the same answer regardless of any schedule rule.
      const before = deriveActivityBannerState({
        currentActivity: THU,
        nextActivity: THU,
        now: at('2026-05-21T17:00:00Z'),
      });
      const after = deriveActivityBannerState({
        currentActivity: THU,
        nextActivity: THU,
        now: at('2026-05-21T17:00:00Z'),
      });
      expect(before.prepared).toBe(after.prepared);
      expect(before.prepared).toBe(true);
    });
  });

  describe('needsReset gating', () => {
    it('stays false when auto-reset is off, however stale the open activity', () => {
      // Perpetual-rack mode: the rack and matrix carry over, so the banner is
      // informational and the CTA never crosses a boundary on its own.
      const s = deriveActivityBannerState({
        currentActivity: TUE,
        nextActivity: THU,
        autoResetOnSession: false,
        now: at('2026-05-20T12:00:00Z'),
      });
      expect(s.needsReset).toBe(false);
      expect(s.prepared).toBe(false); // still reported, so the banner can offer it manually
    });

    it('is true when auto-reset is on and the session is not yet open', () => {
      const s = deriveActivityBannerState({
        currentActivity: TUE,
        nextActivity: THU,
        autoResetOnSession: true,
        now: at('2026-05-20T12:00:00Z'),
      });
      expect(s.needsReset).toBe(true);
    });
  });
});
