// Default matchmaking thresholds, imported by the server actions (queue
// ordering) and the UI (the ⏳ waiting badge) as fall-backs when a per-arena
// override is not available. Each arena now persists its own
// `starveThreshold` / `emergencyWait` (see `prisma/schema.prisma`), defaulting
// to these values so existing arenas are unchanged.
//
// Auto-mix ordering bands (see endMatch in app/actions.js):
//   wait >= emergencyWait    -> emergency: strictly longest-first
//   wait >= starveThreshold  -> protected (the ⏳ badge): always ahead of fresh
//   otherwise                -> fresh
// Within a band, players are ordered by fewest games played first (so the
// person who has played least goes next), with randomness only breaking ties
// among equal game counts. Starvation is bounded by the wait bands, not games.
export const DEFAULT_STARVE_THRESHOLD = 2;
export const DEFAULT_EMERGENCY_WAIT = 4;
