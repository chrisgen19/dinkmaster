import { describe, it, expect } from 'vitest';
import { deriveRackRow, fullName, initials, ON_DECK_SIZE } from './paddle-rack-stack-state';

const opts = { viewerUserId: 'u-me', starveThreshold: 2, emergencyWait: 4 };
const player = (over = {}) => ({
  id: 'p1',
  userId: 'u-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  waitRounds: 0,
  ...over,
});

describe('fullName', () => {
  it('joins first and last name', () => {
    expect(fullName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
  });
  it('uses first name alone when last name is missing', () => {
    expect(fullName({ firstName: 'Ada', lastName: null })).toBe('Ada');
  });
  it('falls back to Unknown for malformed rows', () => {
    expect(fullName(null)).toBe('Unknown');
    expect(fullName({})).toBe('Unknown');
  });
});

describe('initials', () => {
  it('takes first letter of first and last name, uppercased', () => {
    expect(initials({ firstName: 'ada', lastName: 'lovelace' })).toBe('AL');
  });
  it('uses just the first initial when no last name', () => {
    expect(initials({ firstName: 'Ada', lastName: null })).toBe('A');
  });
  it('falls back to "?" when nothing usable', () => {
    expect(initials(null)).toBe('?');
    expect(initials({})).toBe('?');
  });
});

describe('deriveRackRow — rank + on-deck boundary', () => {
  it('rank is the 1-based queue position', () => {
    expect(deriveRackRow(player(), 0, opts).rank).toBe(1);
    expect(deriveRackRow(player(), 7, opts).rank).toBe(8);
  });

  it(`marks the first ${ON_DECK_SIZE} as on deck and the rest as waiting`, () => {
    for (let i = 0; i < ON_DECK_SIZE; i++) {
      expect(deriveRackRow(player(), i, opts).isOnDeck).toBe(true);
    }
    // index === ON_DECK_SIZE is the first waiting row (the boundary)
    expect(deriveRackRow(player(), ON_DECK_SIZE, opts).isOnDeck).toBe(false);
    expect(deriveRackRow(player(), ON_DECK_SIZE + 3, opts).isOnDeck).toBe(false);
  });
});

describe('deriveRackRow — you / walk-in flags', () => {
  it('flags the viewer\'s own row', () => {
    expect(deriveRackRow(player({ userId: 'u-me' }), 0, opts).isYou).toBe(true);
    expect(deriveRackRow(player({ userId: 'u-1' }), 0, opts).isYou).toBe(false);
  });
  it('flags accountless rows as walk-ins (and never "you")', () => {
    const row = deriveRackRow(player({ userId: null }), 0, opts);
    expect(row.isWalkIn).toBe(true);
    expect(row.isYou).toBe(false);
  });
  it('a linked player is not a walk-in', () => {
    expect(deriveRackRow(player({ userId: 'u-1' }), 0, opts).isWalkIn).toBe(false);
  });
});

describe('deriveRackRow — wait badge severity', () => {
  it('no badge below the starve threshold', () => {
    expect(deriveRackRow(player({ waitRounds: 0 }), 0, opts).badge).toBe('none');
    expect(deriveRackRow(player({ waitRounds: 1 }), 0, opts).badge).toBe('none');
  });
  it('warn at the starve threshold (inclusive), below emergency', () => {
    expect(deriveRackRow(player({ waitRounds: 2 }), 0, opts).badge).toBe('warn');
    expect(deriveRackRow(player({ waitRounds: 3 }), 0, opts).badge).toBe('warn');
  });
  it('emergency at the emergency threshold (inclusive)', () => {
    expect(deriveRackRow(player({ waitRounds: 4 }), 0, opts).badge).toBe('emergency');
    expect(deriveRackRow(player({ waitRounds: 9 }), 0, opts).badge).toBe('emergency');
  });
  it('defaults waitRounds to 0 for malformed rows', () => {
    expect(deriveRackRow({ userId: 'u-1' }, 0, opts).waitRounds).toBe(0);
    expect(deriveRackRow({ userId: 'u-1' }, 0, opts).badge).toBe('none');
  });
  it('skipBoosted wins over every wait-based badge', () => {
    // Even at zero wait, a returning skipper shows next-line.
    expect(deriveRackRow(player({ waitRounds: 0, skipBoosted: true }), 0, opts).badge).toBe('next-line');
    // And the wait-based bands are suppressed in favor of next-line.
    expect(deriveRackRow(player({ waitRounds: 9, skipBoosted: true }), 0, opts).badge).toBe('next-line');
  });
});

describe('deriveRackRow — canSkip gating', () => {
  const skipOpts = { ...opts, canManage: false, queueLength: 8 };

  it('managers can skip any on-deck paddle', () => {
    const row = deriveRackRow(player({ userId: 'u-other' }), 1, { ...skipOpts, canManage: true });
    expect(row.canSkip).toBe(true);
  });

  it('a member can skip their own on-deck paddle (self-service)', () => {
    const row = deriveRackRow(player({ userId: 'u-me' }), 1, { ...skipOpts, canManage: false });
    expect(row.isYou).toBe(true);
    expect(row.canSkip).toBe(true);
  });

  it('a non-manager cannot skip someone else\'s paddle', () => {
    const row = deriveRackRow(player({ userId: 'u-other' }), 1, { ...skipOpts, canManage: false });
    expect(row.canSkip).toBe(false);
  });

  it('waiting (off-deck) paddles cannot skip, even for a manager', () => {
    const row = deriveRackRow(player({ userId: 'u-me' }), ON_DECK_SIZE, { ...skipOpts, canManage: true });
    expect(row.isOnDeck).toBe(false);
    expect(row.canSkip).toBe(false);
  });

  it('no skip when nobody waits behind the on-deck group (queueLength <= ON_DECK_SIZE)', () => {
    const row = deriveRackRow(player({ userId: 'u-me' }), 0, { ...skipOpts, canManage: true, queueLength: ON_DECK_SIZE });
    expect(row.canSkip).toBe(false);
  });

  it('defaults (no canManage/queueLength) yield canSkip false', () => {
    expect(deriveRackRow(player({ userId: 'u-me' }), 0, opts).canSkip).toBe(false);
  });
});

describe('deriveRackRow — profileHref (name → profile link)', () => {
  it('own row links to /profile regardless of membership', () => {
    expect(deriveRackRow(player({ userId: 'u-me' }), 0, opts).profileHref).toBe('/profile');
  });

  it('another registered player links to /u/[userId] only for a member', () => {
    expect(
      deriveRackRow(player({ userId: 'u-1' }), 0, { ...opts, viewerIsMember: true }).profileHref,
    ).toBe('/u/u-1');
    // Non-member (spectator) gets no link — they share no arena, would 404.
    expect(deriveRackRow(player({ userId: 'u-1' }), 0, { ...opts, viewerIsMember: false }).profileHref).toBeNull();
  });

  it('a walk-in links to /p/[playerId] only for a member', () => {
    expect(
      deriveRackRow(player({ id: 'p9', userId: null }), 0, { ...opts, viewerIsMember: true }).profileHref,
    ).toBe('/p/p9');
    expect(deriveRackRow(player({ userId: null }), 0, { ...opts, viewerIsMember: false }).profileHref).toBeNull();
  });

  it('defaults to no link when viewerIsMember is omitted', () => {
    expect(deriveRackRow(player({ userId: 'u-1' }), 0, opts).profileHref).toBeNull();
    expect(deriveRackRow(player({ userId: null }), 0, opts).profileHref).toBeNull();
  });
});
