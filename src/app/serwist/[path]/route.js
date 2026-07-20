import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Read the git SHA, but only when no deploy env var identified the build —
 * many production images ship without git or a `.git` directory, so we avoid
 * spawning it there. Guarded so a missing binary can't throw at build time.
 */
function gitSha() {
  try {
    return spawnSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf-8",
    })?.stdout?.trim();
  } catch {
    return undefined;
  }
}

// Revision string that busts the precached offline page on each deploy. This
// route is statically generated, so the value is baked in once at build time.
// Prefer a deploy-provided SHA (so all build replicas agree), then git for local
// dev, falling back to a random id only if nothing identifies the build.
const revision =
  process.env.SOURCE_COMMIT || // Coolify / Nixpacks
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  gitSha() ||
  crypto.randomUUID();

// Generates the service worker on demand and serves it at /serwist/sw.js.
// Bundling is done by esbuild; useNativeEsbuild avoids the slower WASM build on
// non-Windows hosts (our Coolify Linux target).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.js",
    // Precache the offline pages so the fallbacks show intact even on a
    // route the user never visited online. The offline board shell backs
    // /arena/[id] navigations (see sw.js fallbacks).
    //
    // ROUTES ONLY here. Static files under public/ (the logo these pages
    // render included) are already in the injected manifest with
    // content-hash revisions; listing one again with a different revision
    // creates a conflicting duplicate that makes the Serwist constructor
    // THROW, so the whole service worker fails evaluation and never
    // registers. (That exact bug shipped with the /icons/icon-192.png entry
    // that used to sit in this list.)
    additionalPrecacheEntries: [
      { url: "/offline", revision },
      { url: "/offline-board", revision },
    ],
    useNativeEsbuild: true,
  });
