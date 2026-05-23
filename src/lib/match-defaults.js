// Shared bounds for the per-arena match & leaderboard defaults (Phase 9b).
// Imported by the server action (`updateArenaMatchDefaults` in
// `src/app/actions.js`) AND the Settings UI (`MatchDefaultsSection` in
// `src/app/arena-settings.js`) so client validation can mirror the server
// without a round-trip — same drift-free pattern as `MAX_WAIT_THRESHOLD` in
// `lib/matchmaking.js`.
//
// Bounds are loose enough to fit every common pickleball variant (11/15/21
// game-to scores) but tight enough to reject typos like `999`.

/** Minimum target score (rally to 1 is silly, but 0 is meaningless). */
export const MIN_TARGET_SCORE = 1;
/** Maximum target score — comfortably above any standard game-to. */
export const MAX_TARGET_SCORE = 99;

/** Minimum leaderboard size — a board of zero would never render. */
export const MIN_LEADERBOARD_SIZE = 1;
/** Maximum leaderboard size — most arenas won't reach this many active players. */
export const MAX_LEADERBOARD_SIZE = 50;
