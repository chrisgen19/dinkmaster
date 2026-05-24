import { notFound } from 'next/navigation';
import { SiteHeader } from '@/app/site-header';
import { AuthStatus } from '@/app/auth-status';
import { ArenaSettings } from '@/app/arena-settings';
import { SETTINGS_SECTION_SLUGS, sectionIdFromSlug } from '@/app/arena-settings-sections';
import { loadArenaForSettings } from '../_load';

// Settings reads/writes live arena config; never serve a cached copy.
export const dynamic = 'force-dynamic';

/**
 * Per-section settings page (`/arena/[id]/settings/[section]`). Drives the
 * mobile drill-down (iOS-style sections list → this page), and also serves as
 * the deep-link target on desktop so the section nav is real URL navigation.
 *
 * Unknown slugs `notFound()` rather than silently falling back — a typo'd
 * bookmark deserves a 404, and validating here means the client component
 * never has to defend against a bogus section id.
 */
export default async function ArenaSettingsSectionPage({ params }) {
  const { id, section: slug } = await params;
  if (!SETTINGS_SECTION_SLUGS.includes(slug)) notFound();
  const sectionId = sectionIdFromSlug(slug);

  const { arena, props } = await loadArenaForSettings(id);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="arena" arenaName={arena.name}>
        <AuthStatus />
      </SiteHeader>
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        <ArenaSettings section={sectionId} {...props} />
      </main>
    </div>
  );
}
