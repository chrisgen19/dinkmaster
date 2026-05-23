// Shared constants for the per-arena match & leaderboard defaults (Phase 9b).
// `DEFAULT_*` mirror the schema column defaults so client fall-backs and
// server validation can never disagree about "the prior hardcoded behaviour".
// `MIN_*` / `MAX_*` are imported by the server action
// (`updateArenaMatchDefaults` in `src/app/actions.js`) AND the Settings UI
// (`MatchDefaultsSection` in `src/app/arena-settings.js`) so client validation
// mirrors the server without a round-trip — same drift-free pattern as
// `MAX_WAIT_THRESHOLD` / `DEFAULT_STARVE_THRESHOLD` in `lib/matchmaking.js`.

/** Default target score (pickleball game-to). */
export const DEFAULT_TARGET_SCORE = 11;
/** Default initial state for the Auto-Mix toggle. */
export const DEFAULT_AUTO_MIX = true;
/** Default for whether games played outside the schedule still count. */
export const DEFAULT_COUNT_OFF_SCHEDULE = true;
// (No DEFAULT_LEADERBOARD_SIZE here — it lives in `lib/leaderboard.js` next to
// `computeWeeklyLeaderboard` where it's used as the function default.)

/** Minimum target score (rally to 1 is silly, but 0 is meaningless). */
export const MIN_TARGET_SCORE = 1;
/** Maximum target score — comfortably above any standard game-to. */
export const MAX_TARGET_SCORE = 99;

/** Minimum leaderboard size — a board of zero would never render. */
export const MIN_LEADERBOARD_SIZE = 1;
/** Maximum leaderboard size — most arenas won't reach this many active players. */
export const MAX_LEADERBOARD_SIZE = 50;
