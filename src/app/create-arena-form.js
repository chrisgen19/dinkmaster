'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createArena } from './actions';
import { ScheduleFields } from './schedule-fields';

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 outline-none transition';
const labelClass =
  'block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5';

/**
 * Full arena-creation form: name (required), description, and an optional
 * recurring schedule. Submits everything in a single `createArena` call and
 * redirects to the new arena on success.
 */
export function CreateArenaForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [days, setDays] = useState([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [timezone, setTimezone] = useState('Asia/Manila');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter an arena name.');
      return;
    }
    setError('');
    startTransition(async () => {
      const result = await createArena({
        name,
        description,
        scheduleDays: days,
        scheduleStart: start,
        scheduleEnd: end,
        timezone,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/arena/${result.arena.id}`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-5">
        <label className="block">
          <span className={labelClass}>Arena name</span>
          <input
            type="text"
            autoFocus
            placeholder="e.g. Saturday Open Play"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>Description (optional)</span>
          <textarea
            placeholder="One short line about this arena — who it's for, what to expect."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={280}
            rows={3}
            className={`${inputClass} resize-none leading-relaxed`}
          />
          <p className="text-[10px] text-slate-400 mt-1.5">
            {description.length}/280
          </p>
        </label>
      </div>

      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-display text-sm font-extrabold text-slate-900">
            Recurring schedule
          </h3>
          <span className="text-[10px] text-slate-400 font-medium">Optional — you can set this later</span>
        </div>
        <ScheduleFields
          days={days}
          setDays={setDays}
          start={start}
          setStart={setStart}
          end={end}
          setEnd={setEnd}
          timezone={timezone}
          setTimezone={setTimezone}
          datalistId="create-arena-timezones"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2">
        <Link
          href="/arenas"
          className="inline-flex justify-center items-center text-sm font-bold text-slate-500 hover:text-slate-700 px-5 py-2.5 rounded-xl transition"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex justify-center items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold px-6 py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/35 transition"
        >
          {isPending ? 'Creating…' : 'Create arena'}
        </button>
      </div>
    </form>
  );
}
