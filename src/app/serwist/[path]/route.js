import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Revision string that busts the precached offline page on each deploy. This
// route is statically generated, so the value is baked in once at build time.
// Prefer the git SHA, then a deploy env var (so all build replicas agree),
// falling back to a random id only if nothing identifies the build.
const gitSha = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf-8",
})?.stdout?.trim();

const revision =
  gitSha ||
  process.env.SOURCE_COMMIT || // Coolify / Nixpacks
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  crypto.randomUUID();

// Generates the service worker on demand and serves it at /serwist/sw.js.
// Bundling is done by esbuild; useNativeEsbuild avoids the slower WASM build on
// non-Windows hosts (our Coolify Linux target).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.js",
    // Precache the offline page and the logo it renders, so the fallback shows
    // intact even on a route the user never visited online.
    additionalPrecacheEntries: [
      { url: "/offline", revision },
      { url: "/icons/icon-192.png", revision },
    ],
    useNativeEsbuild: true,
  });
