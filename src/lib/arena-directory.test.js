import { describe, it, expect } from 'vitest';
import { resolveDirectoryPage, ARENAS_PER_PAGE } from './arena-directory';

/**
 * `?page=` is user input that becomes a Prisma `skip`, so the interesting cases
 * are the hostile ones: a negative page is a query error, an absurd one is a
 * blank directory.
 */
describe('resolveDirectoryPage', () => {
  it('defaults to the first page', () => {
    const p = resolveDirectoryPage({ total: 30, page: undefined, pageSize: 12 });
    expect(p).toMatchObject({ page: 1, skip: 0, take: 12, from: 1, to: 12, hasPrev: false, hasNext: true });
  });

  it('offsets by whole pages', () => {
    expect(resolveDirectoryPage({ total: 30, page: '2', pageSize: 12 })).toMatchObject({
      page: 2,
      skip: 12,
      from: 13,
      to: 24,
      hasPrev: true,
      hasNext: true,
    });
  });

  it('reports a short last page and no next link', () => {
    expect(resolveDirectoryPage({ total: 30, page: '3', pageSize: 12 })).toMatchObject({
      page: 3,
      skip: 24,
      from: 25,
      to: 30,
      hasNext: false,
    });
  });

  it.each([
    ['above the last page', '99'],
    ['not a number', 'abc'],
    ['negative', '-3'],
    ['zero', '0'],
    ['empty', ''],
  ])('clamps a %s page into range', (_label, page) => {
    const p = resolveDirectoryPage({ total: 30, page, pageSize: 12 });
    expect(p.page).toBeGreaterThanOrEqual(1);
    expect(p.page).toBeLessThanOrEqual(p.pageCount);
    expect(p.skip).toBeGreaterThanOrEqual(0);
  });

  it('clamps an over-range page to the last one rather than erroring', () => {
    // A stale bookmark should show the end of the list, not a blank grid.
    expect(resolveDirectoryPage({ total: 30, page: '99', pageSize: 12 })).toMatchObject({
      page: 3,
      hasNext: false,
      to: 30,
    });
  });

  it('stays on a single, empty page when nothing matches', () => {
    expect(resolveDirectoryPage({ total: 0, page: '4', pageSize: 12 })).toMatchObject({
      page: 1,
      pageCount: 1,
      skip: 0,
      from: 0,
      to: 0,
      hasPrev: false,
      hasNext: false,
    });
  });

  it('hides paging when everything fits', () => {
    const p = resolveDirectoryPage({ total: ARENAS_PER_PAGE, page: '1' });
    expect(p.pageCount).toBe(1);
    expect(p.hasPrev).toBe(false);
    expect(p.hasNext).toBe(false);
  });

  it('survives a nonsense page size', () => {
    expect(resolveDirectoryPage({ total: 5, page: '1', pageSize: 0 }).take).toBe(1);
  });
});
