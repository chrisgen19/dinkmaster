import { describe, it, expect } from 'vitest';
import { boardFingerprint, canonicalBoardString, fnv1a } from '@/lib/board-fingerprint';

const SETTINGS = {
  targetScore: 11,
  starveThreshold: 2,
  emergencyWait: 4,
  skipRestoresPriority: true,
  skipPickReplacement: true,
  balancedPairing: true,
};

const player = (id, overrides = {}) => ({
  id,
  waitRounds: 0,
  gamesPlayed: 0,
  gamesOffset: 0,
  wins: 0,
  losses: 0,
  rating: 1000,
  skipBoosted: false,
  ...overrides,
});

const baseState = () => ({
  players: [player('a'), player('b')],
  queue: ['a', 'b'],
  courts: [
    { id: 'c1', status: 'vacant', slots: [] },
  ],
  history: {},
});

describe('fnv1a', () => {
  it('is deterministic and 8 hex chars', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
});

describe('boardFingerprint', () => {
  it('is stable across input ordering (players, courts, slots, pairs)', () => {
    const a = {
      players: [player('a'), player('b')],
      queue: ['a', 'b'],
      courts: [
        { id: 'c1', status: 'playing', slots: [{ playerId: 'a', team: 1, prevQueueOrder: 1 }, { playerId: 'b', team: 2 }] },
        { id: 'c2', status: 'vacant', slots: [] },
      ],
      history: { a: { b: 2 }, b: { a: 2 } },
    };
    const b = {
      players: [player('b'), player('a')], // reordered
      queue: ['a', 'b'],
      courts: [
        { id: 'c2', status: 'vacant', slots: [] }, // reordered
        { id: 'c1', status: 'playing', slots: [{ playerId: 'b', team: 2 }, { playerId: 'a', team: 1 }] },
      ],
      history: { b: { a: 2 }, a: { b: 2 } },
    };
    expect(boardFingerprint(a, SETTINGS)).toBe(boardFingerprint(b, SETTINGS));
  });

  it('changes when queue ORDER changes, even with identical membership', () => {
    const s1 = baseState();
    const s2 = { ...baseState(), queue: ['b', 'a'] };
    expect(boardFingerprint(s1, SETTINGS)).not.toBe(boardFingerprint(s2, SETTINGS));
  });

  it('changes on any tracked player field, court status, or partnership count', () => {
    const base = boardFingerprint(baseState(), SETTINGS);
    const bumpedWait = { ...baseState(), players: [player('a', { waitRounds: 1 }), player('b')] };
    const playingCourt = { ...baseState(), courts: [{ id: 'c1', status: 'playing', slots: [] }] };
    const withPair = { ...baseState(), history: { a: { b: 1 }, b: { a: 1 } } };
    for (const changed of [bumpedWait, playingCourt, withPair]) {
      expect(boardFingerprint(changed, SETTINGS)).not.toBe(base);
    }
  });

  it('changes when settings change (a concurrent settings save must diverge)', () => {
    const state = baseState();
    expect(boardFingerprint(state, SETTINGS)).not.toBe(
      boardFingerprint(state, { ...SETTINGS, targetScore: 15 }),
    );
  });

  it('ignores zero-count partnerships (cancel round-trips leave explicit zeros)', () => {
    const withZeros = { ...baseState(), history: { a: { b: 0 }, b: { a: 0 } } };
    expect(boardFingerprint(withZeros, SETTINGS)).toBe(boardFingerprint(baseState(), SETTINGS));
  });

  it('ignores slot restore snapshots and match history', () => {
    const s1 = {
      ...baseState(),
      courts: [{ id: 'c1', status: 'playing', slots: [{ playerId: 'a', team: 1, prevQueueOrder: 3, prevWaitRounds: 2 }] }],
    };
    const s2 = {
      ...baseState(),
      matchHistory: [{ id: 'm1' }],
      courts: [{ id: 'c1', status: 'playing', slots: [{ playerId: 'a', team: 1, prevQueueOrder: 9, prevWaitRounds: 0 }] }],
    };
    expect(boardFingerprint(s1, SETTINGS)).toBe(boardFingerprint(s2, SETTINGS));
  });

  it('canonical string spells out every hashed section', () => {
    const text = canonicalBoardString(baseState(), SETTINGS);
    expect(text).toContain('p:a|0|0|0|0|0|1000|0;b|0|0|0|0|0|1000|0');
    expect(text).toContain('q:a,b');
    expect(text).toContain('c:c1|vacant|');
    expect(text).toContain('h:');
    // Anchored to end-of-string, not `toContain`: the rules section is last,
    // and a substring match silently passes when a NEW rule is appended —
    // which is exactly how `balancedPairing` slipped in unasserted.
    expect(text).toMatch(/\ns:11\|2\|4\|1\|1$/);
  });

  it('changes when the pairing mode is toggled', () => {
    // The whole point of hashing the rules: a device that ran a session under
    // a different team-split rule produced a board the server would not have,
    // so its pending batch must not sync clean.
    const legacy = { ...SETTINGS, balancedPairing: false };
    expect(boardFingerprint(baseState(), legacy)).not.toBe(boardFingerprint(baseState(), SETTINGS));
    expect(canonicalBoardString(baseState(), legacy)).toMatch(/\ns:11\|2\|4\|1\|1\|0$/);
  });

  it('treats a settings snapshot with no pairing mode as ON', () => {
    // Back-compat: a pending log captured before this setting existed must
    // hash the same as one captured with it explicitly on, so an in-flight
    // offline session survives the deploy that adds the column.
    const { balancedPairing: _omitted, ...preFeature } = SETTINGS;
    expect(boardFingerprint(baseState(), preFeature)).toBe(boardFingerprint(baseState(), SETTINGS));
  });

  it('leaves the pre-feature canonical string byte-identical when the mode is ON', () => {
    // The case the test above CANNOT cover: a log stamped before this setting
    // shipped carries a fingerprint string the old five-field code produced.
    // That string can't be recomputed, only matched — so ON must add nothing
    // to the canonical form, or every session in flight across the deploy
    // reports a phantom divergence. This literal IS the old format.
    const legacy = `s:${SETTINGS.targetScore}|${SETTINGS.starveThreshold}|${SETTINGS.emergencyWait}|1|1`;
    expect(canonicalBoardString(baseState(), SETTINGS).endsWith(`\n${legacy}`)).toBe(true);
    // ...and the opt-out is what deviates from it.
    const off = { ...SETTINGS, balancedPairing: false };
    expect(canonicalBoardString(baseState(), off).endsWith(`\n${legacy}|0`)).toBe(true);
  });

  describe('win/lose decks', () => {
    const legacyRules = `s:${SETTINGS.targetScore}|${SETTINGS.starveThreshold}|${SETTINGS.emergencyWait}|1|1`;

    it('adds nothing when the mode is off', () => {
      // Same absence-encoding contract as `balancedPairing`, but inverted:
      // deck mode ships OFF, so an arena not running it — which is every
      // existing arena, and every pending log stamped before this shipped —
      // must hash byte-identically to before.
      const off = { ...SETTINGS, splitDeckByResult: false };
      expect(canonicalBoardString(baseState(), off).endsWith(`\n${legacyRules}`)).toBe(true);
      const { splitDeckByResult: _omitted, ...preFeature } = off;
      expect(boardFingerprint(baseState(), preFeature)).toBe(boardFingerprint(baseState(), off));
    });

    it('changes when the mode is turned on', () => {
      const on = { ...SETTINGS, splitDeckByResult: true };
      expect(boardFingerprint(baseState(), on)).not.toBe(boardFingerprint(baseState(), SETTINGS));
      expect(canonicalBoardString(baseState(), on)).toMatch(/\ns:11\|2\|4\|1\|1\|d1$/);
    });

    it('hashes the alternation pointer, so two boards mid-rotation differ', () => {
      // A batch that forked from "winners went last" replayed onto a server
      // that says "losers went last" would alternate the wrong way — exactly
      // the divergence this fingerprint exists to catch.
      const on = { ...SETTINGS, splitDeckByResult: true };
      const afterWin = { ...baseState(), lastDeckFilled: 'W' };
      const afterLose = { ...baseState(), lastDeckFilled: 'L' };
      expect(boardFingerprint(afterWin, on)).not.toBe(boardFingerprint(afterLose, on));
      expect(canonicalBoardString(afterWin, on)).toMatch(/\|d1\|kW$/);
      expect(canonicalBoardString(afterLose, on)).toMatch(/\|d1\|kL$/);
    });

    it('ignores the pointer while the mode is off', () => {
      // Nothing writes it in that case, but a stale value left over from a
      // manager toggling the mode off must not fork the hash.
      const stale = { ...baseState(), lastDeckFilled: 'W' };
      expect(boardFingerprint(stale, SETTINGS)).toBe(boardFingerprint(baseState(), SETTINGS));
    });

    it('stays unambiguous next to the legacy pairing opt-out', () => {
      // Both suffixes on one board: the `d`/`k` prefixes are what stop `|0|d1`
      // from being read as anything other than "legacy pairing, deck mode on".
      const both = { ...SETTINGS, balancedPairing: false, splitDeckByResult: true };
      expect(canonicalBoardString({ ...baseState(), lastDeckFilled: 'L' }, both)).toMatch(
        /\ns:11\|2\|4\|1\|1\|0\|d1\|kL$/,
      );
    });
  });
});
