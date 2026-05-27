import { describe, it, expect } from 'vitest';
import { bandOf, DEFAULT_STARVE_THRESHOLD, DEFAULT_EMERGENCY_WAIT } from '@/lib/matchmaking';

const DEFAULTS = { starveThreshold: DEFAULT_STARVE_THRESHOLD, emergencyWait: DEFAULT_EMERGENCY_WAIT };

describe('bandOf', () => {
  it('returns fresh (0) for waits below the starve threshold', () => {
    expect(bandOf(0, DEFAULTS)).toBe(0);
    expect(bandOf(1, DEFAULTS)).toBe(0); // STARVE - 1
  });

  it('returns protected (1) at and above the starve threshold but below emergency', () => {
    expect(bandOf(2, DEFAULTS)).toBe(1); // STARVE
    expect(bandOf(3, DEFAULTS)).toBe(1); // EMERGENCY - 1
  });

  it('returns emergency (2) at and above the emergency wait', () => {
    expect(bandOf(4, DEFAULTS)).toBe(2); // EMERGENCY
    expect(bandOf(99, DEFAULTS)).toBe(2);
  });

  it('honours arena-specific thresholds — a wait that is "protected" under the defaults can be "fresh" under stricter ones', () => {
    const strict = { starveThreshold: 5, emergencyWait: 10 };
    // wait=3 is protected under defaults (2/4) but fresh under strict (5/10).
    expect(bandOf(3, DEFAULTS)).toBe(1);
    expect(bandOf(3, strict)).toBe(0);
  });

  it('honours arena-specific thresholds — a wait that is "fresh" under the defaults can be "emergency" under looser ones', () => {
    const loose = { starveThreshold: 1, emergencyWait: 1 };
    expect(bandOf(1, DEFAULTS)).toBe(0); // fresh under 2/4
    expect(bandOf(1, loose)).toBe(2); // emergency under 1/1 (collapsed bands)
  });

  it('collapses to emergency when starve equals emergency (no protected phase)', () => {
    const collapsed = { starveThreshold: 3, emergencyWait: 3 };
    expect(bandOf(2, collapsed)).toBe(0);
    expect(bandOf(3, collapsed)).toBe(2);
    expect(bandOf(4, collapsed)).toBe(2);
  });

  it('returns next-line (3) when skipBoosted, regardless of wait', () => {
    // skipBoosted wins over every wait-based band — even fresh.
    expect(bandOf(0, { ...DEFAULTS, skipBoosted: true })).toBe(3);
    // And it wins over an emergency wait too — a returning skipper sorts
    // above genuine emergency-band players (until the mix consumes the flag).
    expect(bandOf(99, { ...DEFAULTS, skipBoosted: true })).toBe(3);
  });

  it('skipBoosted=false is a no-op vs the wait-based bands', () => {
    expect(bandOf(0, { ...DEFAULTS, skipBoosted: false })).toBe(0);
    expect(bandOf(3, { ...DEFAULTS, skipBoosted: false })).toBe(1);
    expect(bandOf(4, { ...DEFAULTS, skipBoosted: false })).toBe(2);
  });
});
