import { describe, it, expect } from 'vitest';
import { canNavigateBack, isSameOriginReferrer, shouldResetNavBaseline } from './nav-back';

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

describe('isSameOriginReferrer()', () => {
  const origin = 'https://example.com';

  it('returns true for an exact same-origin referrer', () => {
    expect(isSameOriginReferrer('https://example.com/foo', origin)).toBe(true);
  });

  it('returns false for a lookalike host that shares a prefix', () => {
    // The original bug: startsWith(origin) let this through.
    expect(isSameOriginReferrer('https://example.com.evil.tld/x', origin)).toBe(false);
  });

  it('returns false when the scheme differs (http vs https)', () => {
    expect(isSameOriginReferrer('http://example.com/foo', origin)).toBe(false);
  });

  it('returns false for a completely different host', () => {
    expect(isSameOriginReferrer('https://evil.com/foo', origin)).toBe(false);
  });

  it('returns false for an empty referrer string', () => {
    expect(isSameOriginReferrer('', origin)).toBe(false);
  });

  it('returns false for non-string referrers', () => {
    expect(isSameOriginReferrer(undefined, origin)).toBe(false);
    expect(isSameOriginReferrer(null, origin)).toBe(false);
  });

  it('returns false for a malformed URL', () => {
    expect(isSameOriginReferrer('not a url', origin)).toBe(false);
  });
});

describe('shouldResetNavBaseline()', () => {
  it('resets on first run when no baseline is stored yet', () => {
    expect(shouldResetNavBaseline({ navigationType: 'navigate', hasStoredBaseline: false })).toBe(true);
    expect(shouldResetNavBaseline({ navigationType: 'reload', hasStoredBaseline: false })).toBe(true);
    expect(shouldResetNavBaseline({ navigationType: 'back_forward', hasStoredBaseline: false })).toBe(true);
  });

  it('resets on a fresh navigation even when a stale baseline exists', () => {
    // The original bug: typed URL after an external detour in the same tab
    // kept a stale low baseline and let history.length look "grown".
    expect(shouldResetNavBaseline({ navigationType: 'navigate', hasStoredBaseline: true })).toBe(true);
  });

  it('preserves the baseline on a reload', () => {
    expect(shouldResetNavBaseline({ navigationType: 'reload', hasStoredBaseline: true })).toBe(false);
  });

  it('preserves the baseline on back/forward navigation', () => {
    expect(shouldResetNavBaseline({ navigationType: 'back_forward', hasStoredBaseline: true })).toBe(false);
  });

  it('treats undefined navigationType as fresh (legacy browser safe default)', () => {
    expect(shouldResetNavBaseline({ navigationType: undefined, hasStoredBaseline: true })).toBe(true);
  });
});
