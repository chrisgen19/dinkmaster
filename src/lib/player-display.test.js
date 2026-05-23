import { describe, it, expect } from 'vitest';
import { formatShortName } from './player-display';

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
