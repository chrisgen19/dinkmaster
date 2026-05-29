import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { enabledSocialProviders } from '@/lib/auth';
import { AuthStatus } from '../../auth-status';
import { SiteHeader } from '../../site-header';
import { BackPill } from '../../back-pill';
import { SettingsForm } from './settings-form';

// Always read the freshest user record on each request.
export const dynamic = 'force-dynamic';

/** Format a stored birthday (Date | string | null) as YYYY-MM-DD for a date
 *  input. Read from UTC components so the calendar day is stable regardless of
 *  the server's timezone — the settings form writes it anchored to UTC midnight. */
function toDateInputValue(birthday) {
  if (!birthday) return '';
  const date = birthday instanceof Date ? birthday : new Date(birthday);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const initialUser = {
    id: user.id,
    name: user.name ?? '',
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    phone: user.phone ?? '',
    address: user.address ?? '',
    birthday: toDateInputValue(user.birthday),
    gender: user.gender ?? '',
    email: user.email ?? '',
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="home">
        <AuthStatus />
      </SiteHeader>

      {/* Soft brand wash, kept faint so the page reads editorial, not flashy. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
        <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="absolute -top-24 right-0 h-80 w-80 rounded-full bg-sky-200/25 blur-3xl" />
      </div>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-12 space-y-8">
        <BackPill fallbackHref="/profile" label="Back to profile" />

        <header className="animate-fade-in [animation-delay:40ms]">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400 mb-1">
            Account
          </p>
          <h1 className="font-display font-extrabold tracking-tight text-slate-900 leading-[1.05] text-3xl md:text-4xl">
            Settings
          </h1>
          <p className="text-sm text-slate-500 mt-1">{initialUser.email}</p>
        </header>

        <SettingsForm
          initialUser={initialUser}
          enabledSocialProviders={enabledSocialProviders}
        />
      </main>
    </div>
  );
}
