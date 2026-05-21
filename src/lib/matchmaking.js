// Shared matchmaking thresholds, imported by both the server actions (queue
// ordering) and the UI (the ⏳ waiting badge), so the two never drift apart.
//
// Auto-mix ordering bands (see fillCourt/endMatch in app/actions.js):
//   wait >= EMERGENCY_WAIT    -> emergency: strictly longest-first
//   wait >= STARVE_THRESHOLD  -> protected (the ⏳ badge): always ahead of fresh
//   otherwise                 -> fresh: mixed by games + randomness
export const STARVE_THRESHOLD = 2;
export const EMERGENCY_WAIT = 4;

// Within a band, ordering is GAMES_WEIGHT * (maxGames - gamesPlayed) (gently
// evens totals / integrates newcomers) + RANDOM_WEIGHT * random (the mixing).
export const GAMES_WEIGHT = 0.15;
export const RANDOM_WEIGHT = 2.5;
