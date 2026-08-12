import { withSerwist } from "@serwist/turbopack";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A separate build directory when NEXT_DIST_DIR is set. The e2e config uses
  // it so its dev server is a different Next.js instance from `pnpm dev`:
  // Next refuses a second `next dev` for the same project directory whatever
  // port it is given, so without this you could not run the suite while
  // developing. It also keeps the two compilation caches apart.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [
      {
        // Baseline hardening applied to every response.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The service worker is emitted by the Serwist route handler. It must
        // never be cached so a new deploy ships the updated worker immediately.
        source: "/serwist/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

// withSerwist keeps the build on Turbopack (no --webpack downgrade) and loads
// the Next.js config itself; the actual worker is bundled by the route handler
// at src/app/serwist/[path]/route.js.
export default withSerwist(nextConfig);
