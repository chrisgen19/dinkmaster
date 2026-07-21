import { describe, it, expect } from 'vitest';
import { applyEvent, resolveCommand, OFFLINE_COMMANDS } from '@/lib/board-engine';
import { computeMatchRatings, RATING_BASELINE } from '@/lib/rating';

/** Deterministic PRNG (mulberry32) so shuffle outcomes are reproducible. */
function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const makePlayer = (id, overrides = {}) => ({
  id,
  userId: null,
  firstName: id.toUpperCase(),
  lastName: null,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  waitRounds: 0,
  rating: RATING_BASELINE,
  skipBoosted: false,
  gamesOffset: 0,
  ...overrides,
});

const makeCourt = (id, overrides = {}) => ({
  id,
  name: `Court ${id}`,
  status: 'vacant',
  team1: [],
  team2: [],
  fillBumpedPlayerIds: [],
  slots: [],
  ...overrides,
});

const makeState = (overrides = {}) => ({
  players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => makePlayer(id)),
  queue: ['a', 'b', 'c', 'd', 'e', 'f'],
  courts: [makeCourt('c1')],
  matchHistory: [],
  history: {},
  lastSessionResetAt: null,
  ...overrides,
});

const SETTINGS = {
  targetScore: 11,
  starveThreshold: 2,
  emergencyWait: 4,
  skipRestoresPriority: true,
  skipPickReplacement: true,
};

let idCounter = 0;
const opts = (seed = 1) => ({
  rng: seededRng(seed),
  now: () => '2026-07-20T09:00:00.000Z',
  makeId: (prefix) => `${prefix}_${++idCounter}`,
});

const playerIn = (state, id) => state.players.find((p) => p.id === id);

describe('OFFLINE_COMMANDS', () => {
  it('lists exactly the v1 offline scope', () => {
    expect(OFFLINE_COMMANDS).toEqual([
      'addPlayer',
      'checkIn',
      'checkOut',
      'shuffleQueue',
      'fillCourt',
      'cancelFill',
      'editCourtLineup',
      'endMatch',
      'skipPlayer',
    ]);
  });
});

describe('addPlayer', () => {
  it('creates a walk-in with the group-average offset, appended to the queue', () => {
    const state = makeState({
      players: [makePlayer('a', { gamesPlayed: 4 }), makePlayer('b', { gamesPlayed: 2 })],
      queue: ['a', 'b'],
    });
    const result = resolveCommand(state, SETTINGS, { type: 'addPlayer', firstName: ' Ana ', lastName: '' }, opts());
    expect(result.error).toBeUndefined();
    const created = result.state.players.at(-1);
    expect(created.firstName).toBe('Ana');
    expect(created.lastName).toBeNull();
    expect(created.gamesOffset).toBe(3); // round((4+2)/2)
    expect(created.rating).toBe(RATING_BASELINE);
    expect(result.state.queue.at(-1)).toBe(created.id);
    expect(result.event.payload.playerId).toBe(created.id);
    expect(result.event.outcome).toBeNull();
  });

  it('is a recorded-nothing no-op on a blank name and errors on an overlong name', () => {
    const state = makeState();
    expect(resolveCommand(state, SETTINGS, { type: 'addPlayer', firstName: '  ' }, opts())).toEqual({
      event: null,
      state,
    });
    const long = resolveCommand(
      state,
      SETTINGS,
      { type: 'addPlayer', firstName: 'x'.repeat(61) },
      opts(),
    );
    expect(long.error).toMatch(/too long/);
  });
});

describe('checkIn / checkOut', () => {
  it('checkIn appends and re-anchors gamesOffset to the group average', () => {
    const state = makeState({
      players: [
        makePlayer('a', { gamesPlayed: 6 }),
        makePlayer('b', { gamesPlayed: 2 }),
        makePlayer('c', { gamesPlayed: 4, waitRounds: 3, skipBoosted: true }),
      ],
      queue: ['a', 'b'],
    });
    const result = resolveCommand(state, SETTINGS, { type: 'checkIn', playerId: 'c' }, opts());
    expect(result.state.queue).toEqual(['a', 'b', 'c']);
    const c = playerIn(result.state, 'c');
    expect(c.gamesOffset).toBe(0); // round((6+2+4)/3)=4, minus own 4 games
    expect(c.waitRounds).toBe(0);
    expect(c.skipBoosted).toBe(false);
  });

  it('checkIn no-ops when already queued, on a playing court, or unknown', () => {
    const playing = makeState({
      courts: [makeCourt('c1', { status: 'playing', team1: ['e', 'f'], team2: ['a', 'b'] })],
      queue: ['c', 'd'],
    });
    for (const playerId of ['c', 'e', 'ghost']) {
      const result = resolveCommand(playing, SETTINGS, { type: 'checkIn', playerId }, opts());
      expect(result).toEqual({ event: null, state: playing });
    }
  });

  it('checkOut removes from the queue and resets wait fairness', () => {
    const state = makeState({
      players: makeState().players.map((p) => (p.id === 'b' ? { ...p, waitRounds: 2 } : p)),
    });
    const result = resolveCommand(state, SETTINGS, { type: 'checkOut', playerId: 'b' }, opts());
    expect(result.state.queue).toEqual(['a', 'c', 'd', 'e', 'f']);
    expect(playerIn(result.state, 'b').waitRounds).toBe(0);
    expect(
      resolveCommand(result.state, SETTINGS, { type: 'checkOut', playerId: 'b' }, opts()),
    ).toEqual({ event: null, state: result.state });
  });
});

