import { describe, it, expect } from 'vitest';
import {
  SETTINGS_SECTION_SLUGS,
  SETTINGS_SECTION_IDS,
  sectionIdFromSlug,
  slugFromSectionId,
} from './arena-settings-sections';

describe('arena-settings-sections — slug ↔ id mapping', () => {
  it('every slug round-trips through both lookups', () => {
    for (const slug of SETTINGS_SECTION_SLUGS) {
      const id = sectionIdFromSlug(slug);
      expect(id).not.toBeNull();
      expect(slugFromSectionId(id)).toBe(slug);
    }
  });

  it('every id has exactly one slug', () => {
    for (const id of SETTINGS_SECTION_IDS) {
      const slug = slugFromSectionId(id);
      expect(slug).not.toBeNull();
      expect(SETTINGS_SECTION_SLUGS).toContain(slug);
    }
  });

  it('rejects unknown slugs without throwing', () => {
    expect(sectionIdFromSlug('does-not-exist')).toBeNull();
    expect(sectionIdFromSlug('')).toBeNull();
    expect(sectionIdFromSlug(undefined)).toBeNull();
  });

  it('rejects unknown ids without throwing', () => {
    expect(slugFromSectionId('nope')).toBeNull();
    expect(slugFromSectionId(undefined)).toBeNull();
  });

  it('keeps slug count equal to id count (drift guard)', () => {
    expect(SETTINGS_SECTION_SLUGS.length).toBe(SETTINGS_SECTION_IDS.length);
  });

  it('ids are unique (no two slugs collapse to the same id, so slugFromSectionId stays deterministic)', () => {
    expect(new Set(SETTINGS_SECTION_IDS).size).toBe(SETTINGS_SECTION_IDS.length);
  });

  it('slugs are unique (no id has two URL forms)', () => {
    const slugsForAllIds = SETTINGS_SECTION_IDS.map((id) => slugFromSectionId(id));
    expect(new Set(slugsForAllIds).size).toBe(slugsForAllIds.length);
  });
});
