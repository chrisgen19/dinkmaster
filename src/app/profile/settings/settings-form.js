'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { GENDER_OPTIONS } from '@/lib/user-profile';
import { AUTH_FIELD_CLASS, AuthError } from '../../auth-shell';

/**
 * Profile settings form: three independently-submitting sections — profile
 * information, change password, and (when Google is enabled) linked accounts.
 * Each section owns its own loading / error / success state so one failing
 * section never blocks the others.
 *
 * @param {object} props
 * @param {object} props.initialUser - { id, name, firstName, lastName, phone,
 *   address, birthday (YYYY-MM-DD), gender, email }
 * @param {string[]} props.enabledSocialProviders - configured provider ids.
 */
export function SettingsForm({ initialUser, enabledSocialProviders = [] }) {
  const googleEnabled = enabledSocialProviders.includes('google');

  return (
    <div className="space-y-6">
      <ProfileSection initialUser={initialUser} />
      <PasswordSection />
      {googleEnabled && <GoogleSection />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Shared section chrome */

function SettingsCard({ title, description, children }) {
  return (
    <section className="animate-fade-in rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <h2 className="font-display text-base md:text-lg font-extrabold tracking-tight text-slate-900">
        {title}
      </h2>
      {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Inline success notice — emerald counterpart to the shared `AuthError`. */
function SuccessNotice({ children }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"
    >
      {children}
    </div>
  );
}

function FieldLabel({ htmlFor, children }) {
  return (
    <label htmlFor={htmlFor} className="ml-1 text-[11px] font-semibold text-slate-400">
      {children}
    </label>
  );
}

function SectionSubmit({ loading, label, loadingLabel }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-display font-extrabold
        text-white shadow-lg shadow-emerald-500/25 transition duration-150
        hover:bg-emerald-700 hover:shadow-emerald-500/40
        disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 1. Profile information */

function ProfileSection({ initialUser }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initialUser.firstName);
  const [lastName, setLastName] = useState(initialUser.lastName);
  const [phone, setPhone] = useState(initialUser.phone);
  const [address, setAddress] = useState(initialUser.address);
  const [birthday, setBirthday] = useState(initialUser.birthday);
  const [gender, setGender] = useState(initialUser.gender);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // HTML `required` accepts whitespace-only — trim and reject up front so a
    // blank name can't reach the server.
    const firstNameTrimmed = firstName.trim();
    const lastNameTrimmed = lastName.trim();
    if (!firstNameTrimmed || !lastNameTrimmed) {
      setError('Please enter your first and last name.');
      return;
    }

    setLoading(true);
    try {
      // `name` is Better Auth's core field; keep it as "First Last", mirroring
      // the register form. Optional extras send trimmed values (or empty
      // strings, which the server normalizes to null).
      const name = `${firstNameTrimmed} ${lastNameTrimmed}`;
      const { error: updateError } = await authClient.updateUser({
        name,
        firstName: firstNameTrimmed,
        lastName: lastNameTrimmed,
        phone: phone.trim(),
        address: address.trim(),
        // A birthday is a calendar date, not an instant — anchor it to UTC
        // midnight so it reads back as the same day regardless of the browser's
        // or the server's timezone (page.js reads it with UTC getters).
        birthday: birthday ? new Date(`${birthday}T00:00:00Z`) : null,
        gender: gender || null,
      });
      if (updateError) {
        setError(updateError.message || 'Could not save your profile.');
        return;
      }
      setSuccess('Profile updated.');
      // Refresh so the header avatar / profile page reflect the new name.
      router.refresh();
    } catch (err) {
      setError(err?.message || 'Could not save your profile.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsCard
      title="Profile information"
      description="Update your name and contact details."
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
          type="tel"
          autoComplete="tel"
          placeholder="Phone number"
          aria-label="Phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={AUTH_FIELD_CLASS}
        />
        <input
          type="text"
          autoComplete="street-address"
          placeholder="Address"
          aria-label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={AUTH_FIELD_CLASS}
        />
        <div>
          <FieldLabel htmlFor="settings-birthday">Birthday</FieldLabel>
          <input
            id="settings-birthday"
            type="date"
            aria-label="Birthday"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            className={`${AUTH_FIELD_CLASS} mt-1`}
          />
        </div>
        <select
          aria-label="Gender"
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className={`${AUTH_FIELD_CLASS} ${gender ? '' : 'text-slate-400'}`}
        >
          <option value="">Gender</option>
          {GENDER_OPTIONS.map((option) => (
            <option key={option} value={option} className="text-slate-800">
              {option}
            </option>
          ))}
        </select>

        {error && <AuthError>{error}</AuthError>}
        {success && <SuccessNotice>{success}</SuccessNotice>}

        <SectionSubmit loading={loading} label="Save changes" loadingLabel="Saving…" />
      </form>
    </SettingsCard>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 2. Change password */

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: changeError } = await authClient.changePassword({
        currentPassword,
        newPassword,
        // Sign other devices out on a password change — if the change is a
        // response to suspected compromise, lingering sessions defeat it. The
        // current session is preserved, so the user stays signed in here.
        revokeOtherSessions: true,
      });
      if (changeError) {
        // A Google-only account has no credential/password — Better Auth
        // returns CREDENTIAL_ACCOUNT_NOT_FOUND. Surface a friendly hint
        // instead of the raw "Credential account not found".
        if (
          changeError.code === 'CREDENTIAL_ACCOUNT_NOT_FOUND' ||
          /credential account not found/i.test(changeError.message || '')
        ) {
          setError(
            'You signed up with Google, so there’s no password to change. Sign in with Google to manage your account.',
          );
          return;
        }
        setError(changeError.message || 'Could not change your password.');
        return;
      }
      setSuccess('Password changed.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err?.message || 'Could not change your password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsCard
      title="Change password"
      description="Choose a new password — at least 8 characters."
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Current password"
          aria-label="Current password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={AUTH_FIELD_CLASS}
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder="New password (min. 8 characters)"
          aria-label="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={AUTH_FIELD_CLASS}
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder="Confirm new password"
          aria-label="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={AUTH_FIELD_CLASS}
        />

        {error && <AuthError>{error}</AuthError>}
        {success && <SuccessNotice>{success}</SuccessNotice>}

        <SectionSubmit loading={loading} label="Change password" loadingLabel="Changing…" />
      </form>
    </SettingsCard>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 3. Linked accounts (Google) */

function GoogleSection() {
  const router = useRouter();
  // status: 'loading' | 'ready' | 'error' — for the initial listAccounts read.
  const [status, setStatus] = useState('loading');
  const [googleLinked, setGoogleLinked] = useState(false);
  // True when the user has a password account or another linked provider, so
  // unlinking Google won't strip their last sign-in method.
  const [hasOtherSignIn, setHasOtherSignIn] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshAccounts = async () => {
    setStatus('loading');
    setError('');
    try {
      const { data, error: listError } = await authClient.listAccounts();
      if (listError) {
        setStatus('error');
        setError(listError.message || 'Could not load linked accounts.');
        return;
      }
      const accounts = data ?? [];
      setGoogleLinked(accounts.some((a) => a.providerId === 'google'));
      // Any account that isn't the Google link (a credential/password account
      // or another social provider) is an alternative way to sign in.
      setHasOtherSignIn(accounts.some((a) => a.providerId !== 'google'));
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err?.message || 'Could not load linked accounts.');
    }
  };

  // Read linked accounts on mount. `listAccounts` is browser-only (it hits the
  // session cookie), so it can't run during SSR — this is the standard
  // fetch-on-mount pattern, deliberately keyed to the empty deps array.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot fetch-on-mount; refreshAccounts flips status to 'loading' then resolves
    refreshAccounts();
  }, []);

  const handleConnect = async () => {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const { error: linkError } = await authClient.linkSocial({
        provider: 'google',
        callbackURL: '/profile/settings',
      });
      if (linkError) {
        setError(linkError.message || 'Could not connect Google.');
        setBusy(false);
        return;
      }
      // On success the browser is redirected to Google — nothing else to do.
    } catch (err) {
      setError(err?.message || 'Could not connect Google.');
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const { error: unlinkError } = await authClient.unlinkAccount({
        providerId: 'google',
      });
      if (unlinkError) {
        setError(unlinkError.message || 'Could not unlink Google.');
        return;
      }
      setSuccess('Google account unlinked.');
      await refreshAccounts();
      router.refresh();
    } catch (err) {
      setError(err?.message || 'Could not unlink Google.');
    } finally {
      setBusy(false);
    }
  };

  // Don't allow unlinking the only remaining sign-in method.
  const unlinkLocked = googleLinked && !hasOtherSignIn;

  return (
    <SettingsCard
      title="Linked accounts"
      description="Connect Google to sign in faster."
    >
      {status === 'loading' && (
        <div className="h-10 w-full rounded-xl bg-slate-100 animate-pulse" />
      )}

      {status === 'error' && (
        <div className="space-y-3">
          {error && <AuthError>{error}</AuthError>}
          <button
            type="button"
            onClick={refreshAccounts}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
          >
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white ring-1 ring-slate-200">
                <GoogleIcon />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">Google</p>
                <p className="text-xs text-slate-500">
                  {googleLinked ? 'Connected' : 'Not connected'}
                </p>
              </div>
            </div>

            {googleLinked ? (
              <button
                type="button"
                onClick={handleUnlink}
                disabled={busy || unlinkLocked}
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold
                  text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Unlinking…' : 'Unlink'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={busy}
                className="shrink-0 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white
                  shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Redirecting…' : 'Connect Google'}
              </button>
            )}
          </div>

          {unlinkLocked && (
            <p className="text-xs text-slate-500">
              Google is your only sign-in method, so it can’t be removed — that would
              leave you locked out of your account.
            </p>
          )}

          {error && <AuthError>{error}</AuthError>}
          {success && <SuccessNotice>{success}</SuccessNotice>}
        </div>
      )}
    </SettingsCard>
  );
}

/** Google's four-colour "G" mark (kept local — sized for the row). */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
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
