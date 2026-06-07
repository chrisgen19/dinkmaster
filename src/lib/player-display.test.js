import { describe, it, expect } from 'vitest';
import { formatShortName, profileHref, filterPlayersByName } from './player-display';

describe('formatShortName', () => {
  it('returns Unknown for null / undefined', () => {
    expect(formatShortName(null)).toEqual({ display: 'Unknown', full: 'Unknown' });
    expect(formatShortName(undefined)).toEqual({ display: 'Unknown', full: 'Unknown' });
  });

  it('uses first word of firstName + last-name initial', () => {
    expect(formatShortName({ firstName: 'Christian Genesis', lastName: 'Diomampo' })).toEqual({
      display: 'Christian D.',
      full: 'Christian Genesis Diomampo',
    });
    expect(formatShortName({ firstName: 'Mary Jane', lastName: 'Watson' })).toEqual({
      display: 'Mary W.',
      full: 'Mary Jane Watson',
    });
  });

  it('returns just the first word when there is no last name', () => {
    expect(formatShortName({ firstName: 'Ace', lastName: null })).toEqual({
      display: 'Ace',
      full: 'Ace',
    });
    expect(formatShortName({ firstName: 'Ace' })).toEqual({
      display: 'Ace',
      full: 'Ace',
    });
    expect(formatShortName({ firstName: 'Ace', lastName: '' })).toEqual({
      display: 'Ace',
      full: 'Ace',
    });
  });

  it('trims whitespace in both fields', () => {
    expect(formatShortName({ firstName: '  Mary Jane  ', lastName: '  Watson  ' })).toEqual({
      display: 'Mary W.',
      full: 'Mary Jane Watson',
    });
  });

  it('falls back to Unknown when firstName is missing', () => {
    expect(formatShortName({ lastName: 'Smith' })).toEqual({
      display: 'Unknown S.',
      full: 'Unknown Smith',
    });
  });
});

describe('profileHref', () => {
  const member = { viewerUserId: 'u-viewer', viewerIsMember: true };

  it("links the viewer's own account to /profile", () => {
    expect(profileHref({ userId: 'u-viewer', playerId: 'p-1' }, member)).toBe('/profile');
  });

  it('links another registered user to /u/<userId> for member viewers', () => {
    expect(profileHref({ userId: 'u-other', playerId: 'p-1' }, member)).toBe('/u/u-other');
  });

  it('links a walk-in (no account) to /p/<playerId> for member viewers', () => {
    expect(profileHref({ userId: null, playerId: 'p-1' }, member)).toBe('/p/p-1');
  });

  it('returns null for non-member viewers (other users and walk-ins)', () => {
    const spectator = { viewerUserId: 'u-viewer', viewerIsMember: false };
    expect(profileHref({ userId: 'u-other' }, spectator)).toBeNull();
    expect(profileHref({ userId: null, playerId: 'p-1' }, spectator)).toBeNull();
  });

  it('still links self to /profile even when the viewer is not a member', () => {
    expect(
      profileHref({ userId: 'u-viewer' }, { viewerUserId: 'u-viewer', viewerIsMember: false }),
    ).toBe('/profile');
  });

  it('returns null when there is no target id at all', () => {
    expect(profileHref({}, member)).toBeNull();
    expect(profileHref(undefined, member)).toBeNull();
  });

  it('returns null for a signed-out viewer', () => {
    expect(profileHref({ userId: 'u-other' }, { viewerUserId: null, viewerIsMember: false })).toBeNull();
  });
});

describe('filterPlayersByName', () => {
  const players = [
    { id: 'p1', firstName: 'Leah', lastName: 'RC' },
    { id: 'p2', firstName: 'Aljomar', lastName: 'D.' },
    { id: 'p3', firstName: 'Tina', lastName: null },
    { id: 'p4', firstName: 'Christian Genesis', lastName: 'Diomampo' },
  ];
  const ids = (result) => result.map((p) => p.id);

  it('passes everyone through on an empty or blank query', () => {
    expect(filterPlayersByName(players, '')).toBe(players);
    expect(filterPlayersByName(players, '   ')).toBe(players);
    expect(filterPlayersByName(players, undefined)).toBe(players);
  });

  it('matches case-insensitively on any part of the name', () => {
    expect(ids(filterPlayersByName(players, 'leah'))).toEqual(['p1']);
    expect(ids(filterPlayersByName(players, 'RC'))).toEqual(['p1']);
    expect(ids(filterPlayersByName(players, 'tin'))).toEqual(['p3']);
  });

  it('requires every token to match ("le r" → Leah RC)', () => {
    expect(ids(filterPlayersByName(players, 'le r'))).toEqual(['p1']);
    expect(ids(filterPlayersByName(players, 'genesis dio'))).toEqual(['p4']);
    expect(ids(filterPlayersByName(players, 'leah zzz'))).toEqual([]);
  });

  it('handles null lastName and missing fields without throwing', () => {
    expect(ids(filterPlayersByName(players, 'tina'))).toEqual(['p3']);
    expect(filterPlayersByName([{ id: 'x' }], 'anything')).toEqual([]);
  });
});
