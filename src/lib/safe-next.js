/**
 * Validate a `?next=<path>` parameter as a safe same-origin redirect target.
 *
 * Returns the path unchanged if it is a single-slash, same-origin path; falls
 * back to `/arenas` otherwise. Protocol-relative URLs (`//evil.com`) and
 * backslash-tricks (`/\evil`) are rejected, including their percent-encoded
 * forms — we decode once before re-validating, so an attacker can't smuggle
 * `//evil.com` through `?next=/%2fevil.com` even if a future caller starts
 * sourcing the value from somewhere that isn't already decoded.
 *
 * `useSearchParams().get()` already decodes once, so the explicit decode below
 * is defense-in-depth: cheap, and the only place we need to get this right.
 */
export function safeNext(raw, fallback = '/arenas') {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;

  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding — refuse rather than guess.
    return fallback;
  }

  if (!path.startsWith('/')) return fallback;
  if (path.startsWith('//') || path.startsWith('/\\')) return fallback;
  return path;
}