describe('shuffleQueue', () => {
  it('records the full shuffled order and applies it', () => {
    const state = makeState();
    const result = resolveCommand(state, SETTINGS, { type: 'shuffleQueue' }, opts(42));
    expect([...result.event.outcome.order].sort()).toEqual([...state.queue].sort());
    expect(result.state.queue).toEqual(result.event.outcome.order);
  });

  it('no-ops with fewer than two waiting paddles', () => {
    const state = makeState({ queue: ['a'] });
    expect(resolveCommand(state, SETTINGS, { type: 'shuffleQueue' }, opts())).toEqual({
      event: null,
      state,
    });
  });
});

describe('fillCourt', () => {
  it('stacks the top four with the lowest-partnership matchup and full bookkeeping', () => {
    // a+b have played together twice, so the best split must separate them.
    const state = makeState({
      players: makeState().players.map((p) => (p.id === 'e' ? { ...p, waitRounds: 1 } : p)),
      history: { a: { b: 2 }, b: { a: 2 } },
    });
    const result = resolveCommand(state, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts());
    expect(result.error).toBeUndefined();

    const { team1, team2, players } = result.event.outcome;
    expect(players).toEqual(['a', 'b', 'c', 'd']);
    const together = (t) => t.includes('a') && t.includes('b');
    expect(together(team1) || together(team2)).toBe(false);

    const court = result.state.courts[0];
    expect(court.status).toBe('playing');
    expect(court.fillBumpedPlayerIds).toEqual(['e', 'f']);
    expect(court.slots).toHaveLength(4);
    expect(court.slots.map((s) => s.prevQueueOrder).sort((x, y) => x - y)).toEqual([1, 2, 3, 4]);

    expect(result.state.queue).toEqual(['e', 'f']);
    expect(playerIn(result.state, 'a').gamesPlayed).toBe(1);
    expect(playerIn(result.state, 'e').waitRounds).toBe(2);
    expect(playerIn(result.state, 'f').waitRounds).toBe(1);
    // Both new partnerships recorded symmetrically.
    expect(result.state.history[team1[0]][team1[1]]).toBe(1);
    expect(result.state.history[team2[1]][team2[0]]).toBe(1);
  });

  it('errors when the court is busy or fewer than four wait', () => {
    const busy = makeState({ courts: [makeCourt('c1', { status: 'playing' })] });
    expect(resolveCommand(busy, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts()).error).toMatch(
      /court or queue changed/,
    );
    const three = makeState({ queue: ['a', 'b', 'c'] });
    expect(resolveCommand(three, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts()).error).toMatch(
      /at least 4 players/,
    );
  });
});

describe('cancelFill', () => {
  it('exactly reverses a fill: queue order, waits, games, partnerships', () => {
    const state = makeState({
      players: makeState().players.map((p) => (p.id === 'e' ? { ...p, waitRounds: 3 } : p)),
    });
    const filled = resolveCommand(state, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts());
    const cancelled = resolveCommand(filled.state, SETTINGS, { type: 'cancelFill', courtId: 'c1' }, opts());

    expect(cancelled.state.queue).toEqual(state.queue);
    expect(cancelled.state.courts[0]).toEqual(state.courts[0]);
    for (const p of state.players) {
      expect(playerIn(cancelled.state, p.id)).toEqual(p);
    }
    // Partnership counts round-trip back to zero (kept as explicit zeros).
    const flat = Object.values(cancelled.state.history).flatMap((row) => Object.values(row));
    expect(flat.every((count) => count === 0)).toBe(true);
  });

  it('errors on a vacant court', () => {
    const state = makeState();
    expect(
      resolveCommand(state, SETTINGS, { type: 'cancelFill', courtId: 'c1' }, opts()).error,
    ).toMatch(/no longer active/);
  });
});

