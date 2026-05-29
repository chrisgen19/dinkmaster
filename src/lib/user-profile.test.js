import { describe, it, expect } from 'vitest';
import {
  normalizeUserProfile,
  normalizeProfileUpdate,
  deriveNameParts,
  REQUIRED_PROFILE_FIELDS,
  OPTIONAL_PROFILE_FIELDS,
  GENDER_OPTIONS,
} from '@/lib/user-profile';

/** A well-formed payload with deliberate surrounding whitespace to exercise trimming. */
const validPayload = () => ({
  name: 'stale name',
  email: 'jane@example.com',
  firstName: '  Jane  ',
  lastName: ' Doe ',
  phone: ' 09171234567 ',
  address: ' 1 Test St ',
  gender: 'Female',
  birthday: '1990-01-01T00:00:00.000Z',
});

describe('normalizeUserProfile — registration profile contract', () => {
  it('trims fields and recomputes name from first/last', () => {
    const result = normalizeUserProfile(validPayload());
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '09171234567',
      address: '1 Test St',
      gender: 'Female',
      name: 'Jane Doe',
    });
  });

  it('coerces an ISO birthday string to a valid Date', () => {
    const result = normalizeUserProfile(validPayload());
    expect(result.data.birthday).toBeInstanceOf(Date);
    expect(result.data.birthday.toISOString()).toBe('1990-01-01T00:00:00.000Z');
  });

  it('accepts a birthday that is already a Date', () => {
    const result = normalizeUserProfile({ ...validPayload(), birthday: new Date('1985-06-15') });
    expect(result.error).toBeUndefined();
    expect(result.data.birthday).toBeInstanceOf(Date);
  });

  it.each(REQUIRED_PROFILE_FIELDS)('rejects a whitespace-only %s', (field) => {
    const result = normalizeUserProfile({ ...validPayload(), [field]: '   ' });
    expect(result.data).toBeUndefined();
    expect(result.error).toContain(field);
  });

  it.each(REQUIRED_PROFILE_FIELDS)('rejects a missing %s', (field) => {
    const payload = validPayload();
    delete payload[field];
    const result = normalizeUserProfile(payload);
    expect(result.data).toBeUndefined();
    expect(result.error).toContain(field);
  });

  it('rejects a provided but unparseable birthday', () => {
    const result = normalizeUserProfile({ ...validPayload(), birthday: 'not-a-date' });
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/birthday/i);
  });

  describe('optional fields', () => {
    /** Only the required fields present — the minimal valid sign-up. */
    const minimalPayload = () => ({
      name: 'stale name',
      email: 'min@example.com',
      firstName: 'Min',
      lastName: 'User',
    });

    it('succeeds with only first/last name supplied', () => {
      const result = normalizeUserProfile(minimalPayload());
      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({ name: 'Min User' });
    });

    it.each(OPTIONAL_PROFILE_FIELDS)('normalizes a missing %s to null', (field) => {
      const result = normalizeUserProfile(minimalPayload());
      expect(result.data[field]).toBeNull();
    });

    it.each(OPTIONAL_PROFILE_FIELDS)('normalizes a whitespace-only %s to null', (field) => {
      const result = normalizeUserProfile({ ...minimalPayload(), [field]: '   ' });
      expect(result.error).toBeUndefined();
      expect(result.data[field]).toBeNull();
    });

    it.each([null, undefined, ''])('normalizes a blank birthday (%s) to null', (birthday) => {
      const result = normalizeUserProfile({ ...minimalPayload(), birthday });
      expect(result.error).toBeUndefined();
      expect(result.data.birthday).toBeNull();
    });

    it.each(GENDER_OPTIONS)('accepts the known gender option %s', (gender) => {
      const result = normalizeUserProfile({ ...minimalPayload(), gender });
      expect(result.error).toBeUndefined();
      expect(result.data.gender).toBe(gender);
    });

    it('rejects a gender outside the allowlist', () => {
      const result = normalizeUserProfile({ ...minimalPayload(), gender: 'Wizard' });
      expect(result.data).toBeUndefined();
      expect(result.error).toMatch(/gender/i);
    });
  });

  describe('lenient mode (social sign-ups)', () => {
    /** Minimal social payload — a single name token, no last name. */
    const socialPayload = (overrides = {}) => ({
      name: 'stale',
      email: 'social@example.com',
      firstName: 'Madonna',
      lastName: '',
      ...overrides,
    });

    it('tolerates an empty last name and trims the name', () => {
      const result = normalizeUserProfile(socialPayload(), { requireNames: false });
      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({ firstName: 'Madonna', lastName: '', name: 'Madonna' });
    });

    it('still trims first/last when both present', () => {
      const result = normalizeUserProfile(
        socialPayload({ firstName: ' Jane ', lastName: ' Doe ' }),
        { requireNames: false },
      );
      expect(result.data).toMatchObject({ firstName: 'Jane', lastName: 'Doe', name: 'Jane Doe' });
    });

    it('keeps the strict guard by default (requireNames omitted)', () => {
      const result = normalizeUserProfile(socialPayload());
      expect(result.data).toBeUndefined();
      expect(result.error).toContain('lastName');
    });

    it('falls back a blank first name to the email local-part', () => {
      const result = normalizeUserProfile(
        { name: '', email: 'jdoe@example.com', firstName: '', lastName: '' },
        { requireNames: false },
      );
      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({ firstName: 'jdoe', lastName: '', name: 'jdoe' });
    });

    it('falls back to "Player" when neither a name nor an email is available', () => {
      const result = normalizeUserProfile(
        { name: '', email: '', firstName: '', lastName: '' },
        { requireNames: false },
      );
      expect(result.error).toBeUndefined();
      expect(result.data).toMatchObject({ firstName: 'Player', name: 'Player' });
    });
  });
});

