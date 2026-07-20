import { OfflineBoardShell } from "./offline-board-shell";

export const metadata = {
  title: "Offline board — DinkMaster",
};

/**
 * Neutral offline shell for arena pages. The service worker precaches this
 * route and serves it as the document fallback whenever an `/arena/[id]`
 * navigation fails offline (the browser URL stays on the arena, so the shell
 * reads the arena id from `location.pathname` and renders the last board
 * snapshot saved in IndexedDB). Visited directly at /offline-board, it lists
 * every arena with a saved snapshot instead.
 *
 * Kept fully static — and free of ANY user-specific markup — so it precaches
 * cleanly and never crosses the shared-device rule documented in sw.js:
 * all personal/board data stays in IndexedDB and renders client-side only.
 */
export default function OfflineBoardPage() {
  return <OfflineBoardShell />;
}
