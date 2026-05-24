import { describe, expect, it } from 'vitest';
import { partitionArenaDirectory } from './arena-directory';

const ARENAS = [
  { id: 'arena-owner-only', ownerId: 'u1' },
  { id: 'arena-member', ownerId: 'u2' },
  { id: 'arena-other', ownerId: 'u3' },
  { id: 'arena-pending', ownerId: 'u4' },
];

describe('partitionArenaDirectory', () => {
  it('keeps guests on the single public directory', () => {
    expect(partitionArenaDirectory(ARENAS, { userId: null })).toEqual({
      yourArenas: [],
      publicArenas: ARENAS,
    });
  });

  it('puts membership arenas in Your arenas', () => {
    const result = partitionArenaDirectory(ARENAS, {
      userId: 'u1',
      memberArenaIds: ['arena-member'],
    });

    expect(result.yourArenas.map((arena) => arena.id)).toEqual(['arena-owner-only', 'arena-member']);
    expect(result.publicArenas.map((arena) => arena.id)).toEqual(['arena-other', 'arena-pending']);
  });

  it('treats ownerId as yours even without a membership row', () => {
    const result = partitionArenaDirectory(ARENAS, {
      userId: 'u1',
      memberArenaIds: [],
    });

    expect(result.yourArenas.map((arena) => arena.id)).toEqual(['arena-owner-only']);
    expect(result.publicArenas.map((arena) => arena.id)).toEqual([
      'arena-member',
      'arena-other',
      'arena-pending',
    ]);
  });

  it('leaves non-member arenas public so pending requests can still be badged', () => {
    const result = partitionArenaDirectory(ARENAS, {
      userId: 'u1',
      memberArenaIds: ['arena-member'],
    });

    expect(result.publicArenas.some((arena) => arena.id === 'arena-pending')).toBe(true);
  });
});
