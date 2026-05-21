// Shared matchmaking thresholds, imported by both the server actions (queue
// ordering) and the UI (the ⏳ waiting badge), so the two never drift apart.
//
// Auto-mix ordering bands (see endMatch in app/actions.js):
//   wait >= EMERGENCY_WAIT    -> emergency: strictly longest-first
//   wait >= STARVE_THRESHOLD  -> protected (the ⏳ badge): always ahead of fresh
//   otherwise                 -> fresh
// Within a band, players are ordered by fewest games played first (so the
// person who has played least goes next), with randomness only breaking ties
// among equal game counts. Starvation is bounded by the wait bands, not games.
export const STARVE_THRESHOLD = 2;
export const EMERGENCY_WAIT = 4;
