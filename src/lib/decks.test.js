import { describe, expect, it } from 'vitest';
import {
  DECK_LOSE,
  DECK_WIN,
  assembleDeck,
  bucketFor,
  bucketOf,
  deckChallenge,
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

/**
 * Pins map from a compact spec: `{ x: 'W', y: 'L!' }`, where a trailing `!`
 * marks the pin LOCKED (the organizer was asked and chose to keep it).
 */
const pin = (spec = {}) =>
  new Map(
    Object.entries(spec).map(([id, v]) => [
      id,
      { deck: v.replace('!', ''), locked: v.endsWith('!') },
    ]),
  );

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

describe('deckOf / bucketFor / bucketOf', () => {
  const pair = ['a', 'b'];
  const decks = splitDecks(pair, res({ a: 'W', b: 'L' }));

  it('names the deck a racked paddle belongs to', () => {
    expect(deckOf('a', decks)).toBe(DECK_WIN);
    expect(deckOf('b', decks)).toBe(DECK_LOSE);
  });

  it('returns null for someone who is not racked', () => {
    expect(deckOf('playing-right-now', decks)).toBeNull();
  });

  it('lets a pin override the natural split', () => {
    // A loser the organizer placed in the winners deck IS a winners-deck
    // member for every purpose that asks. Answering with their natural deck is
    // how the skip gate came to measure them against a bucket they had left.
    expect(deckOf('b', decks, pin({ b: 'W' }))).toBe(DECK_WIN);
  });

  it('ignores a pin for someone who is not racked', () => {
    expect(deckOf('gone', decks, pin({ gone: 'W' }))).toBeNull();
  });

  it('hands back the full bucket, not just its front four', () => {
    const six = rack(6);
    const big = splitDecks(six, res(Object.fromEntries(six.map((id) => [id, 'W']))));
    expect(bucketFor(DECK_WIN, six, big)).toHaveLength(6);
    expect(bucketFor(DECK_LOSE, six, big)).toEqual([]);
    expect(bucketFor(null, six, big)).toEqual([]);
  });

  it('orders the bucket as the deck is ASSEMBLED, not as results split it', () => {
    // w4 is displaced by the pin, so they are waiting — index 4, not index 3.
    // The raw split would have called them on deck, letting them be skipped
    // and refusing them as a replacement, while the rack drew them in Waiting.
    const queue = ['w1', 'w2', 'w3', 'x', 'w4'];
    const d = splitDecks(queue, res({ w1: 'W', w2: 'W', w3: 'W', x: 'L', w4: 'W' }));
    const pins = pin({ x: 'W' });
    expect(bucketFor(DECK_WIN, queue, d, pins)).toEqual(['x', 'w1', 'w2', 'w3', 'w4']);
    expect(bucketOf('w4', queue, d, pins)).toEqual(['x', 'w1', 'w2', 'w3', 'w4']);
    // …and the pinned paddle resolves through the deck they were placed in.
    expect(bucketOf('x', queue, d, pins)).toEqual(['x', 'w1', 'w2', 'w3', 'w4']);
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

describe('assembleDeck', () => {
  it('seats the organizer pin ahead of natural members', () => {
    // 3 winners + a pinned loser. The pin must not be the one that falls off.
    const queue = ['w1', 'w2', 'w3', 'x', 'l1'];
    const decks = splitDecks(queue, res({ w1: 'W', w2: 'W', w3: 'W', x: 'L', l1: 'L' }));
    const { four } = assembleDeck(DECK_WIN, queue, decks, pin({ x: 'W' }));
    expect(four).toEqual(['x', 'w1', 'w2', 'w3']);
  });

  it('drops a fourth natural winner rather than the pin', () => {
    const queue = ['w1', 'w2', 'w3', 'x', 'w4'];
    const decks = splitDecks(queue, res({ w1: 'W', w2: 'W', w3: 'W', x: 'L', w4: 'W' }));
    const { four } = assembleDeck(DECK_WIN, queue, decks, pin({ x: 'W' }));
    expect(four).toEqual(['x', 'w1', 'w2', 'w3']);
    expect(four).not.toContain('w4');
  });

  it('does not let a paddle pinned to one deck also fill the other', () => {
    const queue = ['w1', 'x', 'l1', 'l2', 'l3', 'l4'];
    const decks = splitDecks(queue, res({ w1: 'W', x: 'L', l1: 'L', l2: 'L', l3: 'L', l4: 'L' }));
    const pins = pin({ x: 'W' });
    expect(assembleDeck(DECK_WIN, queue, decks, pins).four).toEqual(['x', 'w1']);
    // x is a natural loser but is claimed by the winners deck, so the losers
    // deck fills from l1..l4 instead of leaving a hole where x sat.
    expect(assembleDeck(DECK_LOSE, queue, decks, pins).four).toEqual(['l1', 'l2', 'l3', 'l4']);
  });

  it('ignores a pin for a paddle who has left the rack', () => {
    const queue = ['w1', 'w2'];
    const decks = splitDecks(queue, res({ w1: 'W', w2: 'W' }));
    expect(assembleDeck(DECK_WIN, queue, decks, pin({ gone: 'W' })).four).toEqual(['w1', 'w2']);
  });

  it('is the plain front four when nothing is pinned', () => {
    const queue = rack(6);
    const decks = splitDecks(queue, res({ r1: 'W', r2: 'W', r3: 'W', r4: 'W', r5: 'W' }));
    expect(assembleDeck(DECK_WIN, queue, decks, new Map()).four).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('deckChallenge', () => {
  /** Build queue+decks for a winners bucket of `w` and a pinned-in set. */
  const setup = (winners, others) => {
    const queue = [...winners, ...others];
    const spec = Object.fromEntries([
      ...winners.map((id) => [id, 'W']),
      ...others.map((id) => [id, 'L']),
    ]);
    return { queue, decks: splitDecks(queue, res(spec)) };
  };

  it('is null while the pin displaces nobody', () => {
    // S1 before the game ends: 3 winners + 1 pin exactly fills the deck.
    const { queue, decks } = setup(['w1', 'w2', 'w3'], ['x', 'l1']);
    expect(deckChallenge(DECK_WIN, queue, decks, pin({ x: 'W' }))).toBeNull();
  });

  it('offers one winner against one pin (S1)', () => {
    const { queue, decks } = setup(['w1', 'w2', 'w3', 'w4'], ['x']);
    expect(deckChallenge(DECK_WIN, queue, decks, pin({ x: 'W' }))).toEqual({
      deck: DECK_WIN,
      challengers: ['w4'],
      pins: ['x'],
    });
  });

  it('offers two winners against two pins when a game returns both (S3)', () => {
    const { queue, decks } = setup(['w1', 'w2', 'w3', 'w4'], ['x', 'y']);
    expect(deckChallenge(DECK_WIN, queue, decks, pin({ x: 'W', y: 'W' }))).toEqual({
      deck: DECK_WIN,
      challengers: ['w3', 'w4'],
      pins: ['x', 'y'],
    });
  });

  it('offers two winners against three pins, leaving the organizer to choose (S5)', () => {
    const { queue, decks } = setup(['w1', 'w2', 'w3'], ['x', 'y', 'z']);
    expect(deckChallenge(DECK_WIN, queue, decks, pin({ x: 'W', y: 'W', z: 'W' }))).toEqual({
      deck: DECK_WIN,
      challengers: ['w2', 'w3'],
      pins: ['x', 'y', 'z'],
    });
  });

  it('never offers more winners than there are pins able to yield', () => {
    // Two winners displaced, but only one pin is still unlocked.
    const { queue, decks } = setup(['w1', 'w2', 'w3', 'w4'], ['x', 'y']);
    const challenge = deckChallenge(DECK_WIN, queue, decks, pin({ x: 'W', y: 'W!' }));
    expect(challenge).toEqual({ deck: DECK_WIN, challengers: ['w3'], pins: ['x'] });
  });

  it('is null once every pin in the deck is locked', () => {
    const { queue, decks } = setup(['w1', 'w2', 'w3', 'w4'], ['x']);
    expect(deckChallenge(DECK_WIN, queue, decks, pin({ x: 'W!' }))).toBeNull();
  });

  it('is null when nothing is pinned, however the bucket grows', () => {
    const { queue, decks } = setup(['w1', 'w2', 'w3', 'w4', 'w5'], ['l1']);
    expect(deckChallenge(DECK_WIN, queue, decks, new Map())).toBeNull();
  });

  it('reports the losers deck the same way', () => {
    // The same finished game returns two losers, which can contest a pin in
    // the other deck at the very same moment.
    const queue = ['l1', 'l2', 'l3', 'l4', 'x', 'w1'];
    const decks = splitDecks(
      queue,
      res({ l1: 'L', l2: 'L', l3: 'L', l4: 'L', x: 'W', w1: 'W' }),
    );
    expect(deckChallenge(DECK_LOSE, queue, decks, pin({ x: 'L' }))).toEqual({
      deck: DECK_LOSE,
      challengers: ['l4'],
      pins: ['x'],
    });
  });
});
