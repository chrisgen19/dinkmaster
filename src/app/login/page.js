import { Suspense } from 'react';
import { enabledSocialProviders } from '@/lib/auth';
import { LoginForm } from './login-form';

export default function LoginPage() {
  // Server component: reads the configured social providers and hands them to
  // the client form, so only providers the server can handle render a button.
  // `useSearchParams` (inside `LoginForm`) requires a Suspense boundary so the
  // rest of the route can still prerender; the fallback is intentionally blank.
  return (
    <Suspense fallback={null}>
      <LoginForm enabledProviders={enabledSocialProviders} />
    </Suspense>
  );
}
