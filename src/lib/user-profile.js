/**
 * Required text fields collected at sign-up. Each must be a present,
 * non-whitespace string before a user row is persisted.
 */
export const REQUIRED_PROFILE_FIELDS = ['firstName', 'lastName', 'phone', 'address', 'gender'];

/**
 * Validate and normalize the profile fields on a user-create payload.
 *
 * Trims every required text field, rejects whitespace-only values, recomputes
 * `name` as "First Last" from the trimmed parts, and coerces `birthday` to a
 * valid Date. Pure and side-effect free, so it can be unit tested directly and
 * reused by the Better Auth `databaseHooks.user.create.before` hook — the
 * server-side counterpart to the register form's client-side checks.
 *
 * @param {Record<string, unknown>} data - the user-create payload
 * @returns {{data: Record<string, unknown>} | {error: string}}
 */
export function normalizeUserProfile(data) {
  const normalized = { ...data };

  for (const field of REQUIRED_PROFILE_FIELDS) {
    const value = typeof normalized[field] === 'string' ? normalized[field].trim() : '';
    if (!value) return { error: `${field} is required.` };
    normalized[field] = value;
  }

  // Keep Better Auth's core `name` consistent with the trimmed first/last name.
  normalized.name = `${normalized.firstName} ${normalized.lastName}`;

  // Reject empty/null up front: `new Date(null)` is the epoch (a valid Date),
  // which would otherwise slip a missing birthday through.
  const rawBirthday = normalized.birthday;
  if (rawBirthday === null || rawBirthday === undefined || rawBirthday === '') {
    return { error: 'A valid birthday is required.' };
  }
  const birthday = rawBirthday instanceof Date ? rawBirthday : new Date(rawBirthday);
  if (Number.isNaN(birthday.getTime())) {
    return { error: 'A valid birthday is required.' };
  }
  normalized.birthday = birthday;

  return { data: normalized };
}