describe('endMatch', () => {
  const filledState = () => {
    const filled = resolveCommand(makeState(), SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts());
    return filled.state;
  };

  it('records the match, updates wins/losses and Elo, and recycles in outcome order', () => {
    const state = filledState();
    const court = state.courts[0];
    const result = resolveCommand(
      state,
      SETTINGS,
      { type: 'endMatch', courtId: 'c1', score1: '11', score2: '7', autoMix: false },
      opts(7),
    );
    expect(result.error).toBeUndefined();

    const match = result.state.matchHistory[0];
    expect(match.score1).toBe(11);
    expect(match.score2).toBe(7);
    expect(match.courtName).toBe('Court c1');
    expect(match.timestamp).toBe('2026-07-20T09:00:00.000Z');
    expect(match.team1.map((p) => p.id)).toEqual(court.team1);

    for (const id of court.team1) expect(playerIn(result.state, id).wins).toBe(1);
    for (const id of court.team2) expect(playerIn(result.state, id).losses).toBe(1);

    const expected = computeMatchRatings({
      team1: court.team1.map((id) => playerIn(state, id).rating),
      team2: court.team2.map((id) => playerIn(state, id).rating),
      outcome: 1,
    });
    expect(playerIn(result.state, court.team1[0]).rating).toBe(expected.team1[0]);
    expect(playerIn(result.state, court.team2[0]).rating).toBe(expected.team2[0]);

    expect(result.state.queue).toEqual(['e', 'f', ...result.event.outcome.recycleOrder]);
    expect(result.event.outcome.mixedOrder).toBeNull();
    expect(result.state.courts[0].status).toBe('vacant');
  });

  it('auto-mixes the post-recycle rack, elevating protected waiters and consuming boosts', () => {
    const base = filledState();
    // e has waited past the starve threshold; f is boosted next-in-line.
    const state = {
      ...base,
      players: base.players.map((p) => {
        if (p.id === 'e') return { ...p, waitRounds: SETTINGS.starveThreshold };
        if (p.id === 'f') return { ...p, skipBoosted: true };
        return p;
      }),
    };
    const result = resolveCommand(
      state,
      SETTINGS,
      { type: 'endMatch', courtId: 'c1', score1: '7', score2: '11', autoMix: true },
      opts(9),
    );
    const mixed = result.event.outcome.mixedOrder;
    expect(result.state.queue).toEqual(mixed);
    // Band order: boosted (3) first, then protected (1) ahead of the fresh four.
    expect(mixed[0]).toBe('f');
    expect(mixed[1]).toBe('e');
    expect(playerIn(result.state, 'f').skipBoosted).toBe(false);
    expect(result.notification).toMatch(/Silo-Buster/);
  });

  it('rejects an invalid scoreline and a finished court', () => {
    const state = filledState();
    expect(
      resolveCommand(state, SETTINGS, { type: 'endMatch', courtId: 'c1', score1: '11', score2: '10' }, opts())
        .error,
    ).toBeTruthy();
    const vacant = makeState();
    expect(
      resolveCommand(vacant, SETTINGS, { type: 'endMatch', courtId: 'c1', score1: '11', score2: '7' }, opts())
        .error,
    ).toMatch(/no longer active/);
  });

  it('applyEvent rejects a tampered recycle order', () => {
    const state = filledState();
    const result = resolveCommand(
      state,
      SETTINGS,
      { type: 'endMatch', courtId: 'c1', score1: '11', score2: '7', autoMix: false },
      opts(),
    );
    const tampered = {
      ...result.event,
      outcome: { ...result.event.outcome, recycleOrder: ['a', 'b', 'c', 'e'] },
    };
    expect(applyEvent(state, SETTINGS, tampered)).toEqual({ error: 'STATE_MISMATCH' });
  });
});

