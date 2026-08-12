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
 * @param {string} playerId
 * @param {ReturnType<typeof splitDecks>} decks
 * @returns {'W'|'L'|null} null when the paddle isn't in the rack at all
 */
export function deckOf(playerId, decks) {
  if (decks.winners.includes(playerId)) return DECK_WIN;
  if (decks.losers.includes(playerId)) return DECK_LOSE;
  return null;
}

/**
 * The full bucket a paddle sits in (not just its front four), which is what
 * skip needs: it promotes the next paddle from the SAME deck.
 *
 * @param {'W'|'L'|null} deck
 * @param {ReturnType<typeof splitDecks>} decks
 * @returns {string[]}
 */
export function bucketFor(deck, decks) {
  if (deck === DECK_WIN) return decks.winners;
  if (deck === DECK_LOSE) return decks.losers;
  return [];
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
 * @param {string[]} queue - rack order, index 0 = front
 * @param {Map<string, 'W'|'L'|null>} results - from `recentResults`
 * @param {'W'|'L'|null} lastDeckFilled - the arena's alternation pointer
 * @returns {{deck: 'W'|'L'|null, players: string[]}} `players` is empty when
 *   the rack can't fill a court; `deck: null` marks the classic fallback.
 */
export function nextDeck(queue, results, lastDeckFilled) {
  const decks = splitDecks(queue, results);
  const preferred = lastDeckFilled === DECK_WIN ? DECK_LOSE : DECK_WIN;

  const deckFor = (deck) => (deck === DECK_WIN ? decks.winnersDeck : decks.losersDeck);
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
