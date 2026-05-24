// Pure rack-row derivation — no JSX, no React. Split out from
// paddle-rack-stack.js so the per-row logic (on-deck boundary, wait-badge
// severity, display name/initials) is unit-testable in node, mirroring the
// arena-session-prep-state.js / sessions.js pure-module convention.

/** How many front-of-rack paddles stack onto the next open court. */
export const ON_DECK_SIZE = 4;

/** "Ada Lovelace" / "Ada" — falls back to Unknown for malformed rows. */
export const fullName = (p) => (p?.lastName ? `${p.firstName} ${p.lastName}` : p?.firstName ?? 'Unknown');

/** Two-letter avatar initials from first/last name (uppercased); "?" if none. */
export const initials = (p) => `${p?.firstName?.[0] ?? ''}${p?.lastName?.[0] ?? ''}`.toUpperCase() || '?';

/**
 * Derive a rack row's presentation flags from the player and its queue index.
 *
 * `badge` is the wait-starvation severity, shown only once a player has waited
 * long enough: 'emergency' (red) at `emergencyWait`, else 'warn' (amber) at
 * `starveThreshold`, else 'none'. `emergencyWait >= starveThreshold` in
 * practice, so emergency is checked first.
 *
 * `canSkip` gates the "skip to back of rack" action: only on-deck paddles can
 * skip (that's the urgent case), only when someone is actually waiting behind
 * the on-deck group (`queueLength > ON_DECK_SIZE`), and only for a manager or
 * the viewer's own paddle (self-service). The server re-authorizes regardless.
 *
 * @param {{userId?:string|null, firstName?:string, lastName?:string|null, waitRounds?:number}} player
 * @param {number} index - 0-based position in the queue (0 = front of rack)
 * @param {{viewerUserId:string|null, starveThreshold:number, emergencyWait:number, canManage?:boolean, queueLength?:number}} opts
 * @returns {{rank:number, isOnDeck:boolean, isYou:boolean, isWalkIn:boolean, badge:'none'|'warn'|'emergency', waitRounds:number, name:string, initials:string, canSkip:boolean}}
 */
export function deriveRackRow(
  player,
  index,
  { viewerUserId, starveThreshold, emergencyWait, canManage = false, queueLength = 0 },
) {
  const waitRounds = player?.waitRounds ?? 0;
  let badge = 'none';
  if (waitRounds >= emergencyWait) badge = 'emergency';
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
  };
}