describe('normalizeProfileUpdate — partial self-service update contract', () => {
  it('trims first/last and recomputes name when both are present', () => {
    const result = normalizeProfileUpdate({ firstName: '  Jane  ', lastName: ' Doe ' });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ firstName: 'Jane', lastName: 'Doe', name: 'Jane Doe' });
  });

  it('does not recompute name when only one name half is present', () => {
    const result = normalizeProfileUpdate({ firstName: 'Jane' });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ firstName: 'Jane' });
    expect('name' in result.data).toBe(false);
  });

  it('only returns the fields present in the payload (no blanking absentees)', () => {
    const result = normalizeProfileUpdate({ phone: ' 0917 ' });
    expect(result.data).toEqual({ phone: '0917' });
  });

  it('returns an empty object for a payload with no profile fields', () => {
    // e.g. an internal update touching emailVerified — must pass through clean.
    const result = normalizeProfileUpdate({ emailVerified: true });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({});
  });

  it.each(REQUIRED_PROFILE_FIELDS)('rejects a present-but-whitespace %s', (field) => {
    const result = normalizeProfileUpdate({ [field]: '   ' });
    expect(result.data).toBeUndefined();
    expect(result.error).toContain(field);
  });

  it.each(OPTIONAL_PROFILE_FIELDS.filter((f) => f !== 'gender'))(
    'normalizes a present-but-blank %s to null',
    (field) => {
      const result = normalizeProfileUpdate({ [field]: '   ' });
      expect(result.data[field]).toBeNull();
    },
  );

  it('rejects a gender outside the allowlist', () => {
    const result = normalizeProfileUpdate({ gender: 'Wizard' });
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/gender/i);
  });

  it('normalizes a blank gender to null', () => {
    const result = normalizeProfileUpdate({ gender: '' });
    expect(result.error).toBeUndefined();
    expect(result.data.gender).toBeNull();
  });

  it.each([null, ''])('normalizes a blank birthday (%s) to null', (birthday) => {
    const result = normalizeProfileUpdate({ birthday });
    expect(result.error).toBeUndefined();
    expect(result.data.birthday).toBeNull();
  });

  it('coerces a valid birthday string to a Date and rejects a bad one', () => {
    expect(normalizeProfileUpdate({ birthday: '1990-01-01' }).data.birthday).toBeInstanceOf(Date);
    const bad = normalizeProfileUpdate({ birthday: 'not-a-date' });
    expect(bad.data).toBeUndefined();
    expect(bad.error).toMatch(/birthday/i);
  });
});

describe('deriveNameParts — OAuth name mapping', () => {
  it('prefers explicit first/last and trims them', () => {
    expect(deriveNameParts({ firstName: ' Jane ', lastName: ' Doe ', name: 'ignored' })).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
    });
  });

  it('splits the full name when no structured parts are given', () => {
    expect(deriveNameParts({ name: 'Jane Mary Doe' })).toEqual({
      firstName: 'Jane',
      lastName: 'Mary Doe',
    });
  });

  it('backfills only the missing part from the full name', () => {
    expect(deriveNameParts({ firstName: 'Jane', name: 'Jane Doe' })).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
    });
  });

  it('returns an empty last name for a mononymous profile', () => {
    expect(deriveNameParts({ name: 'Madonna' })).toEqual({ firstName: 'Madonna', lastName: '' });
  });

  it('returns empty strings when nothing usable is supplied', () => {
    expect(deriveNameParts({})).toEqual({ firstName: '', lastName: '' });
    expect(deriveNameParts()).toEqual({ firstName: '', lastName: '' });
    expect(deriveNameParts({ name: '   ' })).toEqual({ firstName: '', lastName: '' });
  });
});
