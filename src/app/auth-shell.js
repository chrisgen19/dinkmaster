'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from '@/lib/auth-client';
import { visibleSocialProviders } from '@/lib/social-providers';
import { BrandMark, Wordmark } from './site-header';
import { BackPill } from './back-pill';

/**
 * Shared input styling for the auth forms. One source of truth so the login and
 * register fields stay visually identical. Emerald focus ring matches the rest
 * of the app's form controls.
 */
export const AUTH_FIELD_CLASS =
  'w-full bg-slate-50/80 border border-slate-200 focus:border-emerald-500 ' +
  'focus:ring-2 focus:ring-emerald-500/15 rounded-xl px-4 py-2.5 text-sm ' +
  'outline-none transition text-slate-800 placeholder-slate-400';

/**
 * The branded chrome around both auth forms: a soft slate canvas with emerald/
 * sky background flourishes, the real DinkMaster brand (linking home), a glass
 * card holding the form, and a footer area for the cross-link + back pill. One
 * shell so `/login` and `/register` share an identical frame and the design
 * can't drift between them.
 *
 * @param {object} props
 * @param {string} props.title - Card heading (e.g. "Welcome back").
 * @param {string} props.subtitle - One-line supporting copy under the heading.
 * @param {React.ReactNode} props.children - The form.
 * @param {React.ReactNode} [props.footer] - Cross-link + back affordance below the card.
 */
export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 font-sans flex flex-col items-center justify-center p-4">
      {/* Brand accent hairline along the very top edge, echoing SiteHeader. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500"
      />
      {/* Soft background flourishes, matching the landing hero. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-[460px] w-[460px] rounded-full bg-sky-200/40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-in">
        {/* Brand — links to the arena directory, matching SiteHeader's in-app
            convention (post-auth surfaces default to /arenas, not the marketing /). */}
        <Link href="/arenas" className="group mb-6 flex items-center justify-center gap-3">
          <BrandMark className="h-11 w-11" />
          <Wordmark className="text-xl" />
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur-sm sm:p-7">
          <h1 className="font-display text-xl font-extrabold tracking-tight text-slate-900">
            {title}
          </h1>
          <p className="mb-5 mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>

        {footer && <div className="mt-5 space-y-3 text-center">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * The standard submit button for both auth forms — full-width emerald with a
 * loading state. Kept here so the two pages share one button treatment.
 *
 * @param {object} props
 * @param {boolean} props.loading - Disables the button and swaps to `loadingLabel`.
 * @param {string} props.label - Idle button text.
 * @param {string} props.loadingLabel - Text shown while submitting.
 */
export function AuthSubmit({ loading, label, loadingLabel }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-xl bg-emerald-600 px-5 py-2.5 font-display font-extrabold
        text-white shadow-lg shadow-emerald-500/25 transition duration-150
        hover:bg-emerald-700 hover:shadow-emerald-500/40
        disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

/** Shared inline error banner for both auth forms. */
export function AuthError({ children }) {
  return (
    <div
      role="alert"
      data-testid="auth-error"
      className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
    >
      {children}
    </div>
  );
}

/** Footer cross-link ("No account? Create one") used below each card. */
export function AuthCrossLink({ prompt, href, action }) {
  return (
    <p className="text-sm text-slate-500">
      {prompt}{' '}
      <Link href={href} className="font-semibold text-emerald-600 hover:text-emerald-700">
        {action}
      </Link>
    </p>
  );
}

/** Maps a provider id to its brand icon. Provider list/labels + the selection
 *  logic live in `@/lib/social-providers` (pure, unit-tested); icons stay here
 *  since they're JSX. */
const SOCIAL_PROVIDER_ICONS = { google: GoogleIcon };

/**
 * Social sign-in block shared by `/login` and `/register`: an "or continue
 * with" divider above full-width provider buttons. Each calls `signIn.social`,
 * which redirects the browser to the provider and back to `callbackURL` on
 * success, so a successful click navigates away (the button stays disabled
 * meanwhile). Errors are surfaced inline via `AuthError`.
 *
 * Only renders buttons for `providers` the server actually configured, so a
 * deployment with just one provider (or none) never shows a button that would
 * fail on click. Renders nothing when no providers are enabled.
 *
 * @param {object} props
 * @param {string} props.next - Post-auth destination (already run through `safeNext`).
 * @param {string[]} [props.providers] - Enabled provider ids (e.g. ['google']).
 */
export function SocialAuthButtons({ next, providers = [] }) {
  const [loading, setLoading] = useState(null); // provider id | null
  const [error, setError] = useState('');

  const visibleProviders = visibleSocialProviders(providers);
  if (visibleProviders.length === 0) return null;

  const handleSocial = async (provider) => {
    setError('');
    setLoading(provider);
    try {
      const { error: signInError } = await signIn.social({ provider, callbackURL: next });
      if (signInError) {
        setError(signInError.message || `Could not continue with ${provider}.`);
        setLoading(null);
      }
      // On success the browser is redirected to the provider — nothing else to do.
    } catch (err) {
      setError(err?.message || `Could not continue with ${provider}.`);
      setLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium text-slate-400">or continue with</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {error && <AuthError>{error}</AuthError>}

      <div className="grid gap-2.5">
        {visibleProviders.map(({ id, label }) => {
          const Icon = SOCIAL_PROVIDER_ICONS[id];
          return (
            <SocialButton
              key={id}
              label={label}
              loading={loading === id}
              disabled={loading !== null}
              onClick={() => handleSocial(id)}
              icon={<Icon />}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A single social provider button — white/bordered to sit apart from the emerald submit. */
function SocialButton({ label, loading, disabled, onClick, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200
        bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition
        hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="grid h-5 w-5 place-items-center" aria-hidden="true">
        {icon}
      </span>
      {loading ? 'Redirecting…' : label}
    </button>
  );
}

/** Google's four-colour "G" mark. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export { BackPill };
