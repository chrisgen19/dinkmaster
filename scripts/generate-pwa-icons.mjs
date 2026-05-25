/**
 * Generates the PWA icon set from a single source SVG.
 *
 * Usage: `pnpm pwa:icons`
 *
 * Outputs (into public/icons):
 *   icon-192.png / icon-512.png       — purpose "any" (transparent, padded mark)
 *   maskable-192.png / maskable-512.png — purpose "maskable" (solid bg, safe-zone mark)
 *   apple-touch-icon.png               — 180x180 opaque icon for iOS home screen
 *
 * Replace public/icons/icon-source.svg with the real artwork and re-run.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "public/icons/icon-source.svg");
const OUT = join(root, "public/icons");
const THEME = "#059669"; // emerald-600, matches manifest theme_color
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

await mkdir(OUT, { recursive: true });

/** Render the source SVG to a square PNG buffer of the given size. */
async function renderMark(size) {
  return sharp(SRC)
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
}

/** Compose a centered mark onto a square canvas and write it out. */
async function compose({ size, markRatio, background, file }) {
  const inner = Math.round(size * markRatio);
  const mark = await renderMark(inner);
  await sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(join(OUT, file));
}

await Promise.all([
  // "any" — transparent background, ~12% padding so it isn't edge-to-edge.
  compose({ size: 192, markRatio: 0.76, background: TRANSPARENT, file: "icon-192.png" }),
  compose({ size: 512, markRatio: 0.76, background: TRANSPARENT, file: "icon-512.png" }),
  // "maskable" — opaque background, mark kept within the 80% safe zone.
  compose({ size: 192, markRatio: 0.6, background: THEME, file: "maskable-192.png" }),
  compose({ size: 512, markRatio: 0.6, background: THEME, file: "maskable-512.png" }),
  // iOS home-screen icon — opaque (iOS ignores transparency).
  compose({ size: 180, markRatio: 0.66, background: THEME, file: "apple-touch-icon.png" }),
]);

console.log("✓ PWA icons generated in public/icons");
