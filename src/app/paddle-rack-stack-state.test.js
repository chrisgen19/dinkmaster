import { describe, it, expect } from 'vitest';
import {
  buildRackSections,
  deriveRackRow,
  fullName,
  initials,
  ON_DECK_SIZE,
  pruneDrafted,
} from './paddle-rack-stack-state';
import { splitDecks } from '@/lib/decks';

const opts = { viewerUserId: 'u-me', starveThreshold: 2, emergencyWait: 4 };
const player = (over = {}) => ({
  id: 'p1',
  userId: 'u-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  waitRounds: 0,
  ...over,
});

describe('fullName', () => {
  it('joins first and last name', () => {
    expect(fullName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
  });
  it('uses first name alone when last name is missing', () => {
    expect(fullName({ firstName: 'Ada', lastName: null })).toBe('Ada');
  });
  it('falls back to Unknown for malformed rows', () => {
    expect(fullName(null)).toBe('Unknown');
    expect(fullName({})).toBe('Unknown');
  });
});

describe('initials', () => {
  it('takes first letter of first and last name, uppercased', () => {
    expect(initials({ firstName: 'ada', lastName: 'lovelace' })).toBe('AL');
  });
  it('uses just the first initial when no last name', () => {
    expect(initials({ firstName: 'Ada', lastName: null })).toBe('A');
  });
  it('falls back to "?" when nothing usable', () => {
    expect(initials(null)).toBe('?');
    expect(initials({})).toBe('?');
  });
});

describe('deriveRackRow — rank + on-deck boundary', () => {
  it('rank is the 1-based queue position', () => {
    expect(deriveRackRow(player(), 0, opts).rank).toBe(1);
    expect(deriveRackRow(player(), 7, opts).rank).toBe(8);
  });

  it(`marks the first ${ON_DECK_SIZE} as on deck and the rest as waiting`, () => {
    for (let i = 0; i < ON_DECK_SIZE; i++) {
      expect(deriveRackRow(player(), i, opts).isOnDeck).toBe(true);
    }
    // index === ON_DECK_SIZE is the first waiting row (the boundary)
    expect(deriveRackRow(player(), ON_DECK_SIZE, opts).isOnDeck).toBe(false);
    expect(deriveRackRow(player(), ON_DECK_SIZE + 3, opts).isOnDeck).toBe(false);
  });
});

describe('deriveRackRow — you / walk-in flags', () => {
  it('flags the viewer\'s own row', () => {
    expect(deriveRackRow(player({ userId: 'u-me' }), 0, opts).isYou).toBe(true);
    expect(deriveRackRow(player({ userId: 'u-1' }), 0, opts).isYou).toBe(false);
  });
  it('flags accountless rows as walk-ins (and never "you")', () => {
    const row = deriveRackRow(player({ userId: null }), 0, opts);
    expect(row.isWalkIn).toBe(true);
    expect(row.isYou).toBe(false);
  });
  it('a linked player is not a walk-in', () => {
    expect(deriveRackRow(player({ userId: 'u-1' }), 0, opts).isWalkIn).toBe(false);
  });
});

describe('deriveRackRow — wait badge severity', () => {
  it('no badge below the starve threshold', () => {
    expect(deriveRackRow(player({ waitRounds: 0 }), 0, opts).badge).toBe('none');
    expect(deriveRackRow(player({ waitRounds: 1 }), 0, opts).badge).toBe('none');
  });
  it('warn at the starve threshold (inclusive), below emergency', () => {
    expect(deriveRackRow(player({ waitRounds: 2 }), 0, opts).badge).toBe('warn');
    expect(deriveRackRow(player({ waitRounds: 3 }), 0, opts).badge).toBe('warn');
  });
  it('emergency at the emergency threshold (inclusive)', () => {
    expect(deriveRackRow(player({ waitRounds: 4 }), 0, opts).badge).toBe('emergency');
    expect(deriveRackRow(player({ waitRounds: 9 }), 0, opts).badge).toBe('emergency');
  });
  it('defaults waitRounds to 0 for malformed rows', () => {
    expect(deriveRackRow({ userId: 'u-1' }, 0, opts).waitRounds).toBe(0);
    expect(deriveRackRow({ userId: 'u-1' }, 0, opts).badge).toBe('none');
  });
  it('skipBoosted wins over every wait-based badge', () => {
    // Even at zero wait, a returning skipper shows next-line.
    expect(deriveRackRow(player({ waitRounds: 0, skipBoosted: true }), 0, opts).badge).toBe('next-line');
    // And the wait-based bands are suppressed in favor of next-line.
    expect(deriveRackRow(player({ waitRounds: 9, skipBoosted: true }), 0, opts).badge).toBe('next-line');
  });
});

describe('deriveRackRow — canSkip gating', () => {
  const skipOpts = { ...opts, canManage: false, queueLength: 8 };

  it('managers can skip any on-deck paddle', () => {
    const row = deriveRackRow(player({ userId: 'u-other' }), 1, { ...skipOpts, canManage: true });
    expect(row.canSkip).toBe(true);
  });

  it('a member can skip their own on-deck paddle (self-service)', () => {
    const row = deriveRackRow(player({ userId: 'u-me' }), 1, { ...skipOpts, canManage: false });
    expect(row.isYou).toBe(true);
    expect(row.canSkip).toBe(true);
  });

  it('a non-manager cannot skip someone else\'s paddle', () => {
    const row = deriveRackRow(player({ userId: 'u-other' }), 1, { ...skipOpts, canManage: false });
    expect(row.canSkip).toBe(false);
  });

  it('waiting (off-deck) paddles cannot skip, even for a manager', () => {
    const row = deriveRackRow(player({ userId: 'u-me' }), ON_DECK_SIZE, { ...skipOpts, canManage: true });
    expect(row.isOnDeck).toBe(false);
    expect(row.canSkip).toBe(false);
  });

  it('no skip when nobody waits behind the on-deck group (queueLength <= ON_DECK_SIZE)', () => {
    const row = deriveRackRow(player({ userId: 'u-me' }), 0, { ...skipOpts, canManage: true, queueLength: ON_DECK_SIZE });
    expect(row.canSkip).toBe(false);
  });

  it('defaults (no canManage/queueLength) yield canSkip false', () => {
    expect(deriveRackRow(player({ userId: 'u-me' }), 0, opts).canSkip).toBe(false);
  });
});

describe('deriveRackRow — profileHref (name → profile link)', () => {
  it('own row links to /profile regardless of membership', () => {
    expect(deriveRackRow(player({ userId: 'u-me' }), 0, opts).profileHref).toBe('/profile');
  });

  it('another registered player links to /u/[userId] only for a member', () => {
    expect(
      deriveRackRow(player({ userId: 'u-1' }), 0, { ...opts, viewerIsMember: true }).profileHref,
    ).toBe('/u/u-1');
    // Non-member (spectator) gets no link — they share no arena, would 404.
    expect(deriveRackRow(player({ userId: 'u-1' }), 0, { ...opts, viewerIsMember: false }).profileHref).toBeNull();
  });

  it('a walk-in links to /p/[playerId] only for a member', () => {
    expect(
      deriveRackRow(player({ id: 'p9', userId: null }), 0, { ...opts, viewerIsMember: true }).profileHref,
    ).toBe('/p/p9');
    expect(deriveRackRow(player({ userId: null }), 0, { ...opts, viewerIsMember: false }).profileHref).toBeNull();
  });

  it('defaults to no link when viewerIsMember is omitted', () => {
    expect(deriveRackRow(player({ userId: 'u-1' }), 0, opts).profileHref).toBeNull();
    expect(deriveRackRow(player({ userId: null }), 0, opts).profileHref).toBeNull();
  });
});

describe('deriveRackRow — win/lose decks', () => {
  // Deck mode makes "on deck" bucket-relative: a paddle at rack position 7 can
  // be on deck if it is fourth in its own deck.
  it('reads on-deck from the deck position, not the rack position', () => {
    const row = deriveRackRow(player(), 6, { ...opts, bucketIndex: 3, bucketLength: 6 });
    expect(row.isOnDeck).toBe(true);
    // ...while the badge still counts the real rack.
    expect(row.rank).toBe(7);
  });

  it('marks a paddle off-deck once it is fifth in its own deck', () => {
    expect(deriveRackRow(player(), 4, { ...opts, bucketIndex: 4, bucketLength: 9 }).isOnDeck).toBe(false);
  });

  it('gates skip on someone waiting in the SAME deck', () => {
    const canSkipWith = (bucketLength) =>
      deriveRackRow(player({ userId: 'u-me' }), 0, {
        ...opts,
        canManage: true,
        // A long rack overall...
        queueLength: 20,
        bucketIndex: 0,
        // ...but this deck is exactly four deep, so nobody can take the slot.
        bucketLength,
      }).canSkip;
    expect(canSkipWith(ON_DECK_SIZE)).toBe(false);
    expect(canSkipWith(ON_DECK_SIZE + 1)).toBe(true);
  });

  it('falls back to the rack when no bucket is given', () => {
    // Classic mode passes neither, and must behave exactly as before.
    const row = deriveRackRow(player({ userId: 'u-me' }), 0, { ...opts, canManage: true, queueLength: 6 });
    expect(row.isOnDeck).toBe(true);
    expect(row.canSkip).toBe(true);
  });
});

describe('pruneDrafted', () => {
  it('forgets a hand-added paddle once they leave the rack', () => {
    // The reported bug: a paddle added to the winners deck goes on court, the
    // game ends, they return — and drop straight back into that deck flagged
    // "Added", as though the organizer picked them a second time. Dropping the
    // id when they leave is what stops it coming back with them.
    const drafted = { W: ['ben', 'ana'], L: [] };
    expect(pruneDrafted(drafted, ['ana', 'cai'])).toEqual({ W: ['ana'], L: [] });
  });

  it('prunes both decks', () => {
    const drafted = { W: ['gone-w'], L: ['gone-l', 'here'] };
    expect(pruneDrafted(drafted, ['here'])).toEqual({ W: [], L: ['here'] });
  });

  it('returns the SAME object when nothing is stale', () => {
    // Identity matters: the caller adjusts state during render, so a fresh
    // object every time would loop forever.
    const drafted = { W: ['ana'], L: ['ben'] };
    expect(pruneDrafted(drafted, ['ana', 'ben', 'cai'])).toBe(drafted);
    expect(pruneDrafted({ W: [], L: [] }, [])).not.toBeUndefined();
  });

  it('keeps a draft when some OTHER four went on court', () => {
    // Those paddles are still racked, so the organizer's staging still stands —
    // and since they didn't play, their W/L hasn't changed either.
    const drafted = { W: ['ben'], L: [] };
    expect(pruneDrafted(drafted, ['ben', 'cai', 'dev'])).toBe(drafted);
  });
});

describe('buildRackSections', () => {
  const rack = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('draws one on-deck group and a waiting group without decks', () => {
    const sections = buildRackSections(rack);
    expect(sections.map((s) => s.label)).toEqual(['On deck · next court', 'Waiting · 2']);
    expect(sections[0].rows.map((r) => r.playerId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops the waiting group when the rack is exactly a court', () => {
    expect(buildRackSections(['a', 'b', 'c', 'd']).map((s) => s.key)).toEqual(['on-deck']);
  });

  it('carries each row\'s most recent result for the W/L chip', () => {
    const results = new Map([['a', 'W'], ['b', 'L'], ['c', null]]);
    const [onDeck] = buildRackSections(rack, { results });
    expect(onDeck.rows.map((r) => r.lastResult)).toEqual([
      'W',
      'L',
      // No game this session (explicit null, and 'd' is absent from the map
      // entirely) — both mean no chip rather than a chip reading "nothing yet".
      null,
      null,
    ]);
  });

  it('leaves every row unlabelled when no results are given', () => {
    const [onDeck] = buildRackSections(rack);
    expect(onDeck.rows.every((r) => r.lastResult === null)).toBe(true);
  });

  it('groups by deck, keeping each row\'s true rack position', () => {
    // Interleaved rack: winners at 1,3,5,7, losers at 2,4,6,8.
    const eight = ['w1', 'l1', 'w2', 'l2', 'w3', 'l3', 'w4', 'l4'];
    const decks = splitDecks(eight, new Map(eight.map((id) => [id, id[0] === 'w' ? 'W' : 'L'])));
    const sections = buildRackSections(eight, { decks, nextDeck: 'W' });

    expect(sections.map((s) => s.key)).toEqual(['winners', 'losers']);
    expect(sections[0].rows.map((r) => r.playerId)).toEqual(['w1', 'w2', 'w3', 'w4']);
    // w3 is third in its deck but FIFTH in the rack — that's what the badge shows.
    expect(sections[0].rows[2]).toMatchObject({ playerId: 'w3', rackIndex: 4, bucketIndex: 2 });
    expect(sections[0].isNext).toBe(true);
    expect(sections[1].isNext).toBe(false);
  });

  it('reports how many a short deck still needs', () => {
    const six = ['w1', 'l1', 'w2', 'l2', 'l3', 'l4'];
    const decks = splitDecks(six, new Map(six.map((id) => [id, id[0] === 'w' ? 'W' : 'L'])));
    const [winners, losers] = buildRackSections(six, { decks });
    expect(winners.short).toBe(2);
    expect(losers.short).toBe(0);
  });

  describe('hand-topping a short deck', () => {
    // Two recent winners, four losers: the winners deck can't stack on its own.
    const six = ['w1', 'l1', 'w2', 'l2', 'l3', 'l4'];
    const sixDecks = splitDecks(six, new Map(six.map((id) => [id, id[0] === 'w' ? 'W' : 'L'])));

    it('fills the empty slots with the drafted paddles', () => {
      const [winners] = buildRackSections(six, {
        decks: sixDecks,
        drafted: { W: ['l3', 'l4'] },
      });
      expect(winners.rows.map((r) => r.playerId)).toEqual(['w1', 'w2', 'l3', 'l4']);
      expect(winners.short).toBe(0);
      expect(winners.rows.map((r) => r.isDrafted)).toEqual([false, false, true, true]);
    });

    it('takes the drafted paddles out of the deck they came from', () => {
      // l3 and l4 were in the losers deck; they must not appear twice.
      const [winners, losers] = buildRackSections(six, {
        decks: sixDecks,
        drafted: { W: ['l3', 'l4'] },
      });
      expect(losers.rows.map((r) => r.playerId)).toEqual(['l1', 'l2']);
      const everyone = [...winners.rows, ...losers.rows].map((r) => r.playerId);
      expect(new Set(everyone).size).toBe(everyone.length);
    });

    it('takes them out of Waiting too', () => {
      const eight = [...six, 'l5', 'l6'];
      const decks = splitDecks(eight, new Map(eight.map((id) => [id, id[0] === 'w' ? 'W' : 'L'])));
      const sections = buildRackSections(eight, { decks, drafted: { W: ['l5', 'l6'] } });
      const waiting = sections.find((s) => s.key === 'waiting');
      expect(waiting).toBeUndefined();
    });

    it('offers its own stack button only once hand-completed', () => {
      const short = buildRackSections(six, { decks: sixDecks })[0];
      expect(short.canStack).toBe(false);

      const partly = buildRackSections(six, { decks: sixDecks, drafted: { W: ['l3'] } })[0];
      expect(partly.short).toBe(1);
      expect(partly.canStack).toBe(false);

      const full = buildRackSections(six, { decks: sixDecks, drafted: { W: ['l3', 'l4'] } })[0];
      expect(full.canStack).toBe(true);
    });

    it('leaves a naturally full deck alone — that one stacks from the court', () => {
      // Otherwise every full deck would sprout a button that bypasses the
      // W -> L -> W rotation.
      const eight = ['w1', 'w2', 'w3', 'w4', 'l1', 'l2', 'l3', 'l4'];
      const decks = splitDecks(eight, new Map(eight.map((id) => [id, id[0] === 'w' ? 'W' : 'L'])));
      const [winners] = buildRackSections(eight, { decks });
      expect(winners.short).toBe(0);
      expect(winners.canStack).toBe(false);
    });

    it('measures a drafted paddle against the assembled four, not their old bucket', () => {
      // They ARE on deck now, so the row must read that way; and a four-long
      // bucket means no Skip — the organizer removes them with the row's ✕
      // instead, which is the reversal that makes sense for a hand-added
      // paddle.
      const [winners] = buildRackSections(six, {
        decks: sixDecks,
        drafted: { W: ['l3', 'l4'] },
      });
      const [, , third, fourth] = winners.rows;
      expect(third).toMatchObject({ playerId: 'l3', bucketIndex: 2, bucketLength: 4 });
      expect(fourth).toMatchObject({ playerId: 'l4', bucketIndex: 3, bucketLength: 4 });
    });

    it('caps a deck at four however many are drafted', () => {
      const [winners] = buildRackSections(six, {
        decks: sixDecks,
        drafted: { W: ['l1', 'l2', 'l3', 'l4'] },
      });
      expect(winners.rows).toHaveLength(4);
    });

    it('ignores a drafted paddle that has left the rack', () => {
      // They were pulled onto a court (or unracked) between the pick and the
      // repaint; the slot just goes back to empty.
      const [winners] = buildRackSections(six, {
        decks: sixDecks,
        drafted: { W: ['gone', 'l3'] },
      });
      expect(winners.rows.map((r) => r.playerId)).toEqual(['w1', 'w2', 'l3']);
      expect(winners.short).toBe(1);
    });

    it('keeps an empty deck visible while it has slots to fill', () => {
      // Nobody has won yet, so the winners deck has no rows at all — but it
      // still has to render, or there is nothing to add the first paddle to.
      const losersOnly = ['l1', 'l2', 'l3', 'l4'];
      const decks = { winners: [], losers: losersOnly, winnersDeck: [], losersDeck: losersOnly };
      const [winners] = buildRackSections(losersOnly, { decks });
      expect(winners.key).toBe('winners');
      expect(winners.rows).toEqual([]);
      expect(winners.short).toBe(4);
    });
  });

  it('puts everyone past both decks in one waiting group', () => {
    const ten = ['w1', 'w2', 'w3', 'w4', 'w5', 'l1', 'l2', 'l3', 'l4', 'l5'];
    const decks = splitDecks(ten, new Map(ten.map((id) => [id, id[0] === 'w' ? 'W' : 'L'])));
    const sections = buildRackSections(ten, { decks });
    const waiting = sections.find((s) => s.key === 'waiting');
    expect(waiting.label).toBe('Waiting · 2');
    expect(waiting.rows.map((r) => r.playerId)).toEqual(['w5', 'l5']);
    // A waiting row's bucket is still its own deck, so its skip gate is right.
    expect(waiting.rows[0]).toMatchObject({ bucketIndex: 4, bucketLength: 5 });
  });
});
