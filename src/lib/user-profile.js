/**
 * Required text fields collected at sign-up. Each must be a present,
 * non-whitespace string before a user row is persisted.
 */
export const REQUIRED_PROFILE_FIELDS = ['firstName', 'lastName'];

/**
 * Optional text fields collected under "Add more details" on the register
 * form. When present they're trimmed; blank/whitespace-only values normalize
 * to `null` so the nullable columns stay clean rather than storing "".
 */
export const OPTIONAL_PROFILE_FIELDS = ['phone', 'address', 'gender'];

/**
 * Accepted values for the optional `gender` field. Single source of truth,
 * shared with the register form's <select>, and enforced server-side so a
 * direct API call can't persist an arbitrary string.
 */
export const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];

/**
 * Validate and normalize the profile fields on a user-create payload.
 *
 * Trims the required first/last name (rejecting whitespace-only values) and
 * recomputes `name` as "First Last". Optional text fields are trimmed when
 * present and coerced to `null` when blank. `birthday` is optional: absent or
 * blank normalizes to `null`, but a present value must parse to a valid Date.
 * Pure and side-effect free, so it can be unit tested directly and reused by
 * the Better Auth `databaseHooks.user.create.before` hook — the server-side
 * counterpart to the register form's client-side checks.
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

  // Optional text fields: trim when present, drop blanks to null.
  for (const field of OPTIONAL_PROFILE_FIELDS) {
    const value = typeof normalized[field] === 'string' ? normalized[field].trim() : '';
    normalized[field] = value || null;
  }

  // When a gender is provided, it must be one of the known options — the UI
  // restricts this, but a direct API call could otherwise persist any string.
  if (normalized.gender !== null && !GENDER_OPTIONS.includes(normalized.gender)) {
    return { error: 'Please choose a valid gender option.' };
  }

  // Optional birthday: blank/absent → null. A provided value must be a valid
  // Date. `new Date(null)` is the epoch (a valid Date), so guard nullish first.
  const rawBirthday = normalized.birthday;
  if (rawBirthday === null || rawBirthday === undefined || rawBirthday === '') {
    normalized.birthday = null;
  } else {
    const birthday = rawBirthday instanceof Date ? rawBirthday : new Date(rawBirthday);
    if (Number.isNaN(birthday.getTime())) {
      return { error: 'Please enter a valid birthday.' };
    }
    normalized.birthday = birthday;
  }

  return { data: normalized };
}
