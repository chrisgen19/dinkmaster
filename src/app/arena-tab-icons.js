/**
 * Shared tab glyphs for the arena page. Mobile (`arena-mobile-nav`) and the
 * desktop tab bar (inline in `arena.js`) both import from here so the icon
 * language stays in sync across breakpoints.
 *
 * Inline SVGs keep the bundle slim and the stroke weight consistent with the
 * rest of the app chrome — no icon library dependency for these six glyphs.
 */

const TAB_ICONS = {
  courts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 12h18M12 4v16" />
    </svg>
  ),
  thisweek: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.39 6.96H22l-5.8 4.21L18.59 22 12 17.77 5.41 22l2.39-8.83L2 8.96h7.61z" />
    </svg>
  ),
  stats: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 3v18" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  members: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  mystats: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
};

/** Render the glyph for a given tab id (no-op when unknown). */
export function TabIcon({ id, className }) {
  const icon = TAB_ICONS[id];
  if (!icon) return null;
  return <span className={className} aria-hidden="true">{icon}</span>;
}

/** Pill badge used on tab triggers (e.g. members tab pending count). */
export function TabBadge({ value, active }) {
  if (value == null) return null;
  return (
    <span
      className={`shrink-0 text-[10px] font-black rounded-full px-1.5 py-0.5 leading-none ${
        active ? 'bg-emerald-400 text-slate-900' : 'bg-amber-500 text-white'
      }`}
    >
      {value}
    </span>
  );
}
