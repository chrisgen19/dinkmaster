import { randomBytes } from 'node:crypto';

// URL-safe base62 alphabet — no look-alike-stripping (kept simple), but free of
// characters that need percent-encoding in a path segment.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_LENGTH = 12;

// Largest multiple of the alphabet size that fits in a byte (62 * 4 = 248).
// Bytes at or above this are rejected so `byte % 62` carries no modulo bias —
// every character stays equally likely.
const UNBIASED_MAX = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

/**
 * Generate a random, unguessable invite code (URL-safe base62). At the default
 * length of 12 that is ~71 bits of entropy — auto-join links lean on this being
 * infeasible to guess, so this MUST stay cryptographically random.
 *
 * @param {number} [length=12]
 * @returns {string}
 */
export function generateInviteCode(length = DEFAULT_LENGTH) {
  let code = '';
  // Draw in batches and rejection-sample; loops only on the rare discarded byte.
  while (code.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= UNBIASED_MAX) continue;
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === length) break;
    }
  }
  return code;
}
