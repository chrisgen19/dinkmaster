import { describe, it, expect } from 'vitest';
import { isValidScoreInput, stepScore, validateMatchScore } from './scoring';

describe('isValidScoreInput', () => {
  it('accepts digit strings', () => {
    expect(isValidScoreInput('0')).toBe(true);
    expect(isValidScoreInput('11')).toBe(true);
    expect(isValidScoreInput(' 7 ')).toBe(true);
  });

  it('rejects empty / non-digit values', () => {
    expect(isValidScoreInput('')).toBe(false);
    expect(isValidScoreInput('   ')).toBe(false);
    expect(isValidScoreInput('1a')).toBe(false);
    expect(isValidScoreInput('-1')).toBe(false);
    expect(isValidScoreInput('1.5')).toBe(false);
    expect(isValidScoreInput(null)).toBe(false);
    expect(isValidScoreInput(undefined)).toBe(false);
  });

  it('accepts numeric arguments via String coercion', () => {
    expect(isValidScoreInput(0)).toBe(true);
    expect(isValidScoreInput(11)).toBe(true);
  });
});

describe('stepScore', () => {
  it('increments and clamps at 0', () => {
    expect(stepScore('', 1)).toBe('1');
    expect(stepScore('', -1)).toBe('0');
    expect(stepScore('5', 1)).toBe('6');
    expect(stepScore('5', -1)).toBe('4');
    expect(stepScore('3', -5)).toBe('0');
  });

  it('treats non-digit input as 0', () => {
    expect(stepScore('abc', 1)).toBe('1');
    expect(stepScore('abc', -1)).toBe('0');
  });
});

describe('validateMatchScore', () => {
  const TARGET = 11;

  it('marks incomplete when either field is empty or invalid', () => {
    expect(validateMatchScore('', '', TARGET)).toEqual({ ok: false, complete: false, reason: '' });
    expect(validateMatchScore('11', '', TARGET).complete).toBe(false);
    expect(validateMatchScore('11', 'abc', TARGET).complete).toBe(false);
  });

  it('rejects ties', () => {
    const r = validateMatchScore('11', '11', TARGET);
    expect(r.ok).toBe(false);
    expect(r.complete).toBe(true);
    expect(r.reason).toMatch(/tie/i);

    expect(validateMatchScore('0', '0', TARGET).reason).toMatch(/tie/i);
  });

  it('rejects scorelines where the winner is below the target', () => {
    expect(validateMatchScore('10', '8', TARGET)).toEqual({
      ok: false,
      complete: true,
      reason: 'Winner must reach 11.',
    });
  });

  it('rejects one-point wins — must win by 2', () => {
    expect(validateMatchScore('11', '10', TARGET)).toEqual({
      ok: false,
      complete: true,
      reason: 'A game must be won by 2.',
    });
  });

  it('accepts standard 11-X wins from either side', () => {
    expect(validateMatchScore('11', '0', TARGET).ok).toBe(true);
    expect(validateMatchScore('11', '9', TARGET).ok).toBe(true);
    expect(validateMatchScore('5', '11', TARGET).ok).toBe(true);
  });

  it('accepts deuce results with no upper cap', () => {
    expect(validateMatchScore('12', '10', TARGET).ok).toBe(true);
    expect(validateMatchScore('13', '11', TARGET).ok).toBe(true);
    expect(validateMatchScore('21', '19', TARGET).ok).toBe(true);
    expect(validateMatchScore('99', '97', TARGET).ok).toBe(true);
  });

  it('honors a different per-arena target score', () => {
    expect(validateMatchScore('11', '9', 15).ok).toBe(false);
    expect(validateMatchScore('11', '9', 15).reason).toBe('Winner must reach 15.');
    expect(validateMatchScore('15', '13', 15).ok).toBe(true);
    expect(validateMatchScore('21', '19', 21).ok).toBe(true);
    expect(validateMatchScore('17', '15', 21).ok).toBe(false);
  });

  it('defaults to win-by-2 when no margin is passed', () => {
    // The five call sites all pass a margin now, but the default is what keeps
    // an un-migrated caller (or a legacy offline batch) on standard rules.
    expect(validateMatchScore('11', '10', TARGET).ok).toBe(false);
    expect(validateMatchScore('11', '10', TARGET, undefined).ok).toBe(false);
  });
});

describe('validateMatchScore — sudden death (winBy 1)', () => {
  const TARGET = 11;
  const sudden = (s1, s2, target = TARGET) => validateMatchScore(s1, s2, target, 1);

  it('accepts a one-point win at the target — the whole point of the format', () => {
    expect(sudden('11', '10')).toEqual({ ok: true, complete: true, reason: '' });
    expect(sudden('10', '11').ok).toBe(true);
  });

  it('still accepts every scoreline that was already legal', () => {
    expect(sudden('11', '0').ok).toBe(true);
    expect(sudden('11', '9').ok).toBe(true);
    expect(sudden('0', '11').ok).toBe(true);
  });

  it('still rejects ties and sub-target winners', () => {
    expect(sudden('11', '11').reason).toMatch(/tie/i);
    expect(sudden('10', '9').reason).toBe('Winner must reach 11.');
    expect(sudden('10', '8').ok).toBe(false);
  });

  it('rejects a winner above the target — play stops on the winning point', () => {
    // 12-10 is a legal deuce result under win-by-2, but unreachable under
    // sudden death: the game ended the moment someone hit 11.
    const r = sudden('12', '10');
    expect(r.ok).toBe(false);
    expect(r.complete).toBe(true);
    expect(r.reason).toBe("Sudden death ends at 11 — the winner can't score more.");
    expect(sudden('15', '3').ok).toBe(false);
    expect(sudden('21', '19').ok).toBe(false);
  });

  it('honors a non-standard target', () => {
    expect(sudden('15', '14', 15).ok).toBe(true);
    expect(sudden('21', '20', 21).ok).toBe(true);
    expect(sudden('16', '14', 15).ok).toBe(false);
    expect(sudden('14', '13', 15).reason).toBe('Winner must reach 15.');
  });

  it('stays incomplete on empty input like the standard format', () => {
    expect(sudden('', '')).toEqual({ ok: false, complete: false, reason: '' });
    expect(sudden('11', '').complete).toBe(false);
  });
});
