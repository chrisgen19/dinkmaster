import { describe, it, expect } from 'vitest';
import { WEEKDAYS, formatClock, hasConfiguredSchedule, describeSchedule } from './schedule-format';

describe('WEEKDAYS', () => {
  it('is Monday-first with values matching Date.getDay()', () => {
    expect(WEEKDAYS).toHaveLength(7);
    expect(WEEKDAYS[0]).toEqual({ value: 1, short: 'Mon' });
    expect(WEEKDAYS[6]).toEqual({ value: 0, short: 'Sun' });
  });
});

describe('formatClock', () => {
  it('returns null for missing values', () => {
    expect(formatClock(null)).toBeNull();
    expect(formatClock('')).toBeNull();
    expect(formatClock(undefined)).toBeNull();
  });

  it('formats morning, noon, evening, and midnight', () => {
    expect(formatClock('06:05')).toBe('6:05 AM');
    expect(formatClock('12:00')).toBe('12:00 PM');
    expect(formatClock('18:30')).toBe('6:30 PM');
    expect(formatClock('00:00')).toBe('12:00 AM');
  });
});

describe('hasConfiguredSchedule', () => {
  it('is false for the empty default', () => {
    expect(hasConfiguredSchedule({ days: [], start: null, end: null })).toBe(false);
    expect(hasConfiguredSchedule(null)).toBe(false);
    expect(hasConfiguredSchedule(undefined)).toBe(false);
  });

  it('is true when days or either time is set', () => {
    expect(hasConfiguredSchedule({ days: [1] })).toBe(true);
    expect(hasConfiguredSchedule({ days: [], start: '18:00' })).toBe(true);
    expect(hasConfiguredSchedule({ days: [], end: '22:00' })).toBe(true);
  });
});

describe('describeSchedule', () => {
  it('orders days Monday-first regardless of input order', () => {
    expect(describeSchedule({ days: [0, 5, 1] })).toBe('Mon, Fri, Sun');
  });

  it('falls back to "Every day" when no days are set', () => {
    expect(describeSchedule({ days: [] })).toBe('Every day');
    expect(describeSchedule()).toBe('Every day');
  });

  it('includes the time window only when BOTH ends are set', () => {
    expect(describeSchedule({ days: [1], start: '18:00', end: '22:00' })).toBe(
      'Mon · 6:00 PM–10:00 PM',
    );
    expect(describeSchedule({ days: [1], start: '18:00' })).toBe('Mon');
    expect(describeSchedule({ days: [1], end: '22:00' })).toBe('Mon');
  });

  it('appends the timezone when present', () => {
    expect(
      describeSchedule({ days: [1, 3, 5], start: '18:00', end: '22:00', timezone: 'Asia/Manila' }),
    ).toBe('Mon, Wed, Fri · 6:00 PM–10:00 PM (Asia/Manila)');
  });
});
