'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateActivity } from './actions';

/**
 * Manager control for one activity's capacity, plus cancel/restore.
 *
 * Capacity is per-activity, not per-arena: the club's default seeds new nights
 * (Settings → Activities), but a one-off with fewer courts can be capped
 * tighter without disturbing the rest of the calendar.
 *
 * Lowering the cap never evicts anyone already confirmed — the server only
 * stops new confirmations — and raising it settles the waitlist immediately,
 * which is why every save ends in `router.refresh()` rather than a local patch.
 */
export function ArenaActivityCapacity({ arenaId, activity }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [capacity, setCapacity] = useState(activity.capacity == null ? '' : String(activity.capacity));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const cancelled = activity.status === 'CANCELLED';
  // A finished or running session's capacity is history; only a night that
  // hasn't started is still negotiable.
  const editable = activity.status === 'SCHEDULED' || activity.status === 'CANCELLED';

  const save = (patch, { onDone } = {}) => {
    setError('');
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await updateActivity(arenaId, activity.id, patch);
        if (result?.error) {
          setError(result.error);
          return;
        }
        setSaved(true);
        onDone?.();
        router.refresh();
      } catch {
        setError('Could not save. Please try again.');
      }
    });
  };

  if (!editable) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-display text-base font-extrabold tracking-tight text-slate-900 md:text-lg">
        Manage this session
      </h2>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
            Capacity
          </span>
          <input
            type="number"
            min="1"
            max="500"
            inputMode="numeric"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="Uncapped"
            // text-base below the fine-pointer breakpoint stops iOS zooming the
            // page on focus — the same rule the settings inputs use.
            className="mt-1 w-32 rounded-xl border border-slate-200 px-3 py-2 text-base pointer-fine:text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </label>
        <button
          type="button"
          onClick={() => save({ capacity: capacity === '' ? null : Number(capacity) })}
          disabled={isPending}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
        >
          Save
        </button>
        {saved && <span className="text-xs font-semibold text-emerald-700">Saved.</span>}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Leave blank for no limit. RSVPs past the cap join a waitlist and move up automatically when
        someone drops. Lowering it never removes anyone already confirmed.
      </p>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => save({ status: cancelled ? 'SCHEDULED' : 'CANCELLED' })}
          disabled={isPending}
          className={`rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${
            cancelled
              ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
              : 'text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50'
          }`}
        >
          {cancelled ? 'Restore this session' : 'Cancel this session'}
        </button>
        <p className="mt-2 text-xs text-slate-500">
          {cancelled
            ? 'Puts the session back on the calendar. Existing RSVPs are untouched.'
            : 'Keeps the session listed and greyed out rather than hiding it, so anyone who already RSVP’d can see it was called off.'}
        </p>
      </div>

      {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}
