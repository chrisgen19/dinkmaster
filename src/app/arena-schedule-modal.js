'use client';

import { useState } from 'react';

/** Weekday options, Monday-first; `value` matches JS `Date.getDay()`. */
const WEEKDAYS = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
];

// A short, friendly set of zones for the picker; any IANA zone is still
// accepted by the server, but these cover the common cases without a library.
const TIMEZONES = [
  'Asia/Manila',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Sydney',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'UTC',
];

/**
 * Owner-only editor for an arena's recurring play schedule. Local form state
 * only; persistence is the parent's `onSave({ days, start, end, timezone })`.
 *
 * @param {{
 *   schedule: {days:number[], start:string|null, end:string|null, timezone:string},
 *   onSave: (next:{days:number[], start:string, end:string, timezone:string}) => void,
 *   onClose: () => void,
 *   isPending?: boolean,
 *   error?: string,
 * }} props
 */
export function ArenaScheduleModal({ schedule, onSave, onClose, isPending = false, error: externalError = '' }) {
  const [days, setDays] = useState(schedule.days ?? []);
  const [start, setStart] = useState(schedule.start ?? '');
  const [end, setEnd] = useState(schedule.end ?? '');
  const [timezone, setTimezone] = useState(schedule.timezone || 'Asia/Manila');
  const [localError, setLocalError] = useState('');

  // Either the parent's save failure or our client-side pre-save check.
  const error = externalError || localError;

  const toggleDay = (value) =>
    setDays((prev) => (prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]));

  const handleSave = () => {
    // Mirror the server validation so the user gets instant feedback.
    if (start && end && end <= start) {
      setLocalError('End time must be after start time.');
      return;
    }
    setLocalError('');
    onSave({ days, start, end, timezone });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="arena-schedule-title"
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-2xl animate-scale-up"
      >
        <div className="mb-5">
          <h3 id="arena-schedule-title" className="text-base font-extrabold text-slate-900">
            Edit Play Schedule
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Used as context on the leaderboard. The timezone sets the Mon–Sun
            week boundary; every game in that week counts.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Play days
            </span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const on = days.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition ${
                      on
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">Leave all unset to count every day.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Start
              </span>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold text-slate-800 focus:bg-white focus:border-emerald-500 outline-none transition"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                End
              </span>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold text-slate-800 focus:bg-white focus:border-emerald-500 outline-none transition"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Timezone
            </span>
            <input
              list="arena-timezones"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="e.g. Asia/Manila"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold text-slate-800 focus:bg-white focus:border-emerald-500 outline-none transition"
            />
            <datalist id="arena-timezones">
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
        </div>

        {error && <p className="text-xs font-semibold text-red-600 mt-4">{error}</p>}

        <div className="flex space-x-3 justify-end mt-6">
          <button
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
