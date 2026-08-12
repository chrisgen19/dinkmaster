// Pure rack-row derivation — no JSX, no React. Split out from
// paddle-rack-stack.js so the per-row logic (on-deck boundary, wait-badge
// severity, display name/initials) is unit-testable in node, mirroring the
// arena-session-prep-state.js / sessions.js pure-module convention.

// Re-export the shared on-deck size so existing consumers keep importing it
// from here, while the single source of truth lives in @/lib/matchmaking
// (shared with the fillCourt / skipPlayer server actions).
import { ON_DECK_SIZE } from '@/lib/matchmaking';
import { DECK_LOSE, DECK_WIN } from '@/lib/decks';
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
 * urgent case), only when someone is actually waiting behind to take the freed
 * spot, and only for a manager or the viewer's own paddle (self-service). The
 * server re-authorizes regardless.
 *
 * "On deck" is bucket-relative. In an arena running win/lose decks a paddle is
 * on deck when it is in the front four of ITS OWN deck, and the paddle that
 * replaces it on a skip comes from that same deck — so callers pass
 * `bucketIndex`/`bucketLength` for the deck the player belongs to. The classic
 * single-group rack is the same rule with one bucket, which is why both
 * default to the rack-wide values and nothing changes when deck mode is off.
 *
 * `rank` always reports the paddle's TRUE rack position, even when the rows are
 * drawn grouped by deck — the number is what a player counts down to their
 * turn, so it must not silently become a within-deck position.
 *
 * `profileHref` is where the player's name links — see `profileHref` in
 * `@/lib/player-display` (the shared rule used by every clickable-name
 * surface); `null` means render the name as plain text.
 *
 * @param {{id?:string, userId?:string|null, firstName?:string, lastName?:string|null, waitRounds?:number, skipBoosted?:boolean}} player
 * @param {number} index - 0-based position in the queue (0 = front of rack)
 * @param {{viewerUserId:string|null, viewerIsMember?:boolean, starveThreshold:number, emergencyWait:number, canManage?:boolean, queueLength?:number, bucketIndex?:number, bucketLength?:number}} opts
 * @returns {{rank:number, isOnDeck:boolean, isYou:boolean, isWalkIn:boolean, badge:'none'|'warn'|'emergency'|'next-line', waitRounds:number, name:string, initials:string, canSkip:boolean, profileHref:string|null}}
 */
export function deriveRackRow(
  player,
  index,
  {
    viewerUserId,
    viewerIsMember = false,
    starveThreshold,
    emergencyWait,
    canManage = false,
    queueLength = 0,
    bucketIndex,
    bucketLength,
  },
) {
  const waitRounds = player?.waitRounds ?? 0;
  const skipBoosted = Boolean(player?.skipBoosted);
  let badge = 'none';
  if (skipBoosted) badge = 'next-line';
  else if (waitRounds >= emergencyWait) badge = 'emergency';
  else if (waitRounds >= starveThreshold) badge = 'warn';

  const deckIndex = bucketIndex ?? index;
  const deckLength = bucketLength ?? queueLength;
  const isOnDeck = deckIndex < ON_DECK_SIZE;
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
    canSkip: isOnDeck && deckLength > ON_DECK_SIZE && (canManage || isYou),
    profileHref: profileHref(
      { userId: player?.userId, playerId: player?.id },
      { viewerUserId, viewerIsMember },
    ),
  };
}

/**
 * Group the rack into the labelled sections the list renders, so the grouping
 * rule is testable without JSX.
 *
 * Classic (no `decks`): one on-deck group of four, then everyone waiting —
 * exactly what the rack has always drawn.
 *
 * Win/lose decks: the winners deck, then the losers deck, then everyone
 * waiting behind both. Rows are REORDERED into their groups, which is why each
 * row carries its true `rackIndex` separately — the position badge keeps
 * counting down the real rack, so a manager reading "7" still knows that paddle
 * is seventh in line overall.
 *
 * A deck short of four is still shown (with `short` set) rather than hidden:
 * watching it fill is how a manager knows the next stack is coming. Empty
 * sections are dropped.
 *
 * @param {string[]} queue - rack order, index 0 = front
 * @param {object} [opts]
 * @param {import('@/lib/decks').splitDecks extends never ? never : {winners:string[],losers:string[],winnersDeck:string[],losersDeck:string[]}} [opts.decks]
 *   from `splitDecks`; omit for the classic single-group rack
 * @param {'W'|'L'|null} [opts.nextDeck] - the deck that stacks next, flagged so
 *   the list can mark it
 * @returns {Array<{key:string, label:string, accent:boolean, isNext:boolean, short:number, rows:Array<{playerId:string, rackIndex:number, bucketIndex:number, bucketLength:number}>}>}
 */
export function buildRackSections(queue, { decks = null, nextDeck = null } = {}) {
  const rackIndexOf = new Map(queue.map((id, i) => [id, i]));
  const row = (playerId, bucket) => ({
    playerId,
    rackIndex: rackIndexOf.get(playerId),
    bucketIndex: bucket.indexOf(playerId),
    bucketLength: bucket.length,
  });
  const section = (key, label, rows, { accent = false, isNext = false, short = 0 } = {}) => ({
    key,
    label,
    accent,
    isNext,
    short,
    rows,
  });

  if (!decks) {
    const waiting = queue.slice(ON_DECK_SIZE);
    return [
      section('on-deck', 'On deck · next court', queue.slice(0, ON_DECK_SIZE).map((id) => row(id, queue)), {
        accent: true,
      }),
      ...(waiting.length > 0
        ? [section('waiting', `Waiting · ${waiting.length}`, waiting.map((id) => row(id, queue)))]
        : []),
    ];
  }

  const onDeckIds = new Set([...decks.winnersDeck, ...decks.losersDeck]);
  const waiting = queue.filter((id) => !onDeckIds.has(id));
  // A waiting paddle's bucket is still its OWN deck — that's what decides
  // whether it can skip and who would replace it.
  const bucketOf = (id) => (decks.winners.includes(id) ? decks.winners : decks.losers);

  return [
    section('winners', 'Winners · next court', decks.winnersDeck.map((id) => row(id, decks.winners)), {
      accent: true,
      isNext: nextDeck === DECK_WIN,
      short: Math.max(0, ON_DECK_SIZE - decks.winnersDeck.length),
    }),
    section('losers', 'Losers · next court', decks.losersDeck.map((id) => row(id, decks.losers)), {
      accent: true,
      isNext: nextDeck === DECK_LOSE,
      short: Math.max(0, ON_DECK_SIZE - decks.losersDeck.length),
    }),
    section('waiting', `Waiting · ${waiting.length}`, waiting.map((id) => row(id, bucketOf(id)))),
  ].filter((s) => s.rows.length > 0);
}
