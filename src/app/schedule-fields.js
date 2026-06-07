'use client';

import { WEEKDAYS } from '@/lib/schedule-format';

// Re-exported so the editor's weekday options share the directory/hero's
// single source of truth in @/lib/schedule-format.
export { WEEKDAYS };

/** Friendly zone shortlist for the picker; any IANA zone is still accepted. */
export const TIMEZONES = [
  'Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo',
  'Australia/Sydney', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC',
];

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold text-slate-800 focus:bg-white focus:border-emerald-500 outline-none transition';
const labelClass = 'block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5';

/**
 * Controlled play-schedule fields (days / start / end / timezone), shared by the
 * arena "Edit schedule" modal and the settings Schedule section so the two can't
 * drift. Purely presentational — the parent owns the state.
 *
 * @param {object} props
 * @param {number[]} props.days - Selected weekday values.
 * @param {(days: number[]) => void} props.setDays
 * @param {string} props.start - "HH:MM" or "".
 * @param {(v: string) => void} props.setStart
 * @param {string} props.end - "HH:MM" or "".
 * @param {(v: string) => void} props.setEnd
 * @param {string} props.timezone - IANA zone.
 * @param {(v: string) => void} props.setTimezone
 * @param {string} [props.datalistId] - Unique id for the timezone datalist.
 */
export function ScheduleFields({ days, setDays, start, setStart, end, setEnd, timezone, setTimezone, datalistId = 'schedule-timezones' }) {
  const toggleDay = (value) =>
    setDays((prev) => (prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]));

  return (
    <div className="space-y-5">
      <div>
        <span className={labelClass}>Play days</span>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => {
            const on = days.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d.value)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition ${
                  on ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
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
          <span className={labelClass}>Start</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>End</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Timezone</span>
        <input
          list={datalistId}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="e.g. Asia/Manila"
          className={inputClass}
        />
        <datalist id={datalistId}>
          {TIMEZONES.map((tz) => <option key={tz} value={tz} />)}
        </datalist>
      </label>
    </div>
  );
}
