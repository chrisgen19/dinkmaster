import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

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
    // _next/static: filenames are content-hashed and immutable, so a given URL's
    // bytes never change — serve from cache and skip the network entirely.
    {
      matcher: /\/_next\/static\/.*/i,
      handler: new CacheFirst({ cacheName: "next-static" }),
    },
    // Images: same immutable-per-URL logic, but capped so the cache can't grow
    // without bound.
    {
      matcher: ({ request }) => request.destination === "image",
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
      matcher: ({ request }) => request.destination === "font",
      handler: new StaleWhileRevalidate({ cacheName: "fonts" }),
    },
    // API routes (auth/session and everything else): never cache. Responses are
    // user-specific, so persisting them risks replaying one user's data to
    // another on a shared device — always hit the network.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    // Static, non-personalized page navigations: network-first for fresh
    // content, with the cache backing offline revisits. Note `/` is excluded —
    // it reads the session and renders different CTAs per user.
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" &&
        (url.pathname === "/login" || url.pathname === "/register"),
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
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
  ],
  // When a document request can't be served from network or cache, show the
  // precached offline page instead of the browser's dino error.
  fallbacks: {
    entries: [
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
