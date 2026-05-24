'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateArenaGeneral, updateArenaSchedule, updateArenaMatchmaking, updateArenaMatchDefaults, updateArenaSessions, prepareNextSession, resetArena, transferOwnership, deleteArena } from './actions';
import { ScheduleFields } from './schedule-fields';
import { MAX_WAIT_THRESHOLD } from '@/lib/matchmaking';
import {
  MIN_TARGET_SCORE,
  MAX_TARGET_SCORE,
  MIN_LEADERBOARD_SIZE,
  MAX_LEADERBOARD_SIZE,
} from '@/lib/match-defaults';
import { slugFromSectionId } from './arena-settings-sections';

// --- Settings section icons (Lucide path data, inline) -----------------------
// Hand-inlined so we don't pull in lucide-react for six icons. Sizing comes
// from the parent via className so the chrome controls density.
const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};
const IconSettings = ({ className }) => (
  <svg className={className} {...ICON_PROPS}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconCalendar = ({ className }) => (
  <svg className={className} {...ICON_PROPS}>
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
  </svg>
);
const IconRefresh = ({ className }) => (
  <svg className={className} {...ICON_PROPS}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
const IconShuffle = ({ className }) => (
  <svg className={className} {...ICON_PROPS}>
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
    <path d="m18 2 4 4-4 4" />
    <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
    <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
    <path d="m18 14 4 4-4 4" />
  </svg>
);
const IconTarget = ({ className }) => (
  <svg className={className} {...ICON_PROPS}>
    <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
  </svg>
);
const IconAlert = ({ className }) => (
  <svg className={className} {...ICON_PROPS}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);
const IconChevronLeft = ({ className }) => (
  <svg className={className} {...ICON_PROPS}><path d="m15 18-6-6 6-6" /></svg>
);
const IconChevronRight = ({ className }) => (
  <svg className={className} {...ICON_PROPS}><path d="m9 18 6-6-6-6" /></svg>
);

const inputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-sm font-bold text-slate-800 focus:bg-white focus:border-emerald-500 outline-none transition';
const labelClass = 'block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5';

/**
 * A transient "Saved." flag that auto-clears after `ms`. The timer is tracked
 * in a ref and cleared on unmount and before re-arming, so navigating away or
 * a rapid second save can't fire a stray clear on the wrong render.
 * @returns {[boolean, () => void, () => void]} [saved, flash, clear]
 */
function useSavedFlag(ms = 2500) {
  const [saved, setSaved] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const clear = () => {
    clearTimeout(timer.current);
    setSaved(false);
  };
  const flash = () => {
    clearTimeout(timer.current);
    setSaved(true);
    timer.current = setTimeout(() => setSaved(false), ms);
  };
  return [saved, flash, clear];
}

/**
 * Section presentation metadata, in display order. Visible to all managers
 * (Danger Zone gates its owner-only actions inside). The slug ↔ id mapping
 * lives in `./arena-settings-sections` — a non-client module the server route
 * can import — so this list only carries the UI bits.
 */
const SECTIONS = [
  { id: 'general', label: 'General', hint: 'Name and description', Icon: IconSettings },
  { id: 'schedule', label: 'Schedule', hint: 'Play days, times, timezone', Icon: IconCalendar },
  { id: 'sessions', label: 'Sessions', hint: 'Auto-reset rack on play day', Icon: IconRefresh },
  { id: 'matchmaking', label: 'Matchmaking', hint: 'Wait thresholds for promotion', Icon: IconShuffle },
  { id: 'matchDefaults', label: 'Match Defaults', hint: 'Target score, mix, leaderboard', Icon: IconTarget },
  { id: 'danger', label: 'Danger Zone', hint: 'Reset, transfer, delete', Icon: IconAlert, danger: true },
];

/**
 * Render the body for a given section id. Centralised so the desktop shell
 * and the mobile section page can call the same render path.
 */
function SectionBody({ id, arenaId, arenaName, description, schedule, matchmaking, matchDefaults, sessions, isOwner, viewerUserId, members }) {
  switch (id) {
    case 'general':
      return <GeneralSection arenaId={arenaId} initialName={arenaName} initialDescription={description} />;
    case 'schedule':
      return <ScheduleSection arenaId={arenaId} schedule={schedule} />;
    case 'sessions':
      return <SessionsSection arenaId={arenaId} sessions={sessions} />;
    case 'matchmaking':
      return <MatchmakingSection arenaId={arenaId} matchmaking={matchmaking} />;
    case 'matchDefaults':
      return <MatchDefaultsSection arenaId={arenaId} defaults={matchDefaults} />;
    case 'danger':
      return <DangerZone arenaId={arenaId} arenaName={arenaName} isOwner={isOwner} viewerUserId={viewerUserId} members={members} />;
    default:
      return null;
  }
}

/**
 * Settings shell. `section` is the active section id (or null on the mobile
 * index). The same component renders three layouts: the mobile index list
 * (iOS-style row stack, when section is null on small screens), the mobile
 * section page (sticky back-tile + section body), and the desktop side-nav
 * grid (always shown on md+, with `section ?? 'general'` active).
 *
 * Section navigation is real URL navigation (`<Link>` to
 * `/arena/[id]/settings/<slug>`), so deep links and the browser back button
 * Just Work. The desktop tablist arrow-key handler still moves focus across
 * the links, matching the arena tab bar pattern.
 */
export function ArenaSettings({ section = null, arenaId, arenaName, description, schedule, matchmaking, matchDefaults, sessions, isOwner, viewerUserId, members }) {
  // Defensive: an unknown section id (legacy bookmark, typo) falls back to
  // 'general' on desktop and to the index on mobile.
  const validSection = section && SECTIONS.some((s) => s.id === section) ? section : null;
  const desktopSection = validSection ?? 'general';
  const activeMeta = SECTIONS.find((s) => s.id === desktopSection);
  const isIndex = !validSection;

  // On the mobile back chevron's destination:
  // - On a section page → up to the section list.
  // - On the index → back to the arena page itself.
  const mobileBackHref = isIndex ? `/arena/${arenaId}` : `/arena/${arenaId}/settings`;
  const mobileBackLabel = isIndex ? `Back to ${arenaName}` : 'Back to Settings';
  const mobileTitle = isIndex ? 'Settings' : activeMeta.label;
  const mobileDanger = !isIndex && activeMeta.danger;

  // Measure the SiteHeader (which is itself `sticky top-0 z-50`) so the mobile
  // back bar can stick directly below it, regardless of whether the header
  // wraps to a second row on narrow widths. Mirrors the pattern in arena.js
  // for the viewer notice. SSR safe: starts at 0 (so the bar isn't pushed
  // off-screen before the first client tick) and refines on mount.
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const header = document.querySelector('[data-site-header]');
    if (!header) return undefined;
    const measure = () => setHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="animate-fade-in">
      {/* Mobile-only chrome — chevron back + title/subtitle. Sticky directly
          below the SiteHeader (which is itself `sticky top-0 z-50`), using a
          measured offset so a wrapped two-row header on narrow widths doesn't
          eat the bar. z-40 keeps it under the header but above the page. */}
      <div
        style={{ top: headerHeight }}
        className="md:hidden sticky z-40 -mx-4 -mt-4 mb-4 flex items-center gap-3 border-b border-slate-200/70 bg-white/85 px-4 py-3 backdrop-blur-md"
      >
        <Link
          href={mobileBackHref}
          aria-label={mobileBackLabel}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95"
        >
          <IconChevronLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <p className={`truncate text-base font-bold leading-tight ${mobileDanger ? 'text-red-600' : 'text-slate-900'}`}>{mobileTitle}</p>
          <p className="truncate text-xs leading-tight text-slate-400">{arenaName}</p>
        </div>
      </div>

      {/* Desktop-only heading — icon chip + back link + h1. */}
      <div className="hidden md:flex items-center gap-3 mb-6">
        <span aria-hidden="true" className="grid place-items-center w-10 h-10 rounded-xl bg-emerald-600 shadow-sm shadow-emerald-600/30 shrink-0">
          <IconSettings className="w-5 h-5 text-white" />
        </span>
        <div className="min-w-0">
          <Link
            href={`/arena/${arenaId}`}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-600 font-semibold transition"
          >
            <IconChevronLeft className="h-3 w-3" />
            Back to {arenaName}
          </Link>
          <h1 className="font-display text-xl md:text-2xl font-extrabold tracking-tight text-slate-900 leading-none">
            Arena Settings
          </h1>
        </div>
      </div>

      {/* Body: one tree across breakpoints — collapses to a single column on
          mobile, becomes a 200px nav + content grid on md+. The mobile iOS
          list lives in the content column too (md:hidden), and the side-nav
          lives in its own column (hidden md:flex). SectionBody renders
          exactly once across breakpoints — `validSection` shows it on both;
          the index shows it as the desktop default ('general') only on md+,
          while mobile sees the list instead. This avoids the prior
          double-mount of the active section's form state on a section URL. */}
      <div className="md:grid md:grid-cols-[200px_1fr] md:gap-6">
        <nav className="hidden md:flex md:flex-col md:gap-1 md:sticky md:top-24 md:self-start" aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const slug = slugFromSectionId(s.id);
            if (!slug) return null; // drift-guard: skip if SECTIONS gains an id without a slug mapping
            const active = desktopSection === s.id;
            return (
              <Link
                key={s.id}
                href={`/arena/${arenaId}/settings/${slug}`}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? s.danger
                      ? 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200/70'
                      : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70'
                    : s.danger
                      ? 'text-red-500/80 hover:bg-red-50/50 hover:text-red-600'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                <s.Icon className={`h-4 w-4 shrink-0 ${active ? '' : 'opacity-70 group-hover:opacity-100'}`} />
                <span>{s.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">
          {/* Mobile-only iOS-style sections list (index page only). */}
          {isIndex && (
            <ul className="md:hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
              {SECTIONS.map((s) => {
                const slug = slugFromSectionId(s.id);
                if (!slug) return null; // drift-guard: same as desktop nav above
                return (
                <li key={s.id}>
                  <Link
                    href={`/arena/${arenaId}/settings/${slug}`}
                    className={`flex items-center gap-3 px-4 py-3.5 transition active:bg-slate-50 ${s.danger ? 'text-red-600 hover:bg-red-50/40' : 'text-slate-800 hover:bg-slate-50'}`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${s.danger ? 'bg-red-50 text-red-600 ring-red-100' : 'bg-emerald-50 text-emerald-700 ring-emerald-100'}`}>
                      <s.Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold leading-tight">{s.label}</span>
                      <span className={`block text-xs leading-tight ${s.danger ? 'text-red-500/80' : 'text-slate-400'}`}>{s.hint}</span>
                    </span>
                    <IconChevronRight className={`h-4 w-4 shrink-0 ${s.danger ? 'text-red-300' : 'text-slate-300'}`} />
                  </Link>
                </li>
                );
              })}
            </ul>
          )}

          {/* Section body — rendered ONCE across breakpoints. On a section
              URL it shows on both; on the index it's hidden on mobile (the
              list takes the column) and shows General by default on desktop. */}
          <div className={isIndex ? 'hidden md:block' : 'block'}>
            <SectionBody
              id={desktopSection}
              arenaId={arenaId}
              arenaName={arenaName}
              description={description}
              schedule={schedule}
              matchmaking={matchmaking}
              matchDefaults={matchDefaults}
              sessions={sessions}
              isOwner={isOwner}
              viewerUserId={viewerUserId}
              members={members}
            />
          </div>
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
  const [saved, flashSaved, clearSaved] = useSavedFlag();
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError('');
    clearSaved();
    startTransition(async () => {
      try {
        const result = await updateArenaGeneral(arenaId, { name, description });
        if (result?.error) return setError(result.error);
        flashSaved();
        router.refresh();
      } catch {
        setError('Failed to save changes. Please try again.');
      }
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
  const [saved, flashSaved, clearSaved] = useSavedFlag();
  const [isPending, startTransition] = useTransition();

  const save = () => {
    clearSaved();
    if (start && end && end <= start) return setError('End time must be after start time.');
    setError('');
    startTransition(async () => {
      try {
        const result = await updateArenaSchedule(arenaId, { days, start, end, timezone });
        if (result?.error) return setError(result.error);
        if (!result?.schedule) return setError('Failed to update schedule.');
        flashSaved();
        router.refresh();
      } catch {
        setError('Failed to save schedule. Please try again.');
      }
    });
  };

  return (
    <Card title="Schedule" hint="Sets the timezone for the Mon–Sun Player of the Week window; days/times show for context.">
      <div className="max-w-xl">
        <ScheduleFields
          days={days}
          setDays={setDays}
          start={start}
          setStart={setStart}
          end={end}
          setEnd={setEnd}
          timezone={timezone}
          setTimezone={setTimezone}
          datalistId="arena-settings-timezones"
        />
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

function SessionsSection({ arenaId, sessions }) {
  const router = useRouter();
  const [autoReset, setAutoReset] = useState(!!sessions?.autoResetOnSession);
  const [error, setError] = useState('');
  const [saved, flashSaved, clearSaved] = useSavedFlag();
  const [isPending, startTransition] = useTransition();
  // Format-on-mount so the timestamp uses the viewer's locale without
  // hydration mismatch (same trick the arena view uses).
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag for hydration-safe locale formatting
  useEffect(() => setMounted(true), []);

  const saveToggle = (nextValue) => {
    clearSaved();
    setError('');
    setAutoReset(nextValue); // optimistic
    startTransition(async () => {
      try {
        const result = await updateArenaSessions(arenaId, { autoResetOnSession: nextValue });
        if (result?.error) {
          setError(result.error);
          setAutoReset(!nextValue); // roll back the optimistic flip
          return;
        }
        flashSaved();
        router.refresh();
      } catch {
        setError('Failed to save. Please try again.');
        setAutoReset(!nextValue);
      }
    });
  };

  const manualReset = () => {
    if (!window.confirm(
      'Empty the rack and reset the partnership matrix now? Lifetime stats and match history are not touched.',
    )) {
      return;
    }
    clearSaved();
    setError('');
    startTransition(async () => {
      try {
        const result = await prepareNextSession(arenaId);
        if (result?.error) return setError(result.error);
        flashSaved();
        router.refresh();
      } catch {
        setError('Failed to reset the session. Please try again.');
      }
    });
  };

  const lastResetLabel = sessions?.lastSessionResetAt
    ? mounted
      ? new Date(sessions.lastSessionResetAt).toLocaleString()
      : sessions.lastSessionResetAt.replace('T', ' ').slice(0, 16)
    : 'Never';

  return (
    <Card
      title="Sessions"
      hint="Mark the boundary between play days. Each new session clears the rack and the partnership matrix while keeping lifetime stats, ratings, and match history."
    >
      <div className="space-y-5 max-w-xl">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoReset}
            onChange={(e) => saveToggle(e.target.checked)}
            disabled={isPending}
            className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
          />
          <span>
            <span className="block text-sm font-bold text-slate-800">Auto-empty rack at session start</span>
            <span className="block text-xs text-slate-400 mt-0.5">
              When on, the prep banner offers a one-tap “Prepare next session” that empties the rack and resets the partnership matrix. When off, the banner opens the roster to adjust by hand and the rack carries over — wipe manually with “Reset session now” on the banner or below. Existing arenas start off; new arenas start on.
            </span>
          </span>
        </label>

        <div className="bg-slate-50 border border-slate-200/70 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Last session reset</span>
            <span className="block text-sm font-bold text-slate-800 mt-0.5">{lastResetLabel}</span>
          </div>
          <button
            type="button"
            onClick={manualReset}
            disabled={isPending}
            className="shrink-0 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg transition disabled:opacity-50"
          >
            Reset session now
          </button>
        </div>
      </div>
      <Status error={error} saved={saved} />
    </Card>
  );
}

function MatchmakingSection({ arenaId, matchmaking }) {
  const router = useRouter();
  // Inputs are stored as strings so a user clearing the field mid-edit doesn't
  // immediately coerce to 0 and trigger a validation error. Parsing happens on save.
  const [starve, setStarve] = useState(String(matchmaking.starveThreshold));
  const [emergency, setEmergency] = useState(String(matchmaking.emergencyWait));
  const [error, setError] = useState('');
  const [saved, flashSaved, clearSaved] = useSavedFlag();
  const [isPending, startTransition] = useTransition();

  const save = () => {
    clearSaved();
    // Mirror the server validation so users see issues without a round-trip.
    const starveNum = Number(starve);
    const emergencyNum = Number(emergency);
    const invalid = (raw, n) =>
      raw === '' || !Number.isInteger(n) || n < 1 || n > MAX_WAIT_THRESHOLD;
    if (invalid(starve, starveNum)) {
      return setError(`Starve threshold must be a whole number between 1 and ${MAX_WAIT_THRESHOLD}.`);
    }
    if (invalid(emergency, emergencyNum)) {
      return setError(`Emergency wait must be a whole number between 1 and ${MAX_WAIT_THRESHOLD}.`);
    }
    if (emergencyNum < starveNum) return setError('Emergency wait must be at least the starve threshold.');
    setError('');
    startTransition(async () => {
      try {
        const result = await updateArenaMatchmaking(arenaId, { starveThreshold: starveNum, emergencyWait: emergencyNum });
        if (result?.error) return setError(result.error);
        flashSaved();
        router.refresh();
      } catch {
        setError('Failed to save matchmaking. Please try again.');
      }
    });
  };

  return (
    <Card title="Matchmaking" hint="How long a player waits before they're promoted in the auto-mix rotation. Lower values surface waiting players sooner.">
      <div className="space-y-4 max-w-xl">
        <label className="block">
          <span className={labelClass}>
            Starve threshold (rounds)
          </span>
          <input
            type="number"
            min={1}
            max={MAX_WAIT_THRESHOLD}
            value={starve}
            onChange={(e) => setStarve(e.target.value)}
            className={inputClass}
          />
          <span className="block text-[10px] text-slate-400 mt-1">
            After this many waiting rounds, the ⏳ badge appears and the player is always queued ahead of fresh players.
          </span>
        </label>

        <label className="block">
          <span className={labelClass}>
            Emergency wait (rounds)
          </span>
          <input
            type="number"
            min={1}
            max={MAX_WAIT_THRESHOLD}
            value={emergency}
            onChange={(e) => setEmergency(e.target.value)}
            className={inputClass}
          />
          <span className="block text-[10px] text-slate-400 mt-1">
            At this point the player is in the emergency band — strictly longest-waiting first. Must be at least the starve threshold.
          </span>
        </label>

        {starve !== '' && emergency !== '' && Number(starve) === Number(emergency) && (
          <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/70 rounded-lg px-3 py-2">
            Heads up: with both thresholds equal, the protected band is skipped — once a player&apos;s wait hits {starve}, they go straight to emergency (strict longest-first).
          </p>
        )}
      </div>
      <Status error={error} saved={saved} />
      <div className="mt-5">
        <button
          onClick={save}
          disabled={isPending}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save matchmaking'}
        </button>
      </div>
    </Card>
  );
}

function MatchDefaultsSection({ arenaId, defaults }) {
  const router = useRouter();
  // Inputs kept as strings so clearing the field doesn't snap to 0 — parse on
  // save. Same pattern as MatchmakingSection (PR #36 round 2).
  const [targetScore, setTargetScore] = useState(String(defaults.targetScore));
  const [autoMixDefault, setAutoMixDefault] = useState(defaults.autoMixDefault);
  const [leaderboardSize, setLeaderboardSize] = useState(String(defaults.leaderboardSize));
  const [countOffScheduleGames, setCountOffScheduleGames] = useState(defaults.countOffScheduleGames);
  const [error, setError] = useState('');
  const [saved, flashSaved, clearSaved] = useSavedFlag();
  const [isPending, startTransition] = useTransition();

  const save = () => {
    clearSaved();
    const target = Number(targetScore);
    const size = Number(leaderboardSize);
    // Mirror the server validation. An empty string parses to 0 which trips
    // the range check with a confusing "must be between …" message; check the
    // raw value first so we can surface a clearer empty-field error.
    const invalid = (raw, n, min, max) =>
      raw === '' || !Number.isInteger(n) || n < min || n > max;
    if (invalid(targetScore, target, MIN_TARGET_SCORE, MAX_TARGET_SCORE)) {
      return setError(`Target score must be a whole number between ${MIN_TARGET_SCORE} and ${MAX_TARGET_SCORE}.`);
    }
    if (invalid(leaderboardSize, size, MIN_LEADERBOARD_SIZE, MAX_LEADERBOARD_SIZE)) {
      return setError(`Leaderboard size must be a whole number between ${MIN_LEADERBOARD_SIZE} and ${MAX_LEADERBOARD_SIZE}.`);
    }
    setError('');
    startTransition(async () => {
      try {
        const result = await updateArenaMatchDefaults(arenaId, {
          targetScore: target,
          autoMixDefault,
          leaderboardSize: size,
          countOffScheduleGames,
        });
        if (result?.error) return setError(result.error);
        flashSaved();
        router.refresh();
      } catch {
        setError('Failed to save match defaults. Please try again.');
      }
    });
  };

  return (
    <Card title="Match Defaults" hint="Seed values for new games and the weekly leaderboard. Per-game inputs (e.g. the score) can still be edited at the moment of recording.">
      <div className="space-y-4 max-w-xl">
        <label className="block">
          <span className={labelClass}>Target score</span>
          <input
            type="number"
            min={MIN_TARGET_SCORE}
            max={MAX_TARGET_SCORE}
            value={targetScore}
            onChange={(e) => setTargetScore(e.target.value)}
            className={inputClass}
          />
          <span className="block text-[10px] text-slate-400 mt-1">
            Pre-fills both score fields when finishing a match (typically 11).
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoMixDefault}
            onChange={(e) => setAutoMixDefault(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-emerald-600"
          />
          <span>
            <span className="block text-sm font-bold text-slate-800">Auto-mix the rack by default</span>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              Initial state of the Auto-Mix toggle when an arena loads. Managers can still flip it per finish.
            </span>
          </span>
        </label>

        <label className="block">
          <span className={labelClass}>Leaderboard size (top N)</span>
          <input
            type="number"
            min={MIN_LEADERBOARD_SIZE}
            max={MAX_LEADERBOARD_SIZE}
            value={leaderboardSize}
            onChange={(e) => setLeaderboardSize(e.target.value)}
            className={inputClass}
          />
          <span className="block text-[10px] text-slate-400 mt-1">
            How many players the <strong>This Week</strong> board surfaces. The viewer&apos;s full rank is unaffected.
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={countOffScheduleGames}
            onChange={(e) => setCountOffScheduleGames(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-emerald-600"
          />
          <span>
            <span className="block text-sm font-bold text-slate-800">Count off-schedule games</span>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              When on (default), every game in the week counts toward the leaderboard. Turn off to only count games played on the schedule&apos;s days — <strong>only takes effect once the schedule has play days set</strong>; with no days configured the leaderboard treats every day as scheduled.
            </span>
          </span>
        </label>
      </div>
      <Status error={error} saved={saved} />
      <div className="mt-5">
        <button
          onClick={save}
          disabled={isPending}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save match defaults'}
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
  const [transferConfirm, setTransferConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [isPending, startTransition] = useTransition();

  // Members who could become owner (anyone but the current owner / viewer).
  const transferTargets = members.filter((m) => m.userId !== viewerUserId);
  const transferName = transferTargets.find((m) => m.userId === transferTo)?.name ?? 'this member';

  const run = (fn, after) =>
    startTransition(async () => {
      setError('');
      try {
        const result = await fn();
        if (result?.error) return setError(result.error);
        after?.();
      } catch {
        setError('Something went wrong. Please try again.');
      }
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
              ) : transferConfirm ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">
                    Transfer ownership to <span className="font-bold">{transferName}</span>? You&apos;ll become an organizer. This can only be undone by another transfer.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setTransferConfirm(false)} className="px-3 py-2 text-xs font-bold text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition">Cancel</button>
                    <button
                      onClick={() => run(() => transferOwnership(arenaId, transferTo), () => router.refresh())}
                      disabled={isPending}
                      className="px-3 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition disabled:opacity-50"
                    >
                      Confirm transfer
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className={`${inputClass} max-w-xs`}>
                    <option value="">Select a member…</option>
                    {transferTargets.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                  </select>
                  <button
                    onClick={() => setTransferConfirm(true)}
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
