/**
 * Web App Manifest, generated via the App Router metadata API. Served at
 * /manifest.webmanifest and linked automatically by Next.js.
 *
 * Icons cover both `any` (transparent, for browser UI) and `maskable` (safe-zone
 * padded, for adaptive home-screen icons on Android). Regenerate the PNGs with
 * `pnpm pwa:icons` after editing public/icons/icon-source.svg.
 */
export default function manifest() {
  return {
    name: "DinkMaster — Smart Paddle Stacking & Partnership Mixing",
    short_name: "DinkMaster",
    description:
      "Run your pickleball open play: stack the rack, mix partnerships fairly, and track matches in real time.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#059669",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
