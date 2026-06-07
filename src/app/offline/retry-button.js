'use client';

/**
 * Reloads the page the user was actually trying to reach (the offline page is
 * served as a fallback in place of that URL). A plain link to /arenas would just
 * re-hit the offline fallback, since authenticated routes aren't cached — a
 * reload succeeds as soon as the connection is back.
 */
export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800"
    >
      Try again
    </button>
  );
}
