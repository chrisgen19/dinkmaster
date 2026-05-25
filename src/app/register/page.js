'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signUp } from '@/lib/auth-client';
import { safeNext } from '@/lib/safe-next';
import { BackPill } from '../back-pill';

// Shared input styling, reused across every field for visual consistency.
const FIELD_CLASS =
  'w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 rounded-xl px-4 py-2.5 text-sm outline-none transition text-slate-800 placeholder-slate-400';

const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];

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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Trim required text fields up front: HTML `required` accepts a
    // whitespace-only value, which would otherwise reach the server as empty.
    const trimmed = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      address: address.trim(),
    };
    if (
      !trimmed.firstName ||
      !trimmed.lastName ||
      !trimmed.phone ||
      !trimmed.address ||
      !birthday ||
      !gender
    ) {
      setError('Please complete all required fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      // `name` is Better Auth's core field; keep it populated as "First Last".
      const name = `${trimmed.firstName} ${trimmed.lastName}`;
      const { error: signUpError } = await signUp.email({
        name,
        email,
        password,
        firstName: trimmed.firstName,
        lastName: trimmed.lastName,
        phone: trimmed.phone,
        address: trimmed.address,
        birthday: new Date(birthday),
        gender,
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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <span className="text-lg font-extrabold tracking-tight text-slate-800">DINKMASTER</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <h1 className="text-base font-extrabold text-slate-900">Create your account</h1>
          <p className="text-xs text-slate-400 mt-1 mb-5">Run your own pickleball arena.</p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                required
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={FIELD_CLASS}
              />
              <input
                type="text"
                required
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={FIELD_CLASS}
              />
            </div>
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD_CLASS}
            />
            <input
              type="password"
              required
              placeholder="Password (min. 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD_CLASS}
            />
            <input
              type="tel"
              required
              placeholder="Phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={FIELD_CLASS}
            />
            <input
              type="text"
              required
              placeholder="Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={FIELD_CLASS}
            />
            <div>
              <label className="text-[11px] font-semibold text-slate-400 ml-1">Birthday</label>
              <input
                type="date"
                required
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                className={`${FIELD_CLASS} mt-1`}
              />
            </div>
            <select
              required
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={`${FIELD_CLASS} ${gender ? '' : 'text-slate-400'}`}
            >
              <option value="" disabled>
                Gender
              </option>
              {GENDER_OPTIONS.map((option) => (
                <option key={option} value={option} className="text-slate-800">
                  {option}
                </option>
              ))}
            </select>

            {error && (
              <div role="alert" data-testid="auth-error" className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold px-5 py-2.5 rounded-xl transition duration-150 shadow-sm"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="text-xs text-slate-400 text-center mt-4">
          Already have an account?{' '}
          <Link href={loginHref} className="text-emerald-600 font-semibold hover:text-emerald-700">
            Sign in
          </Link>
        </p>
        <div className="flex justify-center mt-3">
          <BackPill fallbackHref="/arenas" label="Back to arenas" />
        </div>
      </div>
    </div>
  );
}
