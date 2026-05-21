import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

/** Better Auth catch-all route — handles sign-in, sign-up, session, sign-out. */
export const { GET, POST } = toNextJsHandler(auth);
