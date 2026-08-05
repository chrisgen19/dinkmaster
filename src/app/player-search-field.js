'use client';

import { Search, X } from 'lucide-react';

/**
 * Name-search input for the player pick lists — shared by the skip-pick
 * replacement modal and the court-edit substitute picker so both stay in the
 * same visual family. Controlled: the parent owns the query and filters its
 * own list (via `filterPlayersByName` in @/lib/player-display).
 *
 * Escape behavior: with text in the field, Esc clears the query and STOPS
 * propagating — both host modals close on a window-level Escape listener,
 * and a typist clearing their search must not dismiss the whole modal. With
 * an empty field, Esc propagates so the modal closes as usual (matching
 * native `type="search"` semantics).
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(next: string) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 * @param {string} [props.className] - layout classes for the wrapper. Defaults
 *   to the stacked `mt-3` the pick lists use; the prep roster passes `flex-1`
 *   to sit the field inline in its footer bar.
 */
export function PlayerSearchField({
  value,
  onChange,
  placeholder = 'Search name…',
  disabled = false,
  className = 'mt-3',
}) {
  return (
    <div className={`relative ${className}`}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      />
      {/* text-base (16px) unless the pointer is fine: iOS Safari zooms the page
          in when you focus an input under 16px and never zooms back out. Keyed
          off pointer, not a width breakpoint — a phone in landscape is wider
          than `sm` but still needs 16px. */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Search players by name"
        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-base pointer-fine:text-sm font-medium text-slate-800 placeholder:text-slate-400 transition focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
