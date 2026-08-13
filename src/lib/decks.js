// Win-vs-win / lose-vs-lose decks: which four paddles stack onto the next open
// court when an arena runs `splitDeckByResult`.
//
// Instead of one on-deck group (the rack's top four), the rack carries two:
//
//   winners — players whose most recent game was a WIN
//   losers  — everyone else: a recent loss, OR no result at all
//
// Putting no-result players in the losers deck is deliberate, not a fallback.
// At the start of a session nobody has played, so every paddle is a "loser",
// the winners deck is empty, and the board behaves exactly like the classic
// single-deck rack — which is what a manager expects for game one. The winners
// deck then fills itself as games finish. It also means a walk-in who arrives
// at 8pm joins the softer game rather than being dropped onto the court that
// has been winning all night.
//
// Fills alternate W -> L -> W. The pointer for that (`lastDeckFilled`) lives
// on the Arena row because it has to survive a reload and be shared between
// two managers looking at the same board.
//
// FAIRNESS IS UNCHANGED. Rack order still comes from the wait bands and
// auto-mix (`src/lib/matchmaking.js`, `applyAutoMixTx`); decks are only a
// grouping laid OVER that order, and every deck fill still bumps `waitRounds`
// for everyone it stepped over. A long waiter in the wrong deck keeps climbing
// their own deck and keeps their ⏳ badge.
//
// Everything here is PURE so the two callers can never drift:
//   - `applyFillCourtTx` (src/lib/board-apply.js) — the online server action
//   - `resolveCommand` (src/lib/board-engine.js) — the offline board engine
// Offline records the chosen deck in the event `outcome`, so a synced replay
// reproduces it exactly. Same contract as `src/lib/pairing.js`.

import { ON_DECK_SIZE } from '@/lib/matchmaking';

/** The winners deck. Matches the `'W'` values {@link recentResults} produces. */
export const DECK_WIN = 'W';
/** The losers deck — a recent loss, or no recent result at all. */
export const DECK_LOSE = 'L';

/**
 * Split a rack into its two decks.
 *
 * Both buckets preserve rack order, so the fairness ordering upstream still
 * decides who is at the front of each deck. A deck is only STACKABLE at
 * exactly {@link ON_DECK_SIZE}; a shorter one is shown to the manager as
 * still filling.
 *
 * @param {string[]} queue - rack order, index 0 = front
 * @param {Map<string, 'W'|'L'|null>} results - from `recentResults` in src/lib/pairing.js
 * @returns {{winners: string[], losers: string[], winnersDeck: string[], losersDeck: string[]}}
 *   `winners`/`losers` are the full buckets; the `*Deck` arrays are their fronts.
 */
export function splitDecks(queue, results) {
  const winners = [];
  const losers = [];
  for (const id of queue) {
    // Anything that isn't an explicit recent win is a loser, including `null`
    // (never played this session, or their last game fell outside the recent
    // window) and a missing map entry.
    if (results?.get(id) === DECK_WIN) winners.push(id);
    else losers.push(id);
  }
  return {
    winners,
    losers,
    winnersDeck: winners.slice(0, ON_DECK_SIZE),
    losersDeck: losers.slice(0, ON_DECK_SIZE),
  };
}

/**
 * Which deck a paddle belongs to, for the rack UI and the skip gate.
 *
 * A pin OVERRIDES the natural split: a loser the organizer placed in the
 * winners deck is, for every purpose that asks "which deck are they in", a
 * member of the winners deck. Answering with their natural deck is how the
 * skip gate came to measure a hand-placed paddle against a bucket it was no
 * longer part of.
 *
 * @param {string} playerId
 * @param {ReturnType<typeof splitDecks>} decks
 * @param {Map<string, {deck:'W'|'L', locked:boolean}>} [pins]
 * @returns {'W'|'L'|null} null when the paddle isn't in the rack at all
 */
export function deckOf(playerId, decks, pins) {
  const natural = decks.winners.includes(playerId)
    ? DECK_WIN
    : decks.losers.includes(playerId)
      ? DECK_LOSE
      : null;
  // Guard on `natural` so a stale pin for someone already on a court can't
  // report them as racked.
  if (natural === null) return null;
  return pins?.get(playerId)?.deck ?? natural;
}

