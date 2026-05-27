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
 * `requireNames` defaults to `true` for the email/password path (the register
 * form guarantees first/last, and the guard stops a direct `/sign-up/email`
 * call from persisting empty names). Social sign-ups pass `false`: the
 * provider's name fields are mapped via `deriveNameParts`, but we don't reject
 * an OAuth user when a provider only supplies a single name — the field is
 * still trimmed and `name` recomputed.
 *
 * @param {Record<string, unknown>} data - the user-create payload
 * @param {{ requireNames?: boolean }} [options]
 * @returns {{data: Record<string, unknown>} | {error: string}}
 */
export function normalizeUserProfile(data, { requireNames = true } = {}) {
  const normalized = { ...data };

  for (const field of REQUIRED_PROFILE_FIELDS) {
    const value = typeof normalized[field] === 'string' ? normalized[field].trim() : '';
    if (requireNames && !value) return { error: `${field} is required.` };
    normalized[field] = value;
  }

  // Lenient (social) floor: a provider can omit names entirely, which would
  // otherwise persist a blank-named user (empty display name, "?" monogram).
  // Guarantee a non-empty first name — fall back to the email local-part, then
  // a neutral placeholder. Strict mode already rejected empties above, so this
  // only affects social sign-ups.
  if (!requireNames && !normalized.firstName) {
    const emailLocal =
      typeof normalized.email === 'string' ? normalized.email.split('@')[0].trim() : '';
    normalized.firstName = emailLocal || 'Player';
  }

  // Keep Better Auth's core `name` consistent with the trimmed first/last name.
  // `.trim()` drops the trailing space when a social sign-up has no last name.
  normalized.name = `${normalized.firstName} ${normalized.lastName}`.trim();

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

/**
 * Best-effort first/last name for an OAuth sign-up. Providers expose names
 * differently — Google sends `given_name`/`family_name` plus a combined
 * `name`. Prefer the structured parts and backfill whichever is missing by
 * splitting the full `name` (first token → first name, the rest → last name).
 * Kept generic (not Google-specific) so a future provider can reuse it.
 *
 * Always returns trimmed strings. A mononymous profile (single token, no
 * structured last name) yields an empty `lastName`, which the social path
 * tolerates via `normalizeUserProfile(data, { requireNames: false })`.
 *
 * @param {{ firstName?: unknown, lastName?: unknown, name?: unknown }} [profile]
 * @returns {{ firstName: string, lastName: string }}
 */
export function deriveNameParts({ firstName, lastName, name } = {}) {
  let first = typeof firstName === 'string' ? firstName.trim() : '';
  let last = typeof lastName === 'string' ? lastName.trim() : '';

  if (!first || !last) {
    const tokens = typeof name === 'string' ? name.trim().split(/\s+/).filter(Boolean) : [];
    if (tokens.length > 0) {
      if (!first) first = tokens[0];
      if (!last) last = tokens.slice(1).join(' ');
    }
  }

  return { firstName: first, lastName: last };
}
