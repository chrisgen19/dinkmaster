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
    // Auth/session endpoints: never cache — always hit the network so we don't
    // serve a stale or wrong session. Listed first so it wins over the generic
    // /api/ rule below.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/auth/"),
      handler: new NetworkOnly(),
    },
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
    // API routes: correctness first. Try the network (with a timeout so a dead
    // connection doesn't hang), fall back to the last cached response offline.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkFirst({ cacheName: "api", networkTimeoutSeconds: 10 }),
    },
    // Public, non-personalized page navigations: network-first for fresh
    // content, with the cache backing offline revisits.
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" &&
        (url.pathname === "/" ||
          url.pathname === "/login" ||
          url.pathname === "/register"),
      handler: new NetworkFirst({ cacheName: "pages", networkTimeoutSeconds: 10 }),
    },
    // All other (authenticated) navigations: never persist user-specific HTML to
    // a shared cache — on a shared device that could replay one user's page to
    // the next. Always hit the network; the document fallback below serves the
    // offline page when there's no connection.
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
