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
  plugins: [nextCookies()],
});
