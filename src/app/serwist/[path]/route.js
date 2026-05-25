import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Revision string that busts the precached offline page on each deploy. Use the
// git SHA when available (local + most CI), otherwise fall back to a per-build
// random id — both change whenever a new build ships, which is all we need.
const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" })?.stdout?.trim() ||
  crypto.randomUUID();

// Generates the service worker on demand and serves it at /serwist/sw.js.
// Bundling is done by esbuild; useNativeEsbuild avoids the slower WASM build on
// non-Windows hosts (our Coolify Linux target).
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.js",
    additionalPrecacheEntries: [{ url: "/offline", revision }],
    useNativeEsbuild: true,
  });
