import { headers } from 'next/headers';
import { auth } from '@/lib/auth';

/**
 * Resolve the current signed-in user from the request cookies.
 * @returns {Promise<{id:string,name:string,email:string}|null>}
 */
export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * Guard for server actions that mutate the arena. Returns the user when
 * authenticated, or an `{ error }` the action can hand straight back to the
 * client (the arena UI surfaces `result.error` as a notice).
 *
 * @returns {Promise<{user:object}|{error:string}>}
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return { error: 'Please sign in to manage the arena.' };
  return { user };
}
