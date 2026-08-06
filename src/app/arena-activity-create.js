'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createActivity } from './actions';
import { wallClockToUtc } from '@/lib/activities';

/**
 * Manager form for a one-off session — a tournament, a holiday game, a make-up
 * night. The schedule materializer only ever produces rows on the club's
 * recurring play days, so this is the only way to add anything else.
 *
 * Collapsed to a button until opened, so the common case (just reading the
 * calendar) isn't buried under a form.
 */
export function ArenaActivityCreate({ arenaId, timezone }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('22:00');
  const [capacity, setCapacity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const close = () => {
    setOpen(false);
    setError('');
    setTitle('');
    setDate('');
    setCapacity('');
    setNotes('');
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!date) {
      setError('Pick a date.');
      return;
    }
    startTransition(async () => {
      try {
        // The typed wall time belongs to the ARENA's zone, not the browser's.
        // `new Date('YYYY-MM-DDTHH:MM')` resolves in the runtime's zone, so a
        // manager in a different timezone — travelling, or a remote organizer —
        // would store the wrong instant and then see it rendered back (via the
        // activity's timezone snapshot) hours away from what they entered.
        const startsAt = wallClockToUtc(date, start, timezone);
        const endsAt = wallClockToUtc(date, end, timezone);
        if (!startsAt || !endsAt) {
          setError('Enter a valid date and time.');
          return;
        }
        const result = await createActivity(arenaId, {
          title,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          capacity: capacity === '' ? null : Number(capacity),
          notes,
        });
        if (result?.error) {
          setError(result.error);
          return;
        }
        close();
        router.refresh();
      } catch {
        setError('Could not create the session. Please try again.');
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 sm:w-auto"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New one-off session
      </button>
    );
  }

  const inputClass =
    'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-base pointer-fine:text-sm text-slate-800 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';
  const labelClass = 'block text-[11px] font-extrabold uppercase tracking-widest text-slate-400';

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2 className="font-display text-base font-extrabold tracking-tight text-slate-900">
        New one-off session
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        For anything outside your recurring schedule. Regular play days are created automatically.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelClass}>Title (optional)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder="e.g. Club Championship"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={inputClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Capacity (optional)</span>
          <input
            type="number"
            min="1"
            max="500"
            inputMode="numeric"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="Uncapped"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>Starts</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required className={inputClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Ends</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required className={inputClass} />
        </label>

        <label className="block sm:col-span-2">
          <span className={labelClass}>Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Anything players should know"
            className={inputClass}
          />
        </label>
      </div>

      {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
        >
          Create session
        </button>
        <button
          type="button"
          onClick={close}
          disabled={isPending}
          className="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
