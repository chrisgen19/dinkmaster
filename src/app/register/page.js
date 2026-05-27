import { Suspense } from 'react';
import { enabledSocialProviders } from '@/lib/auth';
import { RegisterForm } from './register-form';

export default function RegisterPage() {
  // Server component: reads the configured social providers and hands them to
  // the client form, so only providers the server can handle render a button.
  // `useSearchParams` (inside `RegisterForm`) requires a Suspense boundary so
  // the rest of the route can still prerender.
  return (
    <Suspense fallback={null}>
      <RegisterForm enabledProviders={enabledSocialProviders} />
    </Suspense>
  );
}
