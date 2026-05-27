import { describe, it, expect } from 'vitest';
import { SOCIAL_PROVIDERS, visibleSocialProviders } from '@/lib/social-providers';

describe('visibleSocialProviders — server→client provider gating', () => {
  it('renders nothing when no providers are enabled', () => {
    expect(visibleSocialProviders([])).toEqual([]);
    expect(visibleSocialProviders()).toEqual([]);
  });

  it('returns only the enabled providers', () => {
    expect(visibleSocialProviders(['google']).map((p) => p.id)).toEqual(['google']);
  });

  it('ignores unknown provider ids', () => {
    expect(visibleSocialProviders(['google', 'facebook']).map((p) => p.id)).toEqual(['google']);
    expect(visibleSocialProviders(['twitter']).map((p) => p.id)).toEqual([]);
  });

  it('every provider has a label', () => {
    for (const provider of SOCIAL_PROVIDERS) {
      expect(provider.label).toMatch(/\S/);
    }
  });
});
