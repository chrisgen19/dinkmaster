import { describe, it, expect } from 'vitest';
import {
  enrichRecentMatches,
  bestPartner,
  favoriteCourt,
  currentStreak,
  monogram,
} from './user-insights';

const VIEWER_IDS = new Set(['viewer-1']);

/** Build a `matchPlayer` row with the viewer on `team`, plus 3 teammates. */
function row({
  matchId,
  team = 1,
  score1,
  score2,
  courtName = 'Court 1',
  arenaName = 'QC Open',
  partnerName = 'Mia',
  partnerId = 'partner-mia',
  partnerLast = null,
  opp1 = { id: 'opp-joe', firstName: 'Joe', lastName: null },
  opp2 = { id: 'opp-lin', firstName: 'Lin', lastName: 'Smith' },
  createdAt = '2026-05-25T12:00:00.000Z',
}) {
  return {
    playerId: 'viewer-1',
    team,
    match: {
      id: matchId,
      score1,
      score2,
      courtName,
      createdAt,
      arena: { name: arenaName },
      players: [
        { playerId: 'viewer-1', team, playerFirstName: 'Me', playerLastName: 'You' },
        { playerId: partnerId, team, playerFirstName: partnerName, playerLastName: partnerLast },
        { playerId: opp1.id, team: team === 1 ? 2 : 1, playerFirstName: opp1.firstName, playerLastName: opp1.lastName ?? null },
        { playerId: opp2.id, team: team === 1 ? 2 : 1, playerFirstName: opp2.firstName, playerLastName: opp2.lastName ?? null },
      ],
    },
  };
}

