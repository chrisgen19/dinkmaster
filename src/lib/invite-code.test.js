import { describe, it, expect } from 'vitest';
import { generateInviteCode } from './invite-code';

describe('generateInviteCode', () => {
  it('returns a 12-char base62 code by default', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(12);
    expect(code).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('honours a custom length', () => {
    expect(generateInviteCode(20)).toHaveLength(20);
    expect(generateInviteCode(6)).toHaveLength(6);
  });

  it('only emits URL-safe characters (no padding or symbols)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it('is effectively unique across many draws', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(generateInviteCode());
    expect(seen.size).toBe(5000);
  });
});
