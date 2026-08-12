import { describe, expect, it } from 'vitest';
import {
  DECK_LOSE,
  DECK_WIN,
  bucketFor,
  deckOf,
  hasTwoDecks,
  nextDeck,
  splitDecks,
} from '@/lib/decks';

/**
 * Results map from a compact spec: `{ a: 'W', b: 'L' }`. Anything omitted is
 * absent from the map entirely, which is the "never played" case the rack sees
 * for a walk-in.
 */
const res = (spec = {}) => new Map(Object.entries(spec));

/** Rack of n ids: r1, r2, … so positions read at a glance. */
const rack = (n) => Array.from({ length: n }, (_, i) => `r${i + 1}`);

describe('splitDecks', () => {
  it('puts recent winners in one bucket and everyone else in the other', () => {
    const decks = splitDecks(['a', 'b', 'c', 'd'], res({ a: 'W', b: 'L', c: 'W', d: 'L' }));
    expect(decks.winners).toEqual(['a', 'c']);
    expect(decks.losers).toEqual(['b', 'd']);
  });

  it('counts a player with no result as a loser', () => {
    const decks = splitDecks(['a', 'b'], res({ a: 'W', b: null }));
    expect(decks.losers).toEqual(['b']);
  });

  it('counts a player missing from the map entirely as a loser', () => {
    const decks = splitDecks(['a', 'walkin'], res({ a: 'W' }));
    expect(decks.losers).toEqual(['walkin']);
  });

  it('tolerates a missing results map', () => {
    const decks = splitDecks(['a', 'b'], undefined);
    expect(decks.winners).toEqual([]);
    expect(decks.losers).toEqual(['a', 'b']);
  });

  it('preserves rack order inside each bucket', () => {
    // Fairness ordering upstream decides who is at the front of each deck, so
    // the split must not resort.
    const decks = splitDecks(
      ['r1', 'r2', 'r3', 'r4'],
      res({ r1: 'L', r2: 'W', r3: 'L', r4: 'W' }),
    );
    expect(decks.winners).toEqual(['r2', 'r4']);
    expect(decks.losers).toEqual(['r1', 'r3']);
  });

  it('caps each deck at four but keeps the full bucket', () => {
    const winners = res(Object.fromEntries(rack(6).map((id) => [id, 'W'])));
    const decks = splitDecks(rack(6), winners);
    expect(decks.winnersDeck).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(decks.winners).toHaveLength(6);
  });
});

describe('deckOf / bucketFor', () => {
  const decks = splitDecks(['a', 'b'], res({ a: 'W', b: 'L' }));

  it('names the deck a racked paddle belongs to', () => {
    expect(deckOf('a', decks)).toBe(DECK_WIN);
    expect(deckOf('b', decks)).toBe(DECK_LOSE);
  });

  it('returns null for someone who is not racked', () => {
    expect(deckOf('playing-right-now', decks)).toBeNull();
  });

  it('hands back the full bucket, not just its front four', () => {
    const big = splitDecks(rack(6), res(Object.fromEntries(rack(6).map((id) => [id, 'W']))));
    expect(bucketFor(DECK_WIN, big)).toHaveLength(6);
    expect(bucketFor(DECK_LOSE, big)).toEqual([]);
    expect(bucketFor(null, big)).toEqual([]);
  });
});

describe('nextDeck', () => {
  // Eight paddles, alternating results: four winners, four losers.
  const eight = rack(8);
  const bothReady = res({
    r1: 'W', r2: 'L', r3: 'W', r4: 'L',
    r5: 'W', r6: 'L', r7: 'W', r8: 'L',
  });

  it('prefers the deck opposite the last one filled', () => {
    expect(nextDeck(eight, bothReady, DECK_WIN)).toEqual({
      deck: DECK_LOSE,
      players: ['r2', 'r4', 'r6', 'r8'],
    });
    expect(nextDeck(eight, bothReady, DECK_LOSE)).toEqual({
      deck: DECK_WIN,
      players: ['r1', 'r3', 'r5', 'r7'],
    });
  });

  it('alternates W -> L -> W across consecutive fills', () => {
    const first = nextDeck(eight, bothReady, null);
    const second = nextDeck(eight, bothReady, first.deck);
    const third = nextDeck(eight, bothReady, second.deck);
    expect([first.deck, second.deck, third.deck]).toEqual([DECK_WIN, DECK_LOSE, DECK_WIN]);
  });

  it('falls to the other deck when the preferred one is short', () => {
    // Only three winners — the winners deck can't stack even though it is next.
    const results = res({
      r1: 'W', r2: 'L', r3: 'W', r4: 'L',
      r5: 'W', r6: 'L', r7: 'L', r8: 'L',
    });
    expect(nextDeck(eight, results, DECK_LOSE)).toEqual({
      deck: DECK_LOSE,
      players: ['r2', 'r4', 'r6', 'r7'],
    });
  });

  it('stacks the classic top four when neither deck is full', () => {
    // Rack of six split 3W/3L: no full deck, so today's behaviour stands and
    // the pointer is cleared rather than crediting either side with a turn.
    const six = rack(6);
    const results = res({ r1: 'W', r2: 'W', r3: 'W', r4: 'L', r5: 'L', r6: 'L' });
    expect(nextDeck(six, results, DECK_WIN)).toEqual({
      deck: null,
      players: ['r1', 'r2', 'r3', 'r4'],
    });
  });

  it('treats a session start as a single deck', () => {
    // Nobody has played: every paddle is a loser, so the first fill is just the
    // top four and the manager sees no deck split at all.
    const four = rack(4);
    expect(nextDeck(four, res(), null)).toEqual({
      deck: DECK_LOSE,
      players: ['r1', 'r2', 'r3', 'r4'],
    });
  });

  it('returns no players when the rack is short of a court', () => {
    expect(nextDeck(rack(3), res(), null)).toEqual({ deck: null, players: [] });
  });

  it('needs exactly four for a deck to be stackable', () => {
    const results = res({ r1: 'W', r2: 'W', r3: 'W', r4: 'W', r5: 'L' });
    // Winners are ready; the four losers are not (only r5), so W stacks.
    expect(nextDeck(rack(5), results, DECK_LOSE).deck).toBe(DECK_WIN);
  });
});

describe('hasTwoDecks', () => {
  it('is false until someone has won a game', () => {
    expect(hasTwoDecks(splitDecks(rack(6), res()))).toBe(false);
  });

  it('is true as soon as a recent winner is racked', () => {
    expect(hasTwoDecks(splitDecks(rack(6), res({ r3: 'W' })))).toBe(true);
  });
});
