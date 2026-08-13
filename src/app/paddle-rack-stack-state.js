// Pure rack-row derivation — no JSX, no React. Split out from
// paddle-rack-stack.js so the per-row logic (on-deck boundary, wait-badge
// severity, display name/initials) is unit-testable in node, mirroring the
// arena-session-prep-state.js / sessions.js pure-module convention.

// Re-export the shared on-deck size so existing consumers keep importing it
// from here, while the single source of truth lives in @/lib/matchmaking
// (shared with the fillCourt / skipPlayer server actions).
import { ON_DECK_SIZE } from '@/lib/matchmaking';
import { DECK_LOSE, DECK_WIN, assembleDeck, bucketOf } from '@/lib/decks';
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
 * Build the pins map `@/lib/decks` consumes from the player rows getState
 * ships. Pins are board state now, not client staging, so there is nothing to
 * prune here: `pinnedIn` ignores a pin for anyone off the rack, and the server
 * clears the row outright the moment a paddle is stacked or checked out.
 *
 * @param {Array<{id:string, draftedDeck?:'W'|'L'|null, draftedLocked?:boolean}>} players
 * @returns {Map<string, {deck:'W'|'L', locked:boolean}>}
 */
export function pinsFromPlayers(players) {
  const pins = new Map();
  for (const p of players ?? []) {
    if (p?.draftedDeck === DECK_WIN || p?.draftedDeck === DECK_LOSE) {
      pins.set(p.id, { deck: p.draftedDeck, locked: Boolean(p.draftedLocked) });
    }
  }
  return pins;
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
 * A short deck can also be topped up by hand (`pins`): the organizer picks
 * anyone still racked to fill its empty slots, so a session with only two
 * recent winners can still send a "winners" court out. Pinned paddles are
 * shown in the deck they were placed in and removed from wherever they came
 * from, so nobody appears twice. A pin never changes anyone's recorded result;
 * it only decides which four go on court next.
 *
 * Pins WIN their slot. When a real winner turns up and the deck is full of
 * hand-placed paddles, the winner waits and the organizer is asked (see
 * `deckChallenge`) rather than the rack quietly swapping them in. Rows are
 * drawn in true rack order regardless of how the four were assembled, so the
 * position badges still read as a countdown.
 *
 * @param {string[]} queue - rack order, index 0 = front
 * @param {object} [opts]
 * @param {import('@/lib/decks').splitDecks extends never ? never : {winners:string[],losers:string[],winnersDeck:string[],losersDeck:string[]}} [opts.decks]
 *   from `splitDecks`; omit for the classic single-group rack
 * @param {'W'|'L'|null} [opts.nextDeck] - the deck that stacks next, flagged so
 *   the list can mark it
 * @param {Map<string, 'W'|'L'|null>} [opts.results] - each player's most recent
 *   result (from `recentResults`), surfaced per row as `lastResult` for the
 *   W/L chip. Independent of deck mode — every arena shows it.
 * @param {Map<string, {deck:'W'|'L', locked:boolean}>} [opts.pins] - the
 *   organizer's hand placements, from `pinsFromPlayers`
 * @returns {Array<{key:string, label:string, deck:'W'|'L'|null, accent:boolean, isNext:boolean, short:number, canStack:boolean, rows:Array<{playerId:string, rackIndex:number, bucketIndex:number, bucketLength:number, lastResult:'W'|'L'|null, isPinned:boolean}>}>}
 */
export function buildRackSections(
  queue,
  { decks = null, nextDeck = null, results = null, pins = null } = {},
) {
  const rackIndexOf = new Map(queue.map((id, i) => [id, i]));
  const row = (playerId, bucket, isPinned = false) => ({
    playerId,
    rackIndex: rackIndexOf.get(playerId),
    bucketIndex: bucket.indexOf(playerId),
    bucketLength: bucket.length,
    // `null` for a player with no game this session — no chip, rather than a
    // chip that says "nothing yet".
    lastResult: results?.get(playerId) ?? null,
    isPinned,
  });
  const section = (key, label, rows, opts = {}) => ({
    key,
    label,
    deck: null,
    accent: false,
    isNext: false,
    short: 0,
    canStack: false,
    ...opts,
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

  // Each deck's four = the organizer's pins, then natural members filling what
  // is left (see `assembleDeck`). A pinned paddle is claimed by exactly one
  // deck, so it can't also appear in its natural spot or in Waiting.
  const pinnedIn = (deck) => queue.filter((id) => pins?.get(id)?.deck === deck);
  const winnersFour = assembleDeck(DECK_WIN, queue, decks, pins).four;
  const losersFour = assembleDeck(DECK_LOSE, queue, decks, pins).four;

  const onDeckIds = new Set([...winnersFour, ...losersFour]);
  const waiting = queue.filter((id) => !onDeckIds.has(id));
  // A waiting paddle's bucket is still its OWN deck — that's what decides
  // whether it can skip and who would replace it — but it is the deck AS
  // ASSEMBLED, so a natural member a pin displaced measures as waiting rather
  // than on deck. The raw split would have given them `bucketIndex < 4`, and
  // `deriveRackRow` would then draw an on-deck row, with a Skip button, inside
  // the Waiting group. Identical rule to the server's skip gate.
  const bucketOfRow = (id) => bucketOf(id, queue, decks, pins);

  const deckSection = (deck, key, label, four) =>
    section(
      key,
      label,
      // Drawn in rack order, not selection order: `assembleDeck` puts pins
      // first because they win their slots, but a manager reading the position
      // badges is counting down the real rack, so #7 must not be listed above
      // #1 just because #7 was hand-placed.
      [...four]
        .sort((a, b) => rackIndexOf.get(a) - rackIndexOf.get(b))
        .map((id, i, sorted) => {
          // A pinned paddle is measured against the ASSEMBLED four, not their
          // natural bucket: they are on deck now (so the row reads as on-deck,
          // which is what a manager sees), and a four-long bucket means they
          // can't skip — the organizer takes them back out with the row's ✕
          // instead, which is the reversal that actually makes sense here.
          const pinned = pins?.get(id)?.deck === deck;
          return row(id, pinned ? sorted : bucketOfRow(id), pinned);
        }),
      {
        deck,
        accent: true,
        isNext: nextDeck === deck,
        short: Math.max(0, ON_DECK_SIZE - four.length),
        // Only a HAND-COMPLETED deck offers its own stack button: a deck that
        // reached four on its own is stacked from the court card, on the
        // rotation's turn. Without this every full deck would sprout a button
        // that bypasses the alternation.
        canStack: four.length === ON_DECK_SIZE && pinnedIn(deck).length > 0,
      },
    );

  return [
    deckSection(DECK_WIN, 'winners', 'Winners · next court', winnersFour),
    deckSection(DECK_LOSE, 'losers', 'Losers · next court', losersFour),
    section('waiting', `Waiting · ${waiting.length}`, waiting.map((id) => row(id, bucketOfRow(id)))),
  ].filter((s) => s.rows.length > 0 || s.short > 0);
}
