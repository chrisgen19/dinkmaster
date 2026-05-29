import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { APIError } from 'better-auth/api';
import { prisma } from '@/lib/prisma';
import { normalizeUserProfile, normalizeProfileUpdate, deriveNameParts } from '@/lib/user-profile';

/**
 * Social OAuth providers, registered only when their credentials are present
 * so a missing secret can't break `betterAuth()` init in any environment.
 * Google's profile carries names under `given_name`/`family_name`; we map
 * them onto our `firstName`/`lastName` columns via `deriveNameParts` (the
 * social counterpart to the register form). Callback URL is Better Auth's
 * standard `${BETTER_AUTH_URL}/api/auth/callback/<provider>`.
 */
const socialProviders = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    mapProfileToUser: (profile) =>
      deriveNameParts({
        firstName: profile.given_name,
        lastName: profile.family_name,
        name: profile.name,
      }),
  };
}

/**
 * Provider ids that are actually configured (both env vars present). The
 * login/register pages read this so they only render buttons for providers
 * the server can handle — a half-configured deployment never shows a button
 * that would fail on click.
 */
export const enabledSocialProviders = Object.keys(socialProviders);

/**
 * Better Auth server instance. Email + password and Google social auth backed
 * by the existing PostgreSQL database via the Prisma adapter.
 *
 * Reads BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment.
 * `nextCookies()` must be the last plugin so session cookies are set on
 * sign-in/sign-up responses.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  socialProviders,
  // Link a Google sign-in to an existing account with the same email.
  // `requireLocalEmailVerified: true` is set explicitly (it's also Better
  // Auth's default): linking proceeds only when the LOCAL account's email is
  // verified, which prevents account-takeover — an attacker who pre-registers
  // an unverified password account at a victim's address can't have the
  // victim's OAuth identity linked into it. Google is in `trustedProviders`
  // because it returns `email_verified` (verified on Google's side).
  // NOTE: this app doesn't verify emails, so an existing password user
  // (emailVerified=false) won't be auto-linked on a same-email Google sign-in
  // — they should keep using their password (see docs/social-auth-setup.md).
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
      requireLocalEmailVerified: true,
    },
  },
  // Profile columns collected at registration alongside Better Auth's core
  // `name`/`email`. Only first/last name are required; the rest are optional
  // extras the user can fill in under "Add more details" on the register form.
  user: {
    additionalFields: {
      firstName: { type: 'string', required: true },
      lastName: { type: 'string', required: true },
      phone: { type: 'string', required: false },
      address: { type: 'string', required: false },
      birthday: { type: 'date', required: false },
      gender: { type: 'string', required: false },
    },
  },
  // Server-side guard at the auth boundary: trim and validate the profile
  // fields before any user row is written, so a direct API call that bypasses
  // the register form cannot persist whitespace-only or malformed values.
  // Better Auth's `required` only checks presence, not content.
  databaseHooks: {
    user: {
      create: {
        before(user, context) {
          // The strict required-name guard exists to stop a direct
          // `/sign-up/email` call from persisting empty names. Social
          // sign-ups arrive on a different endpoint (`/callback/<provider>`)
          // with names already mapped from the provider (see `socialProviders`
          // above), so we don't reject them when a provider supplies only a
          // single name. `endsWith` (not `===`) so a future base-path prefix
          // on the endpoint can't silently drop the guard for password sign-up.
          const requireNames = context?.path?.endsWith('/sign-up/email') ?? false;
          const result = normalizeUserProfile(user, { requireNames });
          if (result.error) {
            throw new APIError('BAD_REQUEST', { message: result.error });
          }
          return { data: result.data };
        },
      },
      // Parity guard for self-service profile edits (`/update-user`, via the
      // settings form). The create hook above only fires on sign-up, so without
      // this an authenticated user could PATCH a whitespace-only name, an
      // arbitrary gender, or a bad birthday straight past the client checks.
      // Update payloads are partial, so `normalizeProfileUpdate` only normalizes
      // the profile fields actually present and leaves everything else (and
      // internal updates like emailVerified/session bookkeeping) untouched.
      update: {
        before(data) {
          const result = normalizeProfileUpdate(data);
          if (result.error) {
            throw new APIError('BAD_REQUEST', { message: result.error });
          }
          return { data: result.data };
        },
      },
    },
  },
  plugins: [nextCookies()],
});
