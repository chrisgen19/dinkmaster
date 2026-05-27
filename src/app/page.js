import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { BrandMark, Wordmark } from './site-header';
import { AuthStatus } from './auth-status';

export const dynamic = 'force-dynamic';

function FeatureCard({ icon, title, children }) {
  return (
    <div className="relative bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-emerald-300 transition group">
      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 text-white grid place-items-center shadow-md shadow-emerald-500/25 mb-4 group-hover:scale-105 transition-transform">
        {icon}
      </div>
      <h3 className="font-display text-lg font-extrabold text-slate-900 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed">{children}</p>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="relative pl-12">
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 font-display font-extrabold grid place-items-center ring-1 ring-emerald-200"
      >
        {n}
      </span>
      <h4 className="font-display font-extrabold text-slate-900">{title}</h4>
      <p className="text-sm text-slate-500 mt-1 leading-relaxed">{children}</p>
    </div>
  );
}

export default async function LandingPage() {
  const user = await getCurrentUser();
  const primaryHref = user ? '/arenas' : '/register';
  const primaryLabel = user ? 'Go to your arenas' : 'Get started — it’s free';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50">
        <div
          aria-hidden="true"
          className="h-0.5 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500"
        />
        <div className="border-b border-slate-200/70 bg-white/80 backdrop-blur-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-4 py-3 md:px-8 md:py-4 flex items-center justify-between gap-3">
          <Link href="/" className="group flex items-center gap-3 min-w-0">
            <BrandMark />
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2 md:gap-3">
            <Link
              href="/arenas"
              className="hidden sm:inline-flex text-sm font-semibold text-slate-600 hover:text-emerald-700 px-3 py-2 rounded-lg transition"
            >
              Browse arenas
            </Link>
            <AuthStatus />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        {/* Soft background flourishes */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-0"
        >
          <div className="absolute -top-24 -left-24 w-[480px] h-[480px] rounded-full bg-emerald-200/40 blur-3xl" />
          <div className="absolute top-20 -right-32 w-[520px] h-[520px] rounded-full bg-sky-200/40 blur-3xl" />
        </div>

        <div className="relative w-full max-w-6xl mx-auto px-4 md:px-8 pt-16 pb-20 md:pt-24 md:pb-28 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-1 text-xs font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Pickleball, organized
          </span>
          <h1 className="font-display text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 mt-5 leading-[1.05]">
            Smart paddle stacking &amp;{' '}
            <span className="bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 bg-clip-text text-transparent">
              partnership mixing
            </span>
          </h1>
          <p className="text-base md:text-lg text-slate-500 mt-5 max-w-2xl mx-auto leading-relaxed">
            Run open-play sessions without the chaos. Dinkmaster handles the queue, mixes
            partners fairly, and tracks every game — so you can just play.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <Link
              href={primaryHref}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition"
            >
              {primaryLabel}
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </Link>
            <Link
              href="/arenas"
              className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-bold px-6 py-3 rounded-xl ring-1 ring-slate-200 transition"
            >
              Browse arenas
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="w-full max-w-6xl mx-auto px-4 md:px-8 pb-20">
        <div className="text-center mb-10">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-emerald-700">
            What you get
          </h2>
          <p className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mt-2">
            Everything an open-play session needs
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <path d="M3 10h18M9 4v16" />
              </svg>
            }
            title="Paddle Rack Stack"
          >
            A digital paddle rack that tracks who’s next, who just played, and who’s
            resting — with skip and on-deck queueing built in.
          </FeatureCard>
          <FeatureCard
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="3" />
                <circle cx="16" cy="16" r="3" />
                <path d="M11 11l2 2" />
              </svg>
            }
            title="Fair partner mixing"
          >
            Avoid the same four playing every round. Dinkmaster rotates partners to
            keep play balanced and social.
          </FeatureCard>
          <FeatureCard
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l4-4 4 3 6-7 4 5" />
              </svg>
            }
            title="Stats that actually matter"
          >
            Wins, losses, win rate, weekly leaders, and a DUPR-style rating — per
            arena and across your profile.
          </FeatureCard>
          <FeatureCard
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
              </svg>
            }
            title="Arenas you control"
          >
            Create an arena for your club or neighborhood. Invite players, approve
            requests, and run it your way.
          </FeatureCard>
          <FeatureCard
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 11h18" />
              </svg>
            }
            title="Session scheduling"
          >
            Plan ahead with arena sessions. Players know when and where to show up,
            and the prep banner gets everyone aligned on the day.
          </FeatureCard>
          <FeatureCard
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3" width="16" height="18" rx="3" />
                <path d="M9 8h6M9 12h6M9 16h4" />
              </svg>
            }
            title="Mobile-first"
          >
            Built to feel great on a phone court-side — no awkward zooming or
            squinting to find the next match.
          </FeatureCard>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white border-y border-slate-200">
        <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-16 md:py-20">
          <div className="text-center mb-10">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-emerald-700">
              How it works
            </h2>
            <p className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mt-2">
              From sign-up to first serve in minutes
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Step n="1" title="Create your arena">
              Set up an arena for your group. Add courts and invite players, or open it
              up for join requests.
            </Step>
            <Step n="2" title="Start a session">
              Mark who’s in for today. The paddle rack manages the queue and mixes
              partners as games finish.
            </Step>
            <Step n="3" title="Play & track">
              Log scores as you go. Stats, ratings, and weekly leaders update
              automatically.
            </Step>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="w-full max-w-6xl mx-auto px-4 md:px-8 py-16 md:py-24">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-600 text-white p-10 md:p-14 shadow-xl shadow-emerald-500/20">
          <div
            aria-hidden="true"
            className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-white/15 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-sky-300/30 blur-2xl"
          />
          <div className="relative max-w-2xl">
            <h2 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
              Ready to run a better open play?
            </h2>
            <p className="text-emerald-50/90 mt-3 text-base md:text-lg">
              Spin up an arena in under a minute. No credit card, no setup wizard.
            </p>
            <div className="flex flex-wrap gap-3 mt-7">
              <Link
                href={primaryHref}
                className="inline-flex items-center gap-2 bg-white text-emerald-700 hover:bg-emerald-50 font-bold px-6 py-3 rounded-xl shadow-lg transition"
              >
                {primaryLabel}
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </Link>
              {!user && (
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold px-6 py-3 rounded-xl ring-1 ring-white/40 transition"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white">
        <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark className="h-8 w-8" />
            <Wordmark />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/privacy" className="text-xs font-semibold text-slate-500 hover:text-emerald-700 transition">
              Privacy
            </Link>
            <Link href="/terms" className="text-xs font-semibold text-slate-500 hover:text-emerald-700 transition">
              Terms
            </Link>
            <Link href="/data-deletion" className="text-xs font-semibold text-slate-500 hover:text-emerald-700 transition">
              Data deletion
            </Link>
            <p className="text-xs text-slate-400">
              © {new Date().getFullYear()} Dinkmaster. Built for pickleball communities.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
