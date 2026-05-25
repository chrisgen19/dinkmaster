import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { AuthStatus } from '../../auth-status';
import { SiteHeader } from '../../site-header';
import { CreateArenaForm } from '../../create-arena-form';

export const dynamic = 'force-dynamic';

export default async function NewArenaPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/arenas/new');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="home">
        <AuthStatus />
      </SiteHeader>

      <main className="flex-1 w-full max-w-2xl mx-auto p-4 md:p-8 space-y-6">
        <div>
          <Link
            href="/arenas"
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200
              text-slate-500 hover:text-slate-700 text-[11px] font-bold uppercase tracking-wide
              pl-1.5 pr-2.5 py-0.5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            All arenas
          </Link>
          <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mt-2">
            Create a new arena
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Set the basics now — you can refine everything later in arena settings.
          </p>
        </div>

        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-7">
          <CreateArenaForm />
        </section>
      </main>
    </div>
  );
}
