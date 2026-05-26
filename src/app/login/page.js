'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-next';
import {
  AuthShell,
  AuthSubmit,
  AuthError,
  AuthCrossLink,
  AUTH_FIELD_CLASS,
  BackPill,
} from '../auth-shell';

export default function LoginPage() {
  // `useSearchParams` (inside `LoginForm`) requires a Suspense boundary so the
  // rest of the route can still prerender. The fallback is intentionally blank
  // — the form renders almost instantly once hydrated.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
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
    </AuthShell>
  );
}
