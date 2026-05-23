'use client';

import { useState } from 'react';
import { ScheduleFields } from './schedule-fields';

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

        <ScheduleFields
          days={days}
          setDays={setDays}
          start={start}
          setStart={setStart}
          end={end}
          setEnd={setEnd}
          timezone={timezone}
          setTimezone={setTimezone}
          datalistId="arena-timezones"
        />

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
