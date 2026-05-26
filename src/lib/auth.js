import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { APIError } from 'better-auth/api';
import { prisma } from '@/lib/prisma';
import { normalizeUserProfile } from '@/lib/user-profile';

/**
 * Better Auth server instance. Email + password auth backed by the existing
 * PostgreSQL database via the Prisma adapter.
 *
 * Reads BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment.
 * `nextCookies()` must be the last plugin so session cookies are set on
 * sign-in/sign-up responses.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
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
        before(user) {
          const result = normalizeUserProfile(user);
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