describe('skipPlayer', () => {
  it('restore-priority mode: skipped lands just past on-deck with the boost set', () => {
    const state = makeState();
    const result = resolveCommand(
      state,
      SETTINGS,
      { type: 'skipPlayer', playerId: 'b', isManager: true },
      opts(),
    );
    expect(result.state.queue).toEqual(['a', 'c', 'd', 'e', 'b', 'f']);
    expect(playerIn(result.state, 'b').skipBoosted).toBe(true);
    expect(result.notification).toMatch(/Next in Line/);
  });

  it('manager replacement pick pulls the chosen waiter on deck', () => {
    const state = makeState();
    const result = resolveCommand(
      state,
      SETTINGS,
      { type: 'skipPlayer', playerId: 'b', replacementId: 'f', isManager: true },
      opts(),
    );
    expect(result.state.queue).toEqual(['a', 'c', 'd', 'f', 'b', 'e']);
  });

  it('legacy mode sends the paddle to the back with wait reset', () => {
    const settings = { ...SETTINGS, skipRestoresPriority: false };
    const state = makeState({
      players: makeState().players.map((p) => (p.id === 'b' ? { ...p, waitRounds: 5 } : p)),
    });
    const result = resolveCommand(state, settings, { type: 'skipPlayer', playerId: 'b', isManager: true }, opts());
    expect(result.state.queue).toEqual(['a', 'c', 'd', 'e', 'f', 'b']);
    expect(playerIn(result.state, 'b').waitRounds).toBe(0);
  });

  it('errors match the server copy for bad replacement picks', () => {
    const state = makeState();
    expect(
      resolveCommand(state, SETTINGS, { type: 'skipPlayer', playerId: 'b', replacementId: 'ghost', isManager: true }, opts())
        .error,
    ).toMatch(/no longer available/);
    expect(
      resolveCommand(state, SETTINGS, { type: 'skipPlayer', playerId: 'b', replacementId: 'a', isManager: true }, opts())
        .error,
    ).toMatch(/already on deck/);
  });

  it('no-ops for an off-deck paddle or when nobody waits behind on-deck', () => {
    const state = makeState();
    expect(
      resolveCommand(state, SETTINGS, { type: 'skipPlayer', playerId: 'f', isManager: true }, opts()),
    ).toEqual({ event: null, state });
    const four = makeState({ queue: ['a', 'b', 'c', 'd'] });
    expect(
      resolveCommand(four, SETTINGS, { type: 'skipPlayer', playerId: 'a', isManager: true }, opts()),
    ).toEqual({ event: null, state: four });
  });
});

