/**
 * Generates the PWA icon set from a single source image.
 *
 * Usage: `pnpm pwa:icons`
 *
 * Source: public/icons/icon-source.png (a square, full-bleed app icon).
 *
 * Outputs (into public/icons):
 *   icon-192.png / icon-512.png         — purpose "any" (the icon, resized)
 *   maskable-192.png / maskable-512.png — purpose "maskable" (art padded into the safe zone)
 *   apple-touch-icon.png                 — 180x180 opaque icon for iOS home screen
 *
 * Replace public/icons/icon-source.png with new artwork and re-run.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "public/icons/icon-source.png");
const OUT = join(root, "public/icons");
// The source artwork's own background, so maskable padding blends seamlessly.
const BG = "#d1e9e0";

await mkdir(OUT, { recursive: true });

/** Resize the source straight to a square PNG (already a complete icon). */
async function direct({ size, file }) {
  await sharp(SRC)
    .resize(size, size, { fit: "cover" })
    // Flatten any transparency onto white — iOS ignores alpha on touch icons,
    // and keeps output opaque if a future source SVG/PNG has an alpha channel.
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, file));
}

/**
 * Maskable variant: shrink the art to the ~80% safe zone and center it on the
 * background colour, so adaptive masks (Android) never clip the artwork.
 */
async function maskable({ size, file }) {
  const inner = Math.round(size * 0.8);
  const art = await sharp(SRC)
    .resize(inner, inner, { fit: "cover" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: art, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, file));
}

await Promise.all([
  // "any" — the finished icon at install sizes.
  direct({ size: 192, file: "icon-192.png" }),
  direct({ size: 512, file: "icon-512.png" }),
  // "maskable" — art kept within the safe zone on a matching background.
  maskable({ size: 192, file: "maskable-192.png" }),
  maskable({ size: 512, file: "maskable-512.png" }),
  // iOS home-screen icon.
  direct({ size: 180, file: "apple-touch-icon.png" }),
]);

console.log("✓ PWA icons generated in public/icons");
