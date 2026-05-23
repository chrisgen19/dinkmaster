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
});
