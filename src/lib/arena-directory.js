/**
 * Pure paging maths for the arena directory.
 *
 * The directory used to fetch every arena and split them in memory. It now
 * pages the public list in SQL (see `listPublicArenas`), which needs the page
 * number sanitised before it reaches a query: `?page=` is user input, and a
 * negative `skip` is a Prisma error while a wildly high one is a blank screen.
 */

/** Arenas per page of the public directory. */
export const ARENAS_PER_PAGE = 12;

/**
 * Resolve a requested page against a known total.
 *
 * Out-of-range requests CLAMP rather than 404: `?page=99` on a two-page
 * directory is a stale link or a typo, and showing the last page is more
 * useful than an error. Garbage (`?page=abc`, `?page=-3`) resolves to page 1.
 *
 * @param {object} input
 * @param {number} input.total - matching rows.
 * @param {string|number|undefined} input.page - the raw `?page=` value.
 * @param {number} [input.pageSize]
 * @returns {{page: number, pageCount: number, skip: number, take: number,
 *   from: number, to: number, hasPrev: boolean, hasNext: boolean}}
 *   `from`/`to` are 1-based inclusive for display, and `0` when nothing matched.
 */
export function resolveDirectoryPage({ total, page, pageSize = ARENAS_PER_PAGE }) {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(total) || 0);
  const pageCount = Math.max(1, Math.ceil(count / size));

  const requested = Number.parseInt(page, 10);
  const current = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pageCount) : 1;

  const skip = (current - 1) * size;
  return {
    page: current,
    pageCount,
    skip,
    take: size,
    from: count === 0 ? 0 : skip + 1,
    to: Math.min(skip + size, count),
    hasPrev: current > 1,
    hasNext: current < pageCount,
  };
}
