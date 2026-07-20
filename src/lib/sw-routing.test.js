import { describe, it, expect } from 'vitest';
import {
  isApiRequest,
  isArenaPathname,
  isStaticAsset,
  isImageRequest,
  isFontRequest,
  isPublicNavigation,
  isNavigation,
} from './sw-routing';

/** Build the object Serwist hands a matcher. */
function ctx(pathname, { destination = '', mode = '', sameOrigin = true } = {}) {
  return {
    url: new URL(`https://app.test${pathname}`),
    request: { destination, mode },
    sameOrigin,
  };
}

describe('isApiRequest()', () => {
  it('matches every /api/* path (auth and otherwise)', () => {
    expect(isApiRequest(ctx('/api/auth/session'))).toBe(true);
    expect(isApiRequest(ctx('/api/anything'))).toBe(true);
  });

  it('matches /api image requests so they win over the image rule', () => {
    // An <img src="/api/..."> is destination "image" but must stay network-only.
    expect(isApiRequest(ctx('/api/avatar.png', { destination: 'image' }))).toBe(true);
  });

  it('ignores non-api paths', () => {
    expect(isApiRequest(ctx('/arenas'))).toBe(false);
  });
});

describe('isStaticAsset()', () => {
  it('matches hashed build assets', () => {
    expect(isStaticAsset(ctx('/_next/static/chunks/main.js'))).toBe(true);
  });
  it('ignores other paths', () => {
    expect(isStaticAsset(ctx('/_next/image'))).toBe(false);
  });
});

describe('isImageRequest()', () => {
  it('matches same-origin image requests', () => {
    expect(isImageRequest(ctx('/icons/icon-192.png', { destination: 'image' }))).toBe(true);
  });
  it('ignores cross-origin images (avoids caching opaque responses)', () => {
    expect(
      isImageRequest(ctx('/x.png', { destination: 'image', sameOrigin: false })),
    ).toBe(false);
  });
  it('ignores non-image destinations', () => {
    expect(isImageRequest(ctx('/x', { destination: 'document' }))).toBe(false);
  });
});

describe('isFontRequest()', () => {
  it('matches font destinations', () => {
    expect(isFontRequest(ctx('/f.woff2', { destination: 'font' }))).toBe(true);
  });
});

describe('navigation rules', () => {
  it('treats /login and /register as public (cacheable) navigations', () => {
    expect(isPublicNavigation(ctx('/login', { mode: 'navigate' }))).toBe(true);
    expect(isPublicNavigation(ctx('/register', { mode: 'navigate' }))).toBe(true);
  });

  it('excludes the personalized root and authenticated pages from the public rule', () => {
    expect(isPublicNavigation(ctx('/', { mode: 'navigate' }))).toBe(false);
    expect(isPublicNavigation(ctx('/arenas', { mode: 'navigate' }))).toBe(false);
    expect(isPublicNavigation(ctx('/profile', { mode: 'navigate' }))).toBe(false);
  });

  it('catch-all isNavigation matches any document navigation (-> NetworkOnly)', () => {
    expect(isNavigation(ctx('/arenas', { mode: 'navigate' }))).toBe(true);
    expect(isNavigation(ctx('/icons/x.png', { destination: 'image' }))).toBe(false);
  });
});

describe('isArenaPathname()', () => {
  it('matches the arena board page, with or without a trailing slash', () => {
    expect(isArenaPathname('/arena/abc123')).toBe(true);
    expect(isArenaPathname('/arena/abc123/')).toBe(true);
  });

  it('excludes deeper arena routes (they fall back to the generic offline page)', () => {
    expect(isArenaPathname('/arena/abc123/settings')).toBe(false);
    expect(isArenaPathname('/arena/abc123/settings/general')).toBe(false);
  });

  it('excludes non-arena and near-miss paths', () => {
    expect(isArenaPathname('/arenas')).toBe(false);
    expect(isArenaPathname('/arena/')).toBe(false);
    expect(isArenaPathname('/arena')).toBe(false);
    expect(isArenaPathname('/offline-board')).toBe(false);
  });
});
