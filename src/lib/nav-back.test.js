import { describe, it, expect } from 'vitest';
import { canNavigateBack } from './nav-back';

describe('canNavigateBack()', () => {
  it('forceFallback always wins, even with in-app history', () => {
    expect(canNavigateBack({
      forceFallback: true,
      sameOriginReferrer: true,
      historyLength: 5,
      baseline: 1,
    })).toBe(false);
  });

  it('returns true when history grew past the entry baseline (SPA navigation)', () => {
    // Entered at length 2, navigated within the app to length 3.
    expect(canNavigateBack({
      sameOriginReferrer: false,
      historyLength: 3,
      baseline: 2,
    })).toBe(true);
  });

  it('returns true for a same-origin referrer with real history (full-page in-app nav)', () => {
    expect(canNavigateBack({
      sameOriginReferrer: true,
      historyLength: 2,
      baseline: 2,
    })).toBe(true);
  });

  it('returns false for a same-origin referrer in a fresh tab (length === 1)', () => {
    // "Open in new tab" from /arenas: same-origin referrer but no back target.
    expect(canNavigateBack({
      sameOriginReferrer: true,
      historyLength: 1,
      baseline: 1,
    })).toBe(false);
  });

  it('returns false for a deep link / external entry (no referrer, no growth)', () => {
    expect(canNavigateBack({
      sameOriginReferrer: false,
      historyLength: 1,
      baseline: 1,
    })).toBe(false);
  });

  it('returns false when entering from an external site (length 2 but no in-app push)', () => {
    // Search engine → /arena/X: history.length 2, baseline 2, external referrer.
    // Must NOT back() out to the search engine.
    expect(canNavigateBack({
      sameOriginReferrer: false,
      historyLength: 2,
      baseline: 2,
    })).toBe(false);
  });
});
