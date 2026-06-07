import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { BrandMark, Wordmark } from './site-header';
import { AuthStatus } from './auth-status';
import PaddleStackSimulator from './paddle-stack-simulator-client';
import HeadlineCycle from './headline-cycle-client';
import FAQAccordion from './landing-accordion-client';

export const dynamic = 'force-dynamic';

function FeatureCard({ icon, title, children }) {
  return (
    <div className="relative bg-white border border-slate-200/80 hover:border-emerald-300 rounded-2xl p-6 transition-all duration-300 group shadow-sm hover:shadow-md hover:shadow-slate-100 hover:-translate-y-1 overflow-hidden">
      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none group-hover:bg-emerald-500/10 transition" />
      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-800 text-white grid place-items-center shadow-md shadow-emerald-800/15 mb-4 group-hover:scale-105 transition-transform font-bold">
        {icon}
      </div>
      <h3 className="font-display text-lg font-extrabold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{children}</p>
    </div>
  );
}

function StepCard({ number, title, description }) {
  return (
    <div className="relative bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm hover:shadow-md transition duration-200 flex flex-col items-start gap-4">
      <span className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-700 text-white border border-emerald-800 text-xs font-extrabold font-mono shadow-sm">
        {number}
      </span>
      <div>
        <h4 className="font-display text-lg font-extrabold text-slate-900">{title}</h4>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const user = await getCurrentUser();
  const primaryHref = user ? '/arenas' : '/register';
  const primaryLabel = user ? 'Go to Arenas' : 'Get Started Free';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col overflow-x-hidden selection:bg-emerald-500 selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50">
        <div
          aria-hidden="true"
          className="h-0.5 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500"
        />
        <div className="border-b border-slate-200/80 bg-white/85 backdrop-blur-xl px-4 py-3 md:px-8 md:py-4 flex items-center justify-between gap-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <Link href="/" className="group flex items-center gap-3 min-w-0">
            <BrandMark />
            <Wordmark className="text-xl" />
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

      {/* Hero Section */}
      <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden grid-bg-pattern-light border-b border-slate-200/50">
        {/* Soft background glow circles */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-[120px]" />
          <div className="absolute top-1/2 right-10 w-[400px] h-[400px] rounded-full bg-teal-500/5 blur-[100px]" />
        </div>

        <div className="max-w-6xl mx-auto px-4 md:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Hero Left Content */}
          <div className="lg:col-span-5 text-left flex flex-col items-start">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80 px-3 py-1 text-xs font-bold uppercase tracking-wider mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Pickleball Stack Manager
            </span>
            
            <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.05]">
              Ditch the Whiteboard.<br />
              <span className="text-emerald-700 font-extrabold">Smart</span> <HeadlineCycle />
            </h1>

            <p className="text-slate-600 text-base md:text-lg mt-6 leading-relaxed max-w-lg">
              Stop fighting over whose paddle is next. Dinkmaster handles the queue, mixes partnerships fairly, and logs skill ratings dynamically — right from your smartphone.
            </p>

            <div className="flex flex-wrap items-center gap-3 mt-8 w-full sm:w-auto">
              <Link
                href={primaryHref}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold px-7 py-3.5 rounded-xl shadow-md shadow-emerald-700/10 transition duration-150 hover:-translate-y-0.5"
              >
                {primaryLabel}
                <svg className="w-4 h-4 stroke-[3px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href="/arenas"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-extrabold px-7 py-3.5 rounded-xl border border-slate-200 shadow-sm transition duration-150"
              >
                Browse arenas
              </Link>
            </div>

            {/* Social Proof metrics */}
            <div className="mt-10 pt-8 border-t border-slate-200 w-full flex items-center gap-8 text-slate-500">
              <div>
                <p className="text-2xl font-extrabold text-slate-800 font-display">10,000+</p>
                <p className="text-[10px] uppercase tracking-wider mt-1 font-bold">Games Stacked</p>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div>
                <p className="text-2xl font-extrabold text-slate-800 font-display">500+</p>
                <p className="text-[10px] uppercase tracking-wider mt-1 font-bold">Pickleball Clubs</p>
              </div>
            </div>
          </div>

          {/* Hero Right Content: Live queue simulator */}
          <div className="lg:col-span-7 w-full shadow-lg rounded-3xl">
            <PaddleStackSimulator />
          </div>
        </div>
      </section>

      {/* Comparison Section (Whiteboard vs Dinkmaster) */}
      <section className="bg-white border-b border-slate-200/50 py-20">
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-emerald-700">The Ultimate Choice</h2>
            <p className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 mt-2">
              Why clubs are retiring physical racks
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* The Old Way */}
            <div className="bg-slate-50/50 border border-slate-200 rounded-3xl p-8 relative overflow-hidden group hover:border-red-200 transition-all duration-300 shadow-sm">
              <div className="absolute top-0 left-0 w-24 h-24 bg-red-500/2 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-3 mb-6">
                <span className="p-2 bg-red-50 text-red-600 border border-red-100 rounded-xl">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
                <h3 className="font-display text-xl font-extrabold text-slate-900">The Dry-Erase Whiteboard</h3>
              </div>
              <ul className="space-y-4 text-slate-600 text-sm">
                <li className="flex items-start gap-3">
                  <span className="text-red-700 font-extrabold mt-0.5">✕</span>
                  <span><strong>Queue Chaos:</strong> Paddles falling off fences or marker names smudged off the dry-erase board.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-red-700 font-extrabold mt-0.5">✕</span>
                  <span><strong>Unbalanced Matchups:</strong> The same four players lock down the courts, excluding newer members.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-red-700 font-extrabold mt-0.5">✕</span>
                  <span><strong>Zero Records:</strong> No match history, no tracked win rates, and no way to calculate skill progress.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-red-700 font-extrabold mt-0.5">✕</span>
                  <span><strong>Organizer Fatigue:</strong> You spend more time shouting names and counting games than playing.</span>
                </li>
              </ul>
            </div>

            {/* The Dinkmaster Way */}
            <div className="bg-emerald-50/20 border border-emerald-200/80 rounded-3xl p-8 relative overflow-hidden group hover:border-emerald-300 transition-all duration-300 shadow-md">
              <div className="absolute top-0 left-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-3 mb-6">
                <span className="p-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl">
                  <svg className="h-5 w-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <h3 className="font-display text-xl font-extrabold text-emerald-800">The Dinkmaster Solution</h3>
              </div>
              <ul className="space-y-4 text-slate-700 text-sm">
                <li className="flex items-start gap-3">
                  <span className="text-emerald-700 font-extrabold mt-0.5">✓</span>
                  <span><strong>Live Stack View:</strong> Real-time queues accessible on everyone’s phone. No crowd around the gate.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-emerald-700 font-extrabold mt-0.5">✓</span>
                  <span><strong>Smart Partnership Mixer:</strong> Algorithms rotate matches automatically to keep sessions social and fair.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-emerald-700 font-extrabold mt-0.5">✓</span>
                  <span><strong>DUPR-Style Metrics:</strong> View wins, losses, win rates, and skill ratings for every club member.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-emerald-700 font-extrabold mt-0.5">✓</span>
                  <span><strong>PWA / Mobile-First:</strong> Organizers easily log court scores and advance the queue in two taps.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Showcase Grid */}
      <section className="bg-slate-50 border-b border-slate-200/50 py-20">
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-emerald-700">Features</h2>
            <p className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 mt-2">
              Everything an open-play session needs
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <path d="M3 10h18M9 4v16" />
                </svg>
              }
              title="Digital Paddle Stack"
            >
              Real-time waiting queue that shows who&apos;s up next, who&apos;s resting, and allows players to step away or pause their priorities without losing slots.
            </FeatureCard>

            <FeatureCard
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="3" />
                  <circle cx="16" cy="16" r="3" />
                  <path d="M11 11l2 2" />
                </svg>
              }
              title="Fair Mixer Matchmaking"
            >
              Rotate partners automatically. Our matching system evaluates games played to guarantee varied matchups and prevents court locking.
            </FeatureCard>

            <FeatureCard
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 17l4-4 4 3 6-7 4 5" />
                </svg>
              }
              title="DUPR-Style Ratings"
            >
              Track wins, losses, win rates, and streak leaders. Calculate skill progression points per arena to organize tiered or balanced matches.
            </FeatureCard>

            <FeatureCard
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
                </svg>
              }
              title="Club & Arena Controls"
            >
              Create an arena for your neighborhood courts. Approve player join requests, add guest walk-ins, and define court counts in seconds.
            </FeatureCard>

            <FeatureCard
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M16 3v4M8 3v4M3 11h18" />
                </svg>
              }
              title="Session Scheduling"
            >
              Schedule ahead. Let players view upcoming times, locations, and RSVP. Alerts keep players aligned on numbers before court check-in.
            </FeatureCard>

            <FeatureCard
              icon={
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3" width="16" height="18" rx="3" />
                  <path d="M9 8h6M9 12h6M9 16h4" />
                </svg>
              }
              title="PWA Mobile Web App"
            >
              Designed mobile-first. Bookmark to your smartphone home screen to run the queue at the court without loading delay or lag.
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* How it works Section (Visual Steps) */}
      <section className="bg-slate-100 text-slate-800 py-20 border-b border-slate-200 grid-bg-pattern-light">
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-emerald-700">Setup Guide</h2>
            <p className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 mt-2">
              From sign-up to first serve in minutes
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <StepCard
              number="01"
              title="Create your Arena"
              description="Name your group or local courts. Specify how many courts are active, invite members, or accept walk-in guest players."
            />
            <StepCard
              number="02"
              title="Add Paddles to Stack"
              description="Organizers check in active players. Their digital paddles stack in order. On-deck players get court-ready immediately."
            />
            <StepCard
              number="03"
              title="Play & Log Scores"
              description="Mix partnerships automatically. Enter final scores to instantly update local leaderboard standings and player skill ratings."
            />
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="bg-white py-20 border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-4 md:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-emerald-700">Questions</h2>
            <p className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 mt-2">
              Frequently Asked Questions
            </p>
          </div>

          <FAQAccordion />
        </div>
      </section>

      {/* Premium CTA Block - Vibrant Gradient Card */}
      <section className="max-w-6xl mx-auto px-4 md:px-8 py-16 md:py-24">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white p-10 md:p-14 border border-emerald-500/10 shadow-xl shadow-emerald-500/10">
          {/* Subtle light washes inside gradient */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-white/10 rounded-full blur-[80px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-teal-400/10 rounded-full blur-[60px] pointer-events-none" />
          
          <div className="relative max-w-2xl">
            <span className="inline-flex items-center gap-1 bg-emerald-950/45 text-white border border-emerald-500/20 px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider mb-4">
              100% Free Open Play
            </span>
            <h2 className="font-display text-3xl md:text-5xl font-extrabold tracking-tight leading-none text-white">
              Ready to stack your first rack?
            </h2>
            <p className="text-emerald-50/90 mt-4 text-base md:text-lg max-w-xl">
              Create an arena for your neighborhood court in under a minute. No credit cards, no setup wizards, just pickleball.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link
                href={primaryHref}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white hover:bg-emerald-50 text-emerald-800 font-extrabold px-6 py-3.5 rounded-xl shadow-md transition duration-150 hover:-translate-y-0.5"
              >
                {primaryLabel}
                <svg className="w-4 h-4 stroke-[3px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </Link>
              {!user && (
                <Link
                  href="/login"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-950/40 hover:bg-emerald-950/60 text-white font-bold px-6 py-3.5 rounded-xl border border-white/10 transition"
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
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <BrandMark className="h-8 w-8" />
            <Wordmark className="text-lg" />
          </div>
          
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="text-xs font-semibold text-slate-600 hover:text-emerald-700 transition">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-xs font-semibold text-slate-600 hover:text-emerald-700 transition">
              Terms of Service
            </Link>
            <Link href="/data-deletion" className="text-xs font-semibold text-slate-600 hover:text-emerald-700 transition">
              Data Deletion
            </Link>
          </div>

          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} Dinkmaster. Built for pickleball communities.
          </p>
        </div>
      </footer>
    </div>
  );
}
