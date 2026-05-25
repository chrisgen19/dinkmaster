import Link from 'next/link';

/**
 * Arena hero strip — sits between the SiteHeader and the sticky tab bar. Holds
 * everything that gives the page its identity: back affordance, arena name,
 * description, schedule blurb, key stat numbers, and the Manage button. Pure
 * presentational; the parent owns all state.
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {string} props.arenaName
 * @param {string} [props.description] - Manager-set blurb (optional).
 * @param {string} [props.scheduleLabel] - One-line schedule summary (optional).
 * @param {number} props.playerCount
 * @param {number} props.queueLength
 * @param {number} props.liveCourtCount
 * @param {boolean} props.canManage - Whether to render the Settings link.
 */
export function ArenaHero({
  arenaId,
  arenaName,
  description,
  scheduleLabel,
  playerCount,
  queueLength,
  liveCourtCount,
  canManage,
}) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Soft brand wash behind the hero — keeps the page from feeling flat
          while staying out of the way of the white card content below. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute -top-24 -left-20 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute -top-16 right-0 h-72 w-72 rounded-full bg-sky-200/30 blur-3xl" />
      </div>

      <div className="w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8 pt-5 md:pt-7 pb-5 md:pb-6">
        {/* Top row: back chip + manage CTA */}
        <div className="flex items-center justify-between gap-3 mb-3 md:mb-4">
          <Link
            href="/arenas"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/80 backdrop-blur
              ring-1 ring-slate-200 hover:ring-emerald-300 hover:text-emerald-700
              text-slate-600 text-[11px] md:text-xs font-bold uppercase tracking-wide
              pl-1.5 pr-3 py-1 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            All arenas
          </Link>

          {canManage && (
            <Link
              href={`/arena/${arenaId}/settings`}
              className="inline-flex items-center gap-1.5 rounded-xl
                bg-slate-900 hover:bg-slate-800 text-white text-xs md:text-sm font-extrabold
                px-3 py-2 md:px-4 md:py-2.5 shadow-sm transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span className="hidden sm:inline">Manage</span>
              <span className="sm:hidden">Settings</span>
            </Link>
          )}
        </div>

        {/* Identity row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 items-end">
          <div className="lg:col-span-7 min-w-0">
            {scheduleLabel && (
              <p className="inline-flex items-center gap-1.5 text-[11px] md:text-xs font-extrabold uppercase tracking-widest text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-2.5 py-1 mb-3">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                {scheduleLabel}
              </p>
            )}

            <h1 className="font-display font-extrabold tracking-tight text-slate-900 leading-[1.05] text-3xl md:text-4xl lg:text-[44px]">
              {arenaName}
            </h1>

            {description && (
              <p className="text-sm md:text-[15px] text-slate-500 leading-relaxed mt-2 md:mt-3 max-w-prose">
                {description}
              </p>
            )}
          </div>

          {/* Stat tiles — big numbers, color-coded to match the visual language
              used elsewhere (slate = total, emerald = queue, sky = live). */}
          <div className="lg:col-span-5 grid grid-cols-3 gap-2 md:gap-3">
            <StatTile label="Players" value={playerCount} tone="slate" />
            <StatTile label="Queued" value={queueLength} tone="emerald" />
            <StatTile label="Live" value={liveCourtCount} tone="sky" />
          </div>
        </div>
      </div>
    </section>
  );
}

const TONE_CLASSES = {
  slate: 'text-slate-900',
  emerald: 'text-emerald-600',
  sky: 'text-sky-600',
};

function StatTile({ label, value, tone = 'slate' }) {
  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-3 py-3 md:px-4 md:py-3.5">
      <p className="text-[10px] md:text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className={`font-display font-extrabold tracking-tight tabular-nums text-2xl md:text-3xl lg:text-[32px] leading-none mt-1 ${TONE_CLASSES[tone]}`}>
        {value}
      </p>
    </div>
  );
}
