import { createAuthClient } from 'better-auth/react';

/** Browser-side Better Auth client. Base URL is inferred from the page origin. */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
