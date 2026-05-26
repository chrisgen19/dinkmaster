'use client';

import Link from 'next/link';
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
        {/* Brand — links home, consistent with the app header. */}
        <Link href="/" className="group mb-6 flex items-center justify-center gap-3">
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

export { BackPill };
