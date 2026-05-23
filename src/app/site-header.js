import Link from 'next/link';

/**
 * The DinkMaster brand tile — a gradient paddle-court mark with a soft glow and
 * inner sheen. Presentational only; wrap it in a link where navigation is
 * wanted. Lives in `.group` so the parent can drive the hover lift.
 *
 * @param {object} props
 * @param {string} [props.className] - Sizing/extra classes for the tile.
 */
export function BrandMark({ className = 'h-11 w-11' }) {
  return (
    <span
      aria-hidden="true"
      className={`relative grid place-items-center shrink-0 rounded-2xl
        bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600
        shadow-lg shadow-emerald-500/30 ring-1 ring-inset ring-white/30
        transition-[transform,box-shadow] duration-300
        group-hover:scale-105 group-hover:shadow-emerald-500/45
        before:absolute before:inset-0 before:rounded-2xl
        before:bg-gradient-to-b before:from-white/35 before:to-transparent before:opacity-80
        ${className}`}
    >
      <svg className="relative w-[58%] h-[58%] text-white drop-shadow-sm" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm-3 5c.83 0 1.5.67 1.5 1.5S9.83 10 9 10s-1.5-.67-1.5-1.5S8.17 7 9 7zm-2 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm6 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1-5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3.5-3.5c-.83 0-1.5-.67-1.5-1.5S16.17 7 17 7s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm-5-10c-.83 0-1.5-.67-1.5-1.5S12.17 3 13 3s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
      </svg>
    </span>
  );
}

/**
 * The two-tone DinkMaster wordmark in the display face.
 */
function Wordmark({ className = 'text-xl' }) {
  return (
    <span className={`font-display font-extrabold tracking-tight leading-none ${className}`}>
      <span className="text-slate-900">Dink</span>
      <span className="text-emerald-600">master</span>
    </span>
  );
}

/**
 * Shared application header: a glass bar with a gradient accent strip and an
 * orchestrated entrance. The left side carries the brand (and, on arena pages,
 * a back affordance + arena name); the right side is supplied by the caller via
 * `children` so each page can drop in its own actions (auth, stats, etc.).
 *
 * @param {object} props
 * @param {'home' | 'arena'} [props.variant] - Which left-side treatment to render.
 * @param {string} props.arenaName - Arena title (required when variant='arena').
 * @param {React.ReactNode} [props.children] - Right-aligned actions.
 */
export function SiteHeader({ variant = 'home', arenaName, children }) {
  return (
    <header className="sticky top-0 z-50">
      {/* Brand accent hairline along the very top edge. */}
      <div
        aria-hidden="true"
        className="h-0.5 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500"
      />

      <div
        className="border-b border-slate-200/70 bg-white/80 backdrop-blur-xl
          shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-18px_rgba(15,23,42,0.25)]
          px-4 py-3 md:px-8 md:py-4
          flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
      >
        {/* Brand area */}
        <div className="animate-header-rise min-w-0">
          {variant === 'arena' ? (
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/" className="group shrink-0" aria-label="Back to all arenas">
                <BrandMark className="h-10 w-10 md:h-11 md:w-11" />
              </Link>
              <div className="min-w-0">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200
                    text-slate-500 hover:text-slate-700 text-[11px] font-bold uppercase tracking-wide
                    pl-1.5 pr-2.5 py-0.5 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  All arenas
                </Link>
                <h1 className="font-display text-lg md:text-2xl font-extrabold tracking-tight text-slate-900 leading-tight truncate">
                  {arenaName}
                </h1>
              </div>
            </div>
          ) : (
            <Link href="/" className="group flex items-center gap-3 min-w-0">
              <BrandMark />
              <div className="min-w-0">
                <Wordmark />
                <p className="hidden sm:block text-[11px] text-slate-500 font-medium leading-tight mt-0.5 truncate">
                  Smart Paddle Stacking &amp; Partnership Mixing
                </p>
              </div>
            </Link>
          )}
        </div>

        {/* Caller-supplied actions */}
        <div
          className="animate-header-rise flex items-center gap-2 md:gap-4 shrink-0"
          style={{ animationDelay: '90ms' }}
        >
          {children}
        </div>
      </div>
    </header>
  );
}