/**
 * The ordered membership of one deck: its assembled four first, then everyone
 * else in that deck still waiting behind them.
 *
 * This is the array the skip gate does its arithmetic over — index < 4 is "on
 * deck", anything past that is a legal replacement — so it has to be the deck
 * AS ASSEMBLED, pins included. Using the raw `splitDecks` bucket meant a
 * natural member displaced by a pin still counted as on deck (they could be
 * skipped, and could be refused as a replacement) even though the rack drew
 * them under Waiting.
 *
 * @param {'W'|'L'|null} deck
 * @param {string[]} queue - rack order, index 0 = front
 * @param {ReturnType<typeof splitDecks>} decks
 * @param {Map<string, {deck:'W'|'L', locked:boolean}>} [pins]
 * @returns {string[]}
 */
export function bucketFor(deck, queue, decks, pins) {
  if (deck !== DECK_WIN && deck !== DECK_LOSE) return [];
  const { four, natural } = assembleDeck(deck, queue, decks, pins);
  const seated = new Set(four);
  return [...four, ...natural.filter((id) => !seated.has(id))];
}

/**
 * The ordered deck membership a given paddle sits in. The two halves are
 * always resolved together — a deck name from one rule and a bucket from
 * another is exactly the mismatch that broke the skip gate.
 *
 * @param {string} playerId
 * @param {string[]} queue - rack order, index 0 = front
 * @param {ReturnType<typeof splitDecks>} decks
 * @param {Map<string, {deck:'W'|'L', locked:boolean}>} [pins]
 * @returns {string[]}
 */
export function bucketOf(playerId, queue, decks, pins) {
  return bucketFor(deckOf(playerId, decks, pins), queue, decks, pins);
}

/**
 * Pick the four that stack onto the next open court, and say which deck they
 * came from.
 *
 * Alternation, in order:
 *   1. the deck opposite the last one filled, if it holds a full four
 *   2. otherwise the other deck, if it does
 *   3. otherwise the classic top four of the rack, with `deck: null` — the
 *      caller clears the pointer so alternation restarts cleanly rather than
 *      counting a mixed fill as a turn for either side
 *   4. otherwise nothing: fewer than four paddles are racked
 *
 * A null `lastDeckFilled` prefers the winners deck, which at session start is
 * empty — so the first fills naturally take branch 2 (the losers deck, i.e.
 * everyone), and the alternation begins for real once the first winners appear.
 *
 * Branch 3 is a real middle state, not a defensive edge: a rack of six split
 * three winners / three losers has no full deck, and stacking the classic top
 * four there is exactly today's behaviour.
 *
 * A deck the organizer hand-completed with pins counts as full here, so it
 * takes its turn in the ordinary rotation rather than needing its own button.
 * That is what makes a pin a placement rather than a suggestion: once the four
 * are set, the alternation stacks exactly those.
 *
 * @param {string[]} queue - rack order, index 0 = front
 * @param {Map<string, 'W'|'L'|null>} results - from `recentResults`
 * @param {'W'|'L'|null} lastDeckFilled - the arena's alternation pointer
 * @param {Map<string, {deck:'W'|'L', locked:boolean}>} [pins] - organizer pins
 * @returns {{deck: 'W'|'L'|null, players: string[]}} `players` is empty when
 *   the rack can't fill a court; `deck: null` marks the classic fallback.
 */
export function nextDeck(queue, results, lastDeckFilled, pins) {
  const decks = splitDecks(queue, results);
  const preferred = lastDeckFilled === DECK_WIN ? DECK_LOSE : DECK_WIN;

  const deckFor = (deck) => assembleDeck(deck, queue, decks, pins).four;
  const other = preferred === DECK_WIN ? DECK_LOSE : DECK_WIN;

  if (deckFor(preferred).length === ON_DECK_SIZE) {
    return { deck: preferred, players: deckFor(preferred) };
  }
  if (deckFor(other).length === ON_DECK_SIZE) {
    return { deck: other, players: deckFor(other) };
  }
  if (queue.length >= ON_DECK_SIZE) {
    return { deck: null, players: queue.slice(0, ON_DECK_SIZE) };
  }
  return { deck: null, players: [] };
}

// --- Organizer pins -------------------------------------------------------
//
// A deck short of four can be topped up by hand: the organizer picks anyone
// still racked and PINS them into that deck, so a "winners" court can go out
// with only two recent winners on the rack.
//
// A pin is board state (`Player.draftedDeck`), not a client hint, and it is
// AUTHORITATIVE. The natural member it displaces does not silently take the
// slot back when they show up — see `deckChallenge`, which surfaces that
// contest to the organizer instead. This is the whole point of the feature:
// the rack moved someone the organizer had deliberately placed, which read as
// the board overruling them.
//
// A pin's lifetime is one stack. It clears when its deck fills a court, or
// when the paddle leaves the rack for any reason (stacked, checked out,
// subbed out) — both are movements the organizer already consented to.

