import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";
import {
  isApiRequest,
  isArenaPathname,
  isFontRequest,
  isImageRequest,
  isNavigation,
  isPublicNavigation,
  isStaticAsset,
} from "../lib/sw-routing.js";

// `self.__SW_MANIFEST` is replaced at build time with the list of precached
// build assets (the app shell). Everything else is handled at runtime below.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Stay in "waiting" on update so the user reloads on their own terms — the
  // SwUpdatePrompt component drives skipWaiting + reload. (See sw-update-prompt.js)
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // API routes (auth/session and everything else): never cache. Responses are
    // user-specific, so persisting them risks replaying one user's data to
    // another on a shared device. Listed FIRST so it wins over the image rule —
    // an `<img src="/api/...">` is destination "image" but must stay network-only.
    {
      matcher: isApiRequest,
      handler: new NetworkOnly(),
    },
    // _next/static: filenames are content-hashed and immutable, so a given URL's
    // bytes never change — serve from cache and skip the network entirely.
    {
      matcher: isStaticAsset,
      handler: new CacheFirst({ cacheName: "next-static" }),
    },
    // Images (same-origin only): immutable-per-URL, capped so the cache can't
    // grow without bound. Cross-origin/opaque and API images are excluded.
    {
      matcher: isImageRequest,
      handler: new CacheFirst({
        cacheName: "images",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 64,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
          }),
        ],
      }),
    },
    // Fonts: rarely change but aren't always hashed — serve instantly from cache
    // and refresh in the background.
    {
      matcher: isFontRequest,
      handler: new StaleWhileRevalidate({ cacheName: "fonts" }),
    },
    // Static, non-personalized page navigations: network-first for fresh
    // content, with the cache backing offline revisits. Note `/` is excluded —
    // it reads the session and renders different CTAs per user.
    {
      matcher: isPublicNavigation,
      handler: new NetworkFirst({
        cacheName: "pages",
        networkTimeoutSeconds: 10,
        plugins: [
          new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 7 * 24 * 60 * 60 }),
        ],
      }),
    },
    // All other (personalized/authenticated) navigations: never persist
    // user-specific HTML to a shared cache — on a shared device that could
    // replay one user's page to the next. Always hit the network; the document
    // fallback below serves the offline page when there's no connection.
    {
      matcher: isNavigation,
      handler: new NetworkOnly(),
    },
  ],
  // When a document request can't be served from network or cache, show a
  // precached fallback instead of the browser's dino error. Entries are
  // checked in order, so the arena-specific shell must precede the generic
  // offline page. The shell itself is neutral static HTML (no user data);
  // it reads the board from IndexedDB client-side, which keeps this within
  // the shared-device rule above (never cache personalized HTML).
  fallbacks: {
    entries: [
      {
        url: "/offline-board",
        matcher({ request }) {
          return (
            request.destination === "document" &&
            isArenaPathname(new URL(request.url).pathname)
          );
        },
      },
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
