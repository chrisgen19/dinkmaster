import { describe, it, expect } from 'vitest';
import {
  normalizeUserProfile,
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
});