describe('editCourtLineup', () => {
  // Fill c1 (a,b,c,d on court), leaving e,f waiting.
  const filledState = () =>
    resolveCommand(makeState(), SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts()).state;
  const onCourt = (state) => {
    const c = state.courts[0];
    return { team1: c.team1, team2: c.team2 };
  };

  it('swaps partners without touching the rack, adjusting the partnership matrix', () => {
    const state = filledState();
    const { team1, team2 } = onCourt(state);
    // Repartner: one from each team trades sides.
    const nextT1 = [team1[0], team2[0]];
    const nextT2 = [team1[1], team2[1]];
    const result = resolveCommand(
      state,
      SETTINGS,
      { type: 'editCourtLineup', courtId: 'c1', team1Ids: nextT1, team2Ids: nextT2 },
      opts(),
    );
    expect(result.error).toBeUndefined();
    expect(result.state.queue).toEqual(state.queue); // rack untouched
    expect(new Set(result.state.courts[0].team1)).toEqual(new Set(nextT1));
    // Old pairs decremented to zero, new pairs at one.
    expect(result.state.history[team1[0]][team1[1]]).toBe(0);
    expect(result.state.history[nextT1[0]][nextT1[1]]).toBe(1);
    expect(result.state.history[nextT2[0]][nextT2[1]]).toBe(1);
  });

  it('substitutes a waiter in: dequeues them, returns the subbed-out paddle to the front', () => {
    const state = filledState();
    const { team1, team2 } = onCourt(state);
    const out = team1[0];
    const inPlayer = 'e'; // first waiter
    const result = resolveCommand(
      state,
      SETTINGS,
      { type: 'editCourtLineup', courtId: 'c1', team1Ids: [inPlayer, team1[1]], team2Ids: team2 },
      opts(),
    );
    expect(result.error).toBeUndefined();
    // e left the rack and onto the court (games credited); out returned to front.
    expect(result.state.queue[0]).toBe(out);
    expect(result.state.queue).not.toContain(inPlayer);
    expect(playerIn(result.state, inPlayer).gamesPlayed).toBe(1);
    expect(playerIn(result.state, out).gamesPlayed).toBe(0); // credit undone
    // Restore-priority default: the subbed-out paddle is Next-in-Line.
    expect(playerIn(result.state, out).skipBoosted).toBe(true);
    // Court slots carry a snapshot for the incoming player (cancel-safe).
    const inSlot = result.state.courts[0].slots.find((s) => s.playerId === inPlayer);
    expect(inSlot.prevQueueOrder).not.toBeNull();
  });

  it('legacy mode sends the subbed-out paddle back with no boost', () => {
    const settings = { ...SETTINGS, skipRestoresPriority: false };
    const state = resolveCommand(makeState(), settings, { type: 'fillCourt', courtId: 'c1' }, opts()).state;
    const { team1, team2 } = onCourt(state);
    const out = team1[0];
    const result = resolveCommand(
      state,
      settings,
      { type: 'editCourtLineup', courtId: 'c1', team1Ids: ['e', team1[1]], team2Ids: team2 },
      opts(),
    );
    expect(playerIn(result.state, out).skipBoosted).toBe(false);
    expect(playerIn(result.state, out).waitRounds).toBe(0);
  });

  it('a subbed fill round-trips through cancelFill back to the pre-fill rack', () => {
    // e has waited a round; verify the sub + cancel restores everyone exactly.
    const base = makeState({
      players: makeState().players.map((p) => (p.id === 'e' ? { ...p, waitRounds: 1 } : p)),
    });
    const filled = resolveCommand(base, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts()).state;
    const { team1, team2 } = onCourt(filled);
    const edited = resolveCommand(
      filled,
      SETTINGS,
      { type: 'editCourtLineup', courtId: 'c1', team1Ids: ['e', team1[1]], team2Ids: team2 },
      opts(),
    ).state;
    const cancelled = resolveCommand(edited, SETTINGS, { type: 'cancelFill', courtId: 'c1' }, opts()).state;
    // The court is vacant and everyone is back on the rack with games at zero.
    expect(cancelled.courts[0].status).toBe('vacant');
    for (const p of base.players) {
      expect(playerIn(cancelled, p.id).gamesPlayed).toBe(0);
    }
    // e's pre-fill wait fairness survived the sub and cancel.
    expect(playerIn(cancelled, 'e').waitRounds).toBe(1);
    // The subbed-in waiter (e) must restore AFTER the players who stayed on
    // court, matching the server: its slot snapshot sorts past theirs. A raw
    // queue-index snapshot would sort e first and diverge from the replay.
    const stayed = [team1[1], team2[0], team2[1]];
    const qIndex = (id) => cancelled.queue.indexOf(id);
    for (const s of stayed) expect(qIndex('e')).toBeGreaterThan(qIndex(s));
  });

  it('rejects an invalid lineup and a subbed-in player who is not waiting', () => {
    const state = filledState();
    const { team1, team2 } = onCourt(state);
    // Not four distinct players.
    expect(
      resolveCommand(
        state,
        SETTINGS,
        { type: 'editCourtLineup', courtId: 'c1', team1Ids: [team1[0], team1[0]], team2Ids: team2 },
        opts(),
      ).error,
    ).toMatch(/four different players/);
    // Sub in someone who is on ANOTHER court, not the rack.
    const twoCourts = {
      ...state,
      courts: [state.courts[0], makeCourt('c2', { status: 'playing', team1: ['e', 'f'], team2: [] })],
    };
    expect(
      resolveCommand(
        twoCourts,
        SETTINGS,
        { type: 'editCourtLineup', courtId: 'c1', team1Ids: ['e', team1[1]], team2Ids: team2 },
        opts(),
      ).error,
    ).toMatch(/rack changed/);
  });

  it('errors on a vacant court and no-ops an unchanged lineup', () => {
    const vacant = makeState();
    expect(
      resolveCommand(
        vacant,
        SETTINGS,
        { type: 'editCourtLineup', courtId: 'c1', team1Ids: ['a', 'b'], team2Ids: ['c', 'd'] },
        opts(),
      ).error,
    ).toMatch(/no longer active/);
    const state = filledState();
    const { team1, team2 } = onCourt(state);
    // Same lineup, same sides: no change to record.
    expect(
      resolveCommand(
        state,
        SETTINGS,
        { type: 'editCourtLineup', courtId: 'c1', team1Ids: team1, team2Ids: team2 },
        opts(),
      ),
    ).toEqual({ event: null, state });
  });
});

describe('replay determinism and purity', () => {
  it('applyEvent(resolveCommand(...).event) reproduces the identical state', () => {
    const state = makeState({ history: { a: { d: 1 }, d: { a: 1 } } });
    const resolved = resolveCommand(state, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts(1234));
    const replayed = applyEvent(state, SETTINGS, resolved.event);
    expect(replayed.state).toEqual(resolved.state);
  });

  it('never mutates the input state', () => {
    const state = makeState();
    const frozen = JSON.parse(JSON.stringify(state));
    resolveCommand(state, SETTINGS, { type: 'fillCourt', courtId: 'c1' }, opts(5));
    resolveCommand(state, SETTINGS, { type: 'shuffleQueue' }, opts(5));
    resolveCommand(state, SETTINGS, { type: 'checkOut', playerId: 'a' }, opts(5));
    expect(state).toEqual(frozen);
  });
});
