'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signUp } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-next';
import { GENDER_OPTIONS } from '@/lib/user-profile';
import {
  AuthShell,
  AuthSubmit,
  AuthError,
  AuthCrossLink,
  SocialAuthButtons,
  AUTH_FIELD_CLASS,
  BackPill,
} from '../auth-shell';

export default function RegisterPage() {
  // `useSearchParams` (inside `RegisterForm`) requires a Suspense boundary so
  // the rest of the route can still prerender.
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const loginHref = next !== '/arenas' ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [birthday, setBirthday] = useState('');
  const [gender, setGender] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Trim required text fields up front: HTML `required` accepts a
    // whitespace-only value, which would otherwise reach the server as empty.
    const firstNameTrimmed = firstName.trim();
    const lastNameTrimmed = lastName.trim();
    if (!firstNameTrimmed || !lastNameTrimmed) {
      setError('Please enter your first and last name.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      // `name` is Better Auth's core field; keep it populated as "First Last".
      // Optional extras are only sent when filled — empty values normalize to
      // null server-side (see normalizeUserProfile).
      const name = `${firstNameTrimmed} ${lastNameTrimmed}`;
      const { error: signUpError } = await signUp.email({
        name,
        email,
        password,
        firstName: firstNameTrimmed,
        lastName: lastNameTrimmed,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        // Parse the YYYY-MM-DD value at local noon, not the default UTC
        // midnight — otherwise the stored instant can roll back to the
        // previous calendar day in negative-offset timezones.
        birthday: birthday ? new Date(`${birthday}T12:00:00`) : undefined,
        gender: gender || undefined,
      });
      if (signUpError) {
        setError(signUpError.message || 'Could not create account.');
        return;
      }
      router.push(next);
    } catch (err) {
      // Network or unexpected failure — surface it instead of hanging on "Creating…".
      setError(err?.message || 'Could not create account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Run your own pickleball arena."
      footer={
        <>
          <AuthCrossLink prompt="Already have an account?" href={loginHref} action="Sign in" />
          <div className="flex justify-center">
            <BackPill fallbackHref="/arenas" label="Back to arenas" />
          </div>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            required
            autoComplete="given-name"
            placeholder="First name"
            aria-label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={AUTH_FIELD_CLASS}
          />
          <input
            type="text"
            required
            autoComplete="family-name"
            placeholder="Last name"
            aria-label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={AUTH_FIELD_CLASS}
          />
        </div>
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
          autoComplete="new-password"
          placeholder="Password (min. 8 characters)"
          aria-label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={AUTH_FIELD_CLASS}
        />

        {/* Optional profile details, collapsed by default to reduce sign-up
            friction. Users can expand to share a phone, address, birthday, and
            gender — all stored as nullable columns. */}
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/50">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            aria-controls="optional-details"
            className="flex w-full items-center justify-between rounded-xl px-4 py-2.5
              text-sm font-semibold text-slate-600 transition hover:text-emerald-700"
          >
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add more details
              <span className="text-xs font-medium text-slate-400">(optional)</span>
            </span>
            <svg
              className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${showMore ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {showMore && (
            <div id="optional-details" className="animate-fade-in space-y-3 px-3 pb-3">
              <input
                type="tel"
                autoComplete="tel"
                placeholder="Phone number"
                aria-label="Phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`${AUTH_FIELD_CLASS} bg-white`}
              />
              <input
                type="text"
                autoComplete="street-address"
                placeholder="Address"
                aria-label="Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={`${AUTH_FIELD_CLASS} bg-white`}
              />
              <div>
                <label htmlFor="birthday" className="ml-1 text-[11px] font-semibold text-slate-400">
                  Birthday
                </label>
                <input
                  id="birthday"
                  type="date"
                  aria-label="Birthday"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  className={`${AUTH_FIELD_CLASS} mt-1 bg-white`}
                />
              </div>
              <select
                aria-label="Gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className={`${AUTH_FIELD_CLASS} bg-white ${gender ? '' : 'text-slate-400'}`}
              >
                <option value="">Gender</option>
                {GENDER_OPTIONS.map((option) => (
                  <option key={option} value={option} className="text-slate-800">
                    {option}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && <AuthError>{error}</AuthError>}

        <AuthSubmit loading={loading} label="Create account" loadingLabel="Creating account…" />
      </form>

      <div className="mt-4">
        <SocialAuthButtons next={next} />
      </div>
    </AuthShell>
  );
}
