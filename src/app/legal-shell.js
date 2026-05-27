import Link from 'next/link';
import { BrandMark, Wordmark } from './site-header';

/**
 * Shared chrome for the static legal pages (/privacy, /data-deletion): the
 * brand bar linking home, a readable single-column body, and a slim footer.
 * One shell so the legal pages stay visually consistent with the app and with
 * each other.
 *
 * @param {object} props
 * @param {string} props.title - Page heading.
 * @param {string} [props.subtitle] - One-line supporting copy under the heading.
 * @param {string} [props.updated] - "Last updated" date string.
 * @param {React.ReactNode} props.children - Page body (use `LegalSection`).
 */
export function LegalShell({ title, subtitle, updated, children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col">
      <header className="sticky top-0 z-50">
        <div
          aria-hidden="true"
          className="h-0.5 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500"
        />
        <div className="border-b border-slate-200/70 bg-white/80 backdrop-blur-xl px-4 py-3 md:px-8 md:py-4">
          <Link href="/" className="group inline-flex items-center gap-3">
            <BrandMark className="h-9 w-9" />
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-14">
        <Link href="/" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          ← Back home
        </Link>
        <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 mt-4">
          {title}
        </h1>
        {subtitle && <p className="text-slate-500 mt-2 leading-relaxed">{subtitle}</p>}
        {updated && <p className="text-xs text-slate-400 mt-3">Last updated: {updated}</p>}
        <div className="mt-8 space-y-8">{children}</div>
      </main>

      <footer className="mt-auto border-t border-slate-200 bg-white">
        <div className="w-full max-w-3xl mx-auto px-4 md:px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <span>© {new Date().getFullYear()} DinkMaster</span>
          <span className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-slate-600">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-600">Terms</Link>
            <Link href="/data-deletion" className="hover:text-slate-600">Data deletion</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** A titled block within a legal page body. */
export function LegalSection({ heading, children }) {
  return (
    <section>
      <h2 className="font-display text-lg font-extrabold text-slate-900">{heading}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}
