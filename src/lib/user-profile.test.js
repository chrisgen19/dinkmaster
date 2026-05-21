import { describe, it, expect } from 'vitest';
import { normalizeUserProfile, REQUIRED_PROFILE_FIELDS } from '@/lib/user-profile';

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
  it('trims required text fields and recomputes name from first/last', () => {
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

  it.each([null, undefined, '', 'not-a-date'])('rejects an invalid birthday (%s)', (birthday) => {
    const result = normalizeUserProfile({ ...validPayload(), birthday });
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/birthday/i);
  });
});
