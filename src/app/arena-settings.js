'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateArenaGeneral, updateArenaSchedule, resetArena, transferOwnership, deleteArena } from './actions';

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

/** Friendly zone shortlist for the picker; any IANA zone is still accepted. */
const TIMEZONES = [
  'Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo',
  'Australia/Sydney', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC',
];

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold text-slate-800 focus:bg-white focus:border-emerald-500 outline-none transition';
const labelClass = 'block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5';

/** Section definitions for the left nav. All are visible to managers; the
 *  owner-only actions (transfer, delete) are gated inside Danger Zone. */
const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'danger', label: 'Danger Zone' },
];

/**
 * Owner/organizer settings page body for one arena. Left-nav sections; each
 * section owns its form state and calls a guarded server action. Danger Zone is
 * owner-only (also enforced server-side).
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {string} props.arenaName
 * @param {string} props.description
 * @param {{days:number[], start:string|null, end:string|null, timezone:string}} props.schedule
 * @param {boolean} props.isOwner
 * @param {string|null} props.viewerUserId
 * @param {Array<{userId:string, name:string, role:string}>} props.members
 */
export function ArenaSettings({ arenaId, arenaName, description, schedule, isOwner, viewerUserId, members }) {
  const [section, setSection] = useState('general');
  // Fall back to the first section if the active id ever disappears — e.g. a
  // successful ownership transfer re-renders this with a narrower set.
  const effectiveSection = SECTIONS.some((s) => s.id === section) ? section : SECTIONS[0].id;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page heading — mirrors the icon + title + back-link pattern used elsewhere. */}
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid place-items-center w-10 h-10 rounded-xl bg-emerald-600 shadow-sm shadow-emerald-600/30 shrink-0">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </span>
        <div className="min-w-0">
          <Link
            href={`/arena/${arenaId}`}
            className="text-[11px] text-slate-400 hover:text-emerald-600 font-semibold transition"
          >
            ← Back to {arenaName}
          </Link>
          <h1 className="font-display text-xl md:text-2xl font-extrabold tracking-tight text-slate-900 leading-none">
            Arena Settings
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">
        <nav className="flex md:flex-col gap-1.5 md:sticky md:top-24 md:self-start" aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const active = effectiveSection === s.id;
            const danger = s.id === 'danger';
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={active ? 'true' : undefined}
                className={`text-left px-3 py-2 rounded-xl text-sm font-bold transition-colors border ${
                  active
                    ? danger
                      ? 'bg-red-50 text-red-600 border-red-200/70'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
                    : `border-transparent hover:bg-slate-100 ${danger ? 'text-red-500 hover:text-red-600' : 'text-slate-500 hover:text-slate-800'}`
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {effectiveSection === 'general' && (
            <GeneralSection arenaId={arenaId} initialName={arenaName} initialDescription={description} />
          )}
          {effectiveSection === 'schedule' && <ScheduleSection arenaId={arenaId} schedule={schedule} />}
          {effectiveSection === 'danger' && (
            <DangerZone arenaId={arenaId} arenaName={arenaName} isOwner={isOwner} viewerUserId={viewerUserId} members={members} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Card wrapper shared by every section. */
function Card({ title, hint, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <h2 className="text-base font-extrabold text-slate-900">{title}</h2>
      {hint && <p className="text-xs text-slate-400 mt-1 mb-5">{hint}</p>}
      <div className={hint ? '' : 'mt-5'}>{children}</div>
    </div>
  );
}

/** Inline status line: red for errors, emerald for a saved confirmation. */
function Status({ error, saved }) {
  if (error) return <p className="text-xs font-semibold text-red-600 mt-3">{error}</p>;
  if (saved) return <p className="text-xs font-semibold text-emerald-600 mt-3">Saved.</p>;
  return null;
}

function GeneralSection({ arenaId, initialName, initialDescription }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError('');
    setSaved(false);
    startTransition(async () => {
      const result = await updateArenaGeneral(arenaId, { name, description });
      if (result?.error) return setError(result.error);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <Card title="General" hint="The arena's name and an optional description.">
      <div className="space-y-4 max-w-xl">
        <label className="block">
          <span className={labelClass}>Arena name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder="e.g. Tuesday & Thursday night doubles at the community center."
            className={`${inputClass} resize-none`}
          />
          <span className="block text-[10px] text-slate-400 mt-1">{description.length}/280</span>
        </label>
      </div>
      <Status error={error} saved={saved} />
      <div className="mt-5">
        <button
          onClick={save}
          disabled={isPending}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Card>
  );
}

function ScheduleSection({ arenaId, schedule }) {
  const router = useRouter();
  const [days, setDays] = useState(schedule.days ?? []);
  const [start, setStart] = useState(schedule.start ?? '');
  const [end, setEnd] = useState(schedule.end ?? '');
  const [timezone, setTimezone] = useState(schedule.timezone || 'Asia/Manila');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const toggleDay = (value) =>
    setDays((prev) => (prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]));

  const save = () => {
    setSaved(false);
    if (start && end && end <= start) return setError('End time must be after start time.');
    setError('');
    startTransition(async () => {
      const result = await updateArenaSchedule(arenaId, { days, start, end, timezone });
      if (result?.error) return setError(result.error);
      if (!result?.schedule) return setError('Failed to update schedule.');
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <Card title="Schedule" hint="Sets the timezone for the Mon–Sun Player of the Week window; days/times show for context.">
      <div className="space-y-5 max-w-xl">
        <div>
          <span className={labelClass}>Play days</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const on = days.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition ${
                    on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
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
            list="arena-settings-timezones"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. Asia/Manila"
            className={inputClass}
          />
          <datalist id="arena-settings-timezones">
            {TIMEZONES.map((tz) => <option key={tz} value={tz} />)}
          </datalist>
        </label>
      </div>
      <Status error={error} saved={saved} />
      <div className="mt-5">
        <button
          onClick={save}
          disabled={isPending}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </Card>
  );
}

function DangerZone({ arenaId, arenaName, isOwner, viewerUserId, members }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [deleteText, setDeleteText] = useState('');
  const [isPending, startTransition] = useTransition();

  // Members who could become owner (anyone but the current owner / viewer).
  const transferTargets = members.filter((m) => m.userId !== viewerUserId);

  const run = (fn, after) =>
    startTransition(async () => {
      setError('');
      const result = await fn();
      if (result?.error) return setError(result.error);
      after?.();
    });

  return (
    <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
      <h2 className="text-base font-extrabold text-red-600">Danger Zone</h2>
      <p className="text-xs text-slate-400 mt-1 mb-5">
        {isOwner ? 'Destructive actions. Some are irreversible.' : 'Destructive actions. Transfer and delete are owner-only.'}
      </p>

      <div className="space-y-6">
        {/* Reset — available to organizers too (resetArena is manager-gated). */}
        <div className={`flex flex-wrap items-center justify-between gap-3 ${isOwner ? 'border-b border-slate-100 pb-6' : ''}`}>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800">Reset arena</p>
            <p className="text-xs text-slate-500 mt-0.5">Clears match history, ratings, and live courts. Players are kept.</p>
          </div>
          {resetConfirm ? (
            <div className="flex gap-2">
              <button onClick={() => setResetConfirm(false)} className="px-3 py-2 text-xs font-bold text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition">Cancel</button>
              <button
                onClick={() => run(() => resetArena(arenaId), () => { setResetConfirm(false); router.refresh(); })}
                disabled={isPending}
                className="px-3 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50"
              >
                Confirm reset
              </button>
            </div>
          ) : (
            <button onClick={() => setResetConfirm(true)} className="px-3 py-2 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition">Reset</button>
          )}
        </div>

        {/* Transfer + delete are owner-only (the server actions enforce this too). */}
        {isOwner && (
          <>
            {/* Transfer ownership */}
            <div className="border-b border-slate-100 pb-6">
              <p className="text-sm font-bold text-slate-800">Transfer ownership</p>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">Hand the arena to another member; you stay on as an organizer.</p>
              {transferTargets.length === 0 ? (
                <p className="text-xs text-slate-400">No other members to transfer to yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className={`${inputClass} max-w-xs`}>
                    <option value="">Select a member…</option>
                    {transferTargets.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                  </select>
                  <button
                    onClick={() => run(() => transferOwnership(arenaId, transferTo), () => router.refresh())}
                    disabled={isPending || !transferTo}
                    className="px-3 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50"
                  >
                    Transfer
                  </button>
                </div>
              )}
            </div>

            {/* Delete */}
            <div>
              <p className="text-sm font-bold text-slate-800">Delete arena</p>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                Permanently deletes this arena and all its players, courts, matches, and history. This cannot be undone.
                Type <span className="font-bold text-slate-700">{arenaName}</span> to confirm.
              </p>
              <div className="flex flex-wrap gap-2">
                <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="Arena name" className={`${inputClass} max-w-xs`} />
                <button
                  onClick={() => run(() => deleteArena(arenaId), () => router.push('/'))}
                  disabled={isPending || deleteText !== arenaName}
                  className="px-3 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete arena
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {error && <p className="text-xs font-semibold text-red-600 mt-4">{error}</p>}
    </div>
  );
}
