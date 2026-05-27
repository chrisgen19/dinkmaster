'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-next';
import {
  AuthShell,
  AuthSubmit,
  AuthError,
  AuthCrossLink,
  SocialAuthButtons,
  AUTH_FIELD_CLASS,
  BackPill,
} from '../auth-shell';

/**
 * The interactive sign-in form. Rendered by the server `LoginPage`, which
 * passes the providers it has configured so social buttons only appear when
 * the server can handle them.
 *
 * @param {object} props
 * @param {string[]} [props.enabledProviders] - Configured social provider ids.
 */
export function LoginForm({ enabledProviders = [] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: signInError } = await signIn.email({ email, password });
      if (signInError) {
        setError(signInError.message || 'Invalid email or password.');
        return;
      }
      router.push(next);
    } catch (err) {
      // Network or unexpected failure — surface it instead of hanging on "Signing in…".
      setError(err?.message || 'Could not sign in.');
    } finally {
      setLoading(false);
    }
  };

  const registerHref = next !== '/arenas' ? `/register?next=${encodeURIComponent(next)}` : '/register';

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to manage your arena."
      footer={
        <>
          <AuthCrossLink prompt="No account?" href={registerHref} action="Create one" />
          <div className="flex justify-center">
            <BackPill fallbackHref="/arenas" label="Back to arenas" />
          </div>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={AUTH_FIELD_CLASS}
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={AUTH_FIELD_CLASS}
        />

        {error && <AuthError>{error}</AuthError>}

        <AuthSubmit loading={loading} label="Sign in" loadingLabel="Signing in…" />
      </form>

      <div className="mt-4">
        <SocialAuthButtons next={next} providers={enabledProviders} />
      </div>
    </AuthShell>
  );
}