describe('enrichRecentMatches()', () => {
  it('splits roster into partners + opponents from the viewer perspective', () => {
    const out = enrichRecentMatches(
      [row({ matchId: 'm1', score1: 11, score2: 7 })],
      VIEWER_IDS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].scoreFor).toBe(11);
    expect(out[0].scoreAgainst).toBe(7);
    expect(out[0].partners.map((p) => p.firstName)).toEqual(['Mia']);
    expect(out[0].opponents.map((p) => p.firstName).sort()).toEqual(['Joe', 'Lin']);
    expect(out[0].arenaName).toBe('QC Open');
  });

  it('handles viewer on team 2 — scores flip and partners still excludes the viewer', () => {
    const out = enrichRecentMatches(
      [row({ matchId: 'm1', score1: 5, score2: 11, team: 2 })],
      VIEWER_IDS,
    );
    expect(out[0].scoreFor).toBe(11);
    expect(out[0].scoreAgainst).toBe(5);
    expect(out[0].partners.map((p) => p.firstName)).toEqual(['Mia']);
  });

  it('omits the legacy `won` field — outcome is derived in the UI layer', () => {
    // Prevents the tie-as-loss flaw from reappearing: callers should compute
    // outcome via winnerSide(toMatch(m)), which correctly handles ties.
    const out = enrichRecentMatches(
      [row({ matchId: 'm1', score1: 7, score2: 7 })],
      VIEWER_IDS,
    );
    expect(out[0]).not.toHaveProperty('won');
  });

  it('emits ISO timestamps', () => {
    const out = enrichRecentMatches([row({ matchId: 'm1', score1: 11, score2: 0 })], VIEWER_IDS);
    expect(out[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('bestPartner()', () => {
  it('returns null when there are no matches', () => {
    expect(bestPartner([], VIEWER_IDS)).toBeNull();
  });

  it('picks the most-played-with partner', () => {
    const matches = [
      row({ matchId: 'a', score1: 11, score2: 6, partnerName: 'Mia', partnerId: 'pm' }),
      row({ matchId: 'b', score1: 11, score2: 8, partnerName: 'Mia', partnerId: 'pm' }),
      row({ matchId: 'c', score1: 7, score2: 11, partnerName: 'Ken', partnerId: 'pk' }),
    ];
    expect(bestPartner(matches, VIEWER_IDS)).toEqual({
      name: 'Mia',
      games: 2,
      wins: 2,
      winPct: 100,
    });
  });

  it('breaks ties on games by win % then by name', () => {
    const matches = [
      row({ matchId: 'a', score1: 11, score2: 0, partnerName: 'Bo', partnerId: 'pb' }),
      row({ matchId: 'b', score1: 0, score2: 11, partnerName: 'Al', partnerId: 'pa' }),
    ];
    // Both have 1 game; Bo has 100% win, Al has 0% → Bo wins.
    expect(bestPartner(matches, VIEWER_IDS).name).toBe('Bo');
  });

  it('uses "First L." format when last name is set', () => {
    const matches = [
      row({ matchId: 'a', score1: 11, score2: 0, partnerName: 'Mia', partnerLast: 'Cruz', partnerId: 'pm' }),
    ];
    expect(bestPartner(matches, VIEWER_IDS).name).toBe('Mia C.');
  });

  it('excludes tied matches from the partner tally', () => {
    // 2 decided wins with Mia + 1 tie with Mia → reported as 2/2 (100%), not
    // 2/3. Win % must only reflect decided games.
    const matches = [
      row({ matchId: 'a', score1: 11, score2: 6, partnerName: 'Mia', partnerId: 'pm' }),
      row({ matchId: 'b', score1: 7, score2: 7, partnerName: 'Mia', partnerId: 'pm' }), // tie
      row({ matchId: 'c', score1: 11, score2: 9, partnerName: 'Mia', partnerId: 'pm' }),
    ];
    expect(bestPartner(matches, VIEWER_IDS)).toEqual({
      name: 'Mia',
      games: 2,
      wins: 2,
      winPct: 100,
    });
  });

  it('returns null when every match is a tie (no decided matches)', () => {
    const matches = [
      row({ matchId: 'a', score1: 7, score2: 7, partnerName: 'Mia', partnerId: 'pm' }),
      row({ matchId: 'b', score1: 9, score2: 9, partnerName: 'Mia', partnerId: 'pm' }),
    ];
    expect(bestPartner(matches, VIEWER_IDS)).toBeNull();
  });
});

describe('favoriteCourt()', () => {
  it('returns null on empty input', () => {
    expect(favoriteCourt([])).toBeNull();
  });

  it('picks the most-frequent court', () => {
    const matches = [
      row({ matchId: 'a', score1: 11, score2: 6, courtName: 'Court 1' }),
      row({ matchId: 'b', score1: 11, score2: 8, courtName: 'Court 1' }),
      row({ matchId: 'c', score1: 7, score2: 11, courtName: 'Court 2' }),
    ];
    expect(favoriteCourt(matches)).toEqual({ name: 'Court 1', games: 2 });
  });

  it('breaks ties alphabetically', () => {
    const matches = [
      row({ matchId: 'a', score1: 11, score2: 6, courtName: 'Center' }),
      row({ matchId: 'b', score1: 11, score2: 6, courtName: 'Alpha' }),
    ];
    expect(favoriteCourt(matches).name).toBe('Alpha');
  });
});

describe('currentStreak()', () => {
  it('returns null when empty', () => {
    expect(currentStreak([])).toBeNull();
  });

  it('walks the head until the outcome flips', () => {
    const matches = [
      row({ matchId: 'a', score1: 11, score2: 6 }),  // W
      row({ matchId: 'b', score1: 11, score2: 9 }),  // W
      row({ matchId: 'c', score1: 7, score2: 11 }),  // L
    ];
    expect(currentStreak(matches)).toEqual({ kind: 'W', count: 2 });
  });

  it('treats a leading tie as undecided and anchors on the next match', () => {
    const matches = [
      row({ matchId: 'a', score1: 7, score2: 7 }),   // tie → skip (leading)
      row({ matchId: 'b', score1: 5, score2: 11 }),  // L
      row({ matchId: 'c', score1: 6, score2: 11 }),  // L
    ];
    expect(currentStreak(matches)).toEqual({ kind: 'L', count: 2 });
  });

  it('breaks on a mid-streak tie instead of skipping it', () => {
    // Aligns with summarise() in match-history.js so the Insights card and the
    // MatchHistory summary strip never show conflicting streak counts.
    const matches = [
      row({ matchId: 'a', score1: 11, score2: 6 }),  // W
      row({ matchId: 'b', score1: 7, score2: 7 }),   // tie → ends the streak
      row({ matchId: 'c', score1: 11, score2: 4 }),  // W (should not count)
    ];
    expect(currentStreak(matches)).toEqual({ kind: 'W', count: 1 });
  });
});

describe('monogram()', () => {
  it('returns first + last initial for multi-word names', () => {
    expect(monogram('Christian Genesis Diomampo')).toBe('CD');
    expect(monogram('Ada Lovelace')).toBe('AL');
  });

  it('returns the single initial for one-word names', () => {
    expect(monogram('Mononoke')).toBe('M');
  });

  it('handles odd whitespace and casing', () => {
    expect(monogram('  ada   lovelace  ')).toBe('AL');
  });

  it('falls back to "?" for empty/invalid input', () => {
    expect(monogram('')).toBe('?');
    expect(monogram(null)).toBe('?');
    expect(monogram(undefined)).toBe('?');
  });
});
