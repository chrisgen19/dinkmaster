import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { prisma } from '@/lib/prisma';

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
  // `name`/`email`. All required; the register form enforces this client-side
  // and Better Auth rejects sign-ups missing any of them.
  user: {
    additionalFields: {
      firstName: { type: 'string', required: true },
      lastName: { type: 'string', required: true },
      phone: { type: 'string', required: true },
      address: { type: 'string', required: true },
      birthday: { type: 'date', required: true },
      gender: { type: 'string', required: true },
    },
  },
  plugins: [nextCookies()],
});
