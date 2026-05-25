import { describe, it, expect } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext()', () => {
  it('returns the fallback for null, undefined, and empty input', () => {
    expect(safeNext(null)).toBe('/arenas');
    expect(safeNext(undefined)).toBe('/arenas');
    expect(safeNext('')).toBe('/arenas');
  });

  it('honors a custom fallback', () => {
    expect(safeNext(null, '/')).toBe('/');
    expect(safeNext('//evil.com', '/')).toBe('/');
  });

  it('returns a same-origin path unchanged', () => {
    expect(safeNext('/arenas/new')).toBe('/arenas/new');
    expect(safeNext('/arena/abc123')).toBe('/arena/abc123');
    expect(safeNext('/profile?tab=stats')).toBe('/profile?tab=stats');
  });

  it.each([
    ['absolute URL', 'https://evil.com'],
    ['scheme-relative protocol-relative', '//evil.com'],
    ['backslash-trick', '/\\evil.com'],
    ['non-slash leading char', 'arenas/new'],
    ['just a query string', '?next=/arenas'],
    ['percent-encoded protocol-relative', '/%2fevil.com'],
    ['mixed-case percent-encoded protocol-relative', '/%2Fevil.com'],
    ['percent-encoded backslash', '/%5cevil.com'],
    ['double-encoded protocol-relative', '/%252f%252fevil.com'],
    ['triple-encoded protocol-relative', '/%25252f%25252fevil.com'],
    ['malformed percent-encoding', '/%E0%A4%A'],
  ])('rejects %s and returns the fallback', (_label, input) => {
    expect(safeNext(input)).toBe('/arenas');
  });

  it('rejects non-string input types', () => {
    expect(safeNext(123)).toBe('/arenas');
    expect(safeNext({ next: '/arenas' })).toBe('/arenas');
    expect(safeNext(['/arenas'])).toBe('/arenas');
  });
});
