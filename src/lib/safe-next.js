/**
 * Validate a `?next=<path>` parameter as a safe same-origin redirect target.
 *
 * Returns the path unchanged if it is a single-slash, same-origin path; falls
 * back to `/arenas` otherwise. Protocol-relative URLs (`//evil.com`) and
 * backslash-tricks (`/\evil`) are rejected, including their percent-encoded
 * and *double-encoded* forms (`/%2fevil.com`, `/%252f%252fevil.com`). We
 * decode in a fixed-cap loop until the string is stable so a future code path
 * that decodes again downstream can't resurrect `//evil.com`.
 *
 * `useSearchParams().get()` already decodes once, so the loop is
 * defense-in-depth: cheap, and the only place we need to get this right.
 */
const MAX_DECODE_PASSES = 5;

export function safeNext(raw, fallback = '/arenas') {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;

  let path = raw;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // Malformed percent-encoding — refuse rather than guess.
      return fallback;
    }
    if (decoded === path) break;
    path = decoded;
  }

  if (!path.startsWith('/')) return fallback;
  if (path.startsWith('//') || path.startsWith('/\\')) return fallback;
  return path;
}