/**
 * The paddles pinned into one deck, in rack order.
 *
 * @param {'W'|'L'} deck
 * @param {string[]} queue - rack order; also filters out pins for paddles who
 *   have since left the rack, so a stale row can never hold a slot.
 * @param {Map<string, {deck:'W'|'L', locked:boolean}>} [pins]
 * @returns {string[]}
 */
export function pinnedIn(deck, queue, pins) {
  if (!pins?.size) return [];
  return queue.filter((id) => pins.get(id)?.deck === deck);
}

/**
 * Assemble a deck's four: the organizer's pins first, then natural members
 * fill whatever is left, capped at a court.
 *
 * Pins come FIRST, which is the inversion this feature turns on. Listing
 * naturals first and appending pins (as the original client-side draft did)
 * means a fourth real winner arriving silently truncates the organizer's pick
 * off the end of the slice.
 *
 * Natural members are drawn from the deck's WHOLE bucket rather than its front
 * four, so a bucket member pinned into the opposite deck doesn't leave a hole
 * that nobody fills.
 *
 * @param {'W'|'L'} deck
 * @param {string[]} queue - rack order, index 0 = front
 * @param {ReturnType<typeof splitDecks>} decks
 * @param {Map<string, {deck:'W'|'L', locked:boolean}>} [pins]
 * @returns {{four: string[], natural: string[], pinned: string[]}}
 *   `natural` is the bucket minus paddles pinned to either deck.
 */
export function assembleDeck(deck, queue, decks, pins) {
  const pinned = pinnedIn(deck, queue, pins);
  const claimed = new Set([
    ...pinnedIn(DECK_WIN, queue, pins),
    ...pinnedIn(DECK_LOSE, queue, pins),
  ]);
  const bucket = deck === DECK_WIN ? decks.winners : decks.losers;
  const natural = bucket.filter((id) => !claimed.has(id));
  return { four: [...pinned, ...natural].slice(0, ON_DECK_SIZE), natural, pinned };
}

/**
 * The contest a deck's pins have created, or null when there isn't one.
 *
 * A CHALLENGER is a natural member who would be on deck if the organizer had
 * pinned nobody, but isn't, because a pin holds their slot. Every finished
 * doubles game returns TWO winners and TWO losers at once, so two challengers
 * landing together is the ordinary case, not an edge.
 *
 * Challengers are capped at the number of pins that can still yield: a locked
 * pin is one the organizer has already been asked about and chose to keep, so
 * it is out of the running and we don't re-ask every time another winner
 * lands. When every pin in the deck is locked the deck is fully
 * organizer-specified and this returns null forever after.
 *
 * Both lists are in rack order, so a caller pairing them index-to-index seats
 * the longest-waiting challenger against the earliest pin.
 *
 * @param {'W'|'L'} deck
 * @param {string[]} queue - rack order, index 0 = front
 * @param {ReturnType<typeof splitDecks>} decks
 * @param {Map<string, {deck:'W'|'L', locked:boolean}>} [pins]
 * @returns {{deck:'W'|'L', challengers:string[], pins:string[]}|null}
 */
export function deckChallenge(deck, queue, decks, pins) {
  const { four, natural } = assembleDeck(deck, queue, decks, pins);
  const yieldable = pinnedIn(deck, queue, pins).filter((id) => !pins.get(id).locked);
  if (yieldable.length === 0) return null;

  const seated = new Set(four);
  const challengers = natural.slice(0, ON_DECK_SIZE).filter((id) => !seated.has(id));
  if (challengers.length === 0) return null;

  // Never offer more winners than there are slots we can actually free.
  return { deck, challengers: challengers.slice(0, yieldable.length), pins: yieldable };
}

/**
 * Whether the rack should be DRAWN as two decks.
 *
 * Before anyone has won a game every paddle is a "loser", and labelling that
 * single group "Losers · next court" would be both confusing and a bit rude.
 * So the two-group layout only appears once a recent winner is actually in the
 * rack; until then the rack renders its classic "On deck · next court" group.
 *
 * @param {ReturnType<typeof splitDecks>} decks
 */
export function hasTwoDecks(decks) {
  return decks.winners.length > 0;
}
