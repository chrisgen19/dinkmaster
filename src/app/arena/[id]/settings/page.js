import { SiteHeader } from '@/app/site-header';
import { AuthStatus } from '@/app/auth-status';
import { ArenaSettings } from '@/app/arena-settings';
import { loadArenaForSettings } from './_load';

// Settings reads/writes live arena config; never serve a cached copy.
export const dynamic = 'force-dynamic';

/**
 * Owner/organizer settings for one arena. Non-managers are bounced back to the
 * arena view; the page itself only renders for managers. Within Danger Zone,
 * reset is manager-accessible while transfer/delete are owner-only — gated in
 * the client component and re-enforced by the server actions they call.
 */
export default async function ArenaSettingsPage({ params }) {
  const { id } = await params;
  const { arena, props } = await loadArenaForSettings(id);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="arena" arenaName={arena.name}>
        <AuthStatus />
      </SiteHeader>
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        <ArenaSettings section={null} {...props} />
      </main>
    </div>
  );
}
