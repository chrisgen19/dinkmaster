/**
 * Supported social providers, in display order. Pure data (no React) so the
 * selection logic below stays unit-testable in the node test environment;
 * `auth-shell.js` maps each `id` to its brand icon at render time.
 *
 * Adding a provider: append it here, register it in `@/lib/auth`'s
 * `socialProviders`, and add an entry to `SOCIAL_PROVIDER_ICONS` in
 * `src/app/auth-shell.js`.
 */
export const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
];

/**
 * The providers to actually render, given the set the server configured
 * (`enabledSocialProviders` in `@/lib/auth`). Preserves `SOCIAL_PROVIDERS`
 * display order, drops anything not enabled, and ignores unknown ids — so a
 * deployment with one provider (or none) never shows a button that would fail
 * on click.
 *
 * @param {string[]} [enabled] - Enabled provider ids (e.g. ['google']).
 * @returns {{ id: string, label: string }[]}
 */
export function visibleSocialProviders(enabled = []) {
  return SOCIAL_PROVIDERS.filter((provider) => enabled.includes(provider.id));
}
