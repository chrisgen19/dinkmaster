// Pure rack-row derivation — no JSX, no React. Split out from
// paddle-rack-stack.js so the per-row logic (on-deck boundary, wait-badge
// severity, display name/initials) is unit-testable in node, mirroring the
// arena-session-prep-state.js / sessions.js pure-module convention.

// Re-export the shared on-deck size so existing consumers keep importing it
// from here, while the single source of truth lives in @/lib/matchmaking
// (shared with the fillCourt / skipPlayer server actions).
import { ON_DECK_SIZE } from '@/lib/matchmaking';
import { profileHref } from '@/lib/player-display';

export { ON_DECK_SIZE };

/** "Ada Lovelace" / "Ada" — falls back to Unknown for malformed rows. */
export const fullName = (p) => (p?.lastName ? `${p.firstName} ${p.lastName}` : p?.firstName ?? 'Unknown');

/** Two-letter avatar initials from first/last name (uppercased); "?" if none. */
export const initials = (p) => `${p?.firstName?.[0] ?? ''}${p?.lastName?.[0] ?? ''}`.toUpperCase() || '?';

/**
 * Derive a rack row's presentation flags from the player and its queue index.
 *
 * `badge` is the priority severity, in descending order:
 *   'next-line' — the paddle was Skip'd while the arena's
 *      `skipRestoresPriority` was on; they jump to the top of the next mix.
 *      Wins over the wait-based bands so it stays visible while they're back.
 *   'emergency' (red) at `emergencyWait` rounds of waiting.
 *   'warn' (amber) at `starveThreshold` rounds of waiting.
 *   'none' otherwise.
 *
 * `canSkip` gates the Skip action: only on-deck paddles can skip (that's the
 * urgent case), only when someone is actually waiting behind the on-deck group
 * (`queueLength > ON_DECK_SIZE`), and only for a manager or the viewer's own
 * paddle (self-service). The server re-authorizes regardless.
 *
 * `profileHref` is where the player's name links — see `profileHref` in
 * `@/lib/player-display` (the shared rule used by every clickable-name
 * surface); `null` means render the name as plain text.
 *
 * @param {{id?:string, userId?:string|null, firstName?:string, lastName?:string|null, waitRounds?:number, skipBoosted?:boolean}} player
 * @param {number} index - 0-based position in the queue (0 = front of rack)
 * @param {{viewerUserId:string|null, viewerIsMember?:boolean, starveThreshold:number, emergencyWait:number, canManage?:boolean, queueLength?:number}} opts
 * @returns {{rank:number, isOnDeck:boolean, isYou:boolean, isWalkIn:boolean, badge:'none'|'warn'|'emergency'|'next-line', waitRounds:number, name:string, initials:string, canSkip:boolean, profileHref:string|null}}
 */
export function deriveRackRow(
  player,
  index,
  { viewerUserId, viewerIsMember = false, starveThreshold, emergencyWait, canManage = false, queueLength = 0 },
) {
  const waitRounds = player?.waitRounds ?? 0;
  const skipBoosted = Boolean(player?.skipBoosted);
  let badge = 'none';
  if (skipBoosted) badge = 'next-line';
  else if (waitRounds >= emergencyWait) badge = 'emergency';
  else if (waitRounds >= starveThreshold) badge = 'warn';

  const isOnDeck = index < ON_DECK_SIZE;
  const isYou = Boolean(player?.userId && player.userId === viewerUserId);

  return {
    rank: index + 1,
    isOnDeck,
    isYou,
    isWalkIn: !player?.userId,
    badge,
    waitRounds,
    name: fullName(player),
    initials: initials(player),
    canSkip: isOnDeck && queueLength > ON_DECK_SIZE && (canManage || isYou),
    profileHref: profileHref(
      { userId: player?.userId, playerId: player?.id },
      { viewerUserId, viewerIsMember },
    ),
  };
}
