// Plain (non-client) module so the server route `/arena/[id]/settings/[section]`
// can import the slug list to validate URLs. arena-settings.js is `'use client'`,
// and importing values (vs. components) from a client module into a server
// component returns a client-reference proxy — which would crash on `.includes`
// at runtime. The icons + presentation stay in arena-settings.js; only the
// slug-id mapping lives here.

/** URL slugs (kebab-case) in display order, validated by the dynamic route. */
export const SETTINGS_SECTION_SLUGS = [
  'general',
  'schedule',
  'activities',
  'sessions',
  'matchmaking',
  'match-defaults',
  'danger',
];

/** Internal section ids keyed by URL slug. Slug ↔ id is the only place these differ. */
const SLUG_TO_ID = {
  general: 'general',
  schedule: 'schedule',
  activities: 'activities',
  sessions: 'sessions',
  matchmaking: 'matchmaking',
  'match-defaults': 'matchDefaults',
  danger: 'danger',
};

// Precomputed inverse so slugFromSectionId is an O(1) lookup instead of an
// `Object.entries().find()` on every Link render (12+ per settings page).
const ID_TO_SLUG = Object.fromEntries(
  Object.entries(SLUG_TO_ID).map(([slug, id]) => [id, slug]),
);

/** Reverse lookup: kebab-case URL slug → internal section id, or null. */
export function sectionIdFromSlug(slug) {
  return SLUG_TO_ID[slug] ?? null;
}

/** Forward lookup used by the client shell for section nav `<Link>` hrefs. */
export function slugFromSectionId(id) {
  return ID_TO_SLUG[id] ?? null;
}

/** The canonical set of internal section ids (used to drift-check the UI). */
export const SETTINGS_SECTION_IDS = Object.values(SLUG_TO_ID);
