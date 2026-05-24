'use client';

import React, { useState, useEffect, useMemo, useRef, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addPlayer,
  removePlayer,
  shuffleQueue,
  fillCourt,
  endMatch,
  addCourt,
  removeCourt,
  requestToJoin,
  updateArenaSchedule,
} from './actions';
import { DEFAULT_STARVE_THRESHOLD, DEFAULT_EMERGENCY_WAIT } from '@/lib/matchmaking';
import { DEFAULT_TARGET_SCORE, DEFAULT_AUTO_MIX, DEFAULT_COUNT_OFF_SCHEDULE } from '@/lib/match-defaults';
import { eloToDupr } from '@/lib/rating';
import { computeWeeklyLeaderboard, DEFAULT_LEADERBOARD_SIZE } from '@/lib/leaderboard';
import { stepScore, validateMatchScore } from '@/lib/scoring';
import { formatShortName } from '@/lib/player-display';
import { AuthStatus } from './auth-status';
import { SiteHeader } from './site-header';
import { ArenaMembers } from './arena-members';
import { ArenaNavDrawer } from './arena-nav-drawer';
import { ArenaScheduleModal } from './arena-schedule-modal';
import { ArenaCourtsPanel } from './arena-courts-panel';

/** Display name: "First Last", or just "First" when no last name is set. */
const fullName = (p) => (p?.lastName ? `${p.firstName} ${p.lastName}` : p?.firstName ?? 'Unknown');

/** Weekday options for the schedule editor, Monday-first; value = JS getDay(). */
const WEEKDAYS = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
];
/** Medal accent per podium rank (1–3); the rest fall through to slate. */
const RANK_STYLES = {
  1: 'bg-amber-100 text-amber-700 ring-amber-200',
  2: 'bg-slate-200 text-slate-600 ring-slate-300',
  3: 'bg-orange-100 text-orange-700 ring-orange-200',
};

/** "18:30" → "6:30 PM"; null/empty → null. */
const formatClock = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

/** One-line schedule summary, e.g. "Mon, Wed, Fri · 6:00 PM–10:00 PM (Asia/Manila)". */
const describeSchedule = ({ days = [], start, end, timezone } = {}) => {
  const ordered = WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.short);
  const dayPart = ordered.length ? ordered.join(', ') : 'Every day';
  const startC = formatClock(start);
  const endC = formatClock(end);
  const timePart = startC && endC ? ` · ${startC}–${endC}` : '';
  return `${dayPart}${timePart}${timezone ? ` (${timezone})` : ''}`;
};

/** Accept only digits or an empty string into a controlled score input. */
const onScoreChange = (setter, raw) => {
  if (raw === '' || /^\d+$/.test(raw)) setter(raw);
};

const playPaddleSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.12);

    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'sine';
    clickOsc.frequency.setValueAtTime(1200, ctx.currentTime);
    clickOsc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.04);

    clickGain.gain.setValueAtTime(0.15, ctx.currentTime);
    clickGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, ctx.currentTime);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);

    osc.start();
    clickOsc.start();

    osc.stop(ctx.currentTime + 0.13);
    clickOsc.stop(ctx.currentTime + 0.05);
  } catch (e) {
    // Audio not supported or not yet allowed by the browser.
  }
};

export default function Arena({
  initialState,
  arenaId,
  arenaName,
  description = '',
  schedule: initialSchedule = { days: [], start: null, end: null, timezone: 'Asia/Manila' },
  matchmaking: matchmakingProp = { starveThreshold: DEFAULT_STARVE_THRESHOLD, emergencyWait: DEFAULT_EMERGENCY_WAIT },
  matchDefaults = {
    targetScore: DEFAULT_TARGET_SCORE,
    autoMixDefault: DEFAULT_AUTO_MIX,
    leaderboardSize: DEFAULT_LEADERBOARD_SIZE,
    countOffScheduleGames: DEFAULT_COUNT_OFF_SCHEDULE,
  },
  canManage,
  viewerRole,
  viewerUserId,
  isAuthenticated,
  members,
  pendingRequests = [],
  viewerPending = false,
  pendingLinkRequests = [],
  viewerLinkContext = null,
}) {
  const router = useRouter();
  const [players, setPlayers] = useState(initialState.players);
  const [queue, setQueue] = useState(initialState.queue);
  const [courts, setCourts] = useState(initialState.courts);
  const [matchHistory, setMatchHistory] = useState(initialState.matchHistory);
  const [history, setHistory] = useState(initialState.history);
  // Resync local rack state when the server refetches (e.g. after a child
  // component's `router.refresh()`). Without this, actions that only refresh
  // — link approvals, member removals — leave the rack UI showing the pre-
  // refresh players/queue/courts, while tabs reading the new props update.
  // Setting state during render with a sentinel is the React-recommended
  // pattern for prop-driven state resets (`useEffect` would lint as
  // `react-hooks/set-state-in-effect`).
  const [lastSyncedState, setLastSyncedState] = useState(initialState);
  if (initialState !== lastSyncedState) {
    setLastSyncedState(initialState);
    setPlayers(initialState.players);
    setQueue(initialState.queue);
    setCourts(initialState.courts);
    setMatchHistory(initialState.matchHistory);
    setHistory(initialState.history);
  }

  const [isPending, startTransition] = useTransition();

  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [selectedCourtForScore, setSelectedCourtForScore] = useState(null);
  // Score inputs are stored as strings so the field can be empty (placeholder-only)
  // until the organizer types or steps a value. Parsed to numbers on save.
  const [team1Score, setTeam1Score] = useState('');
  const [team2Score, setTeam2Score] = useState('');

  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTab, setActiveTab] = useState('courts');

  const [autoMix, setAutoMix] = useState(matchDefaults.autoMixDefault);
  const [notification, setNotification] = useState('');

  // Arena schedule (powers the "This Week" leaderboard window) + its editor.
  const [schedule, setSchedule] = useState(initialSchedule);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  // Schedule-save failures surface in the modal (not the page-level banner),
  // so the user sees the error against the form they were editing.
  const [scheduleError, setScheduleError] = useState('');

  // Locale-format timestamps only after mount: the server renders in its own
  // locale/timezone, so formatting during SSR/hydration would mismatch. Until
  // mounted we show the deterministic ISO value (same on server and client).
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag for hydration-safe locale formatting
  useEffect(() => setMounted(true), []);
  const formatTimestamp = (iso) =>
    mounted ? new Date(iso).toLocaleString() : iso.replace('T', ' ').slice(0, 16);

  // Escape closes the score-entry modal — conventional keyboard partner to the
  // backdrop click and the ✕ button. Listener is only attached while the modal
  // is open so we never see a stale court id on close.
  useEffect(() => {
    if (!scoreModalOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setScoreModalOpen(false);
        setSelectedCourtForScore(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scoreModalOpen]);

  // The viewer's own linked player in this arena (null for guests / non-players).
  const myPlayer = viewerUserId
    ? players.find((p) => p.userId === viewerUserId) ?? null
    : null;
  const myQueueIndex = myPlayer ? queue.indexOf(myPlayer.id) : -1;
  // Courts with a match in progress — surfaced in the header stats and the
  // tab badge, so compute it once.
  const liveCourtCount = courts.filter((c) => c.status === 'playing').length;
  // The viewer's finished matches, with their team's score and the outcome.
  const myMatches = myPlayer
    ? matchHistory.flatMap((m) => {
        const inTeam1 = m.team1.some((p) => p.id === myPlayer.id);
        const inTeam2 = m.team2.some((p) => p.id === myPlayer.id);
        if (!inTeam1 && !inTeam2) return [];
        const scoreFor = inTeam1 ? m.score1 : m.score2;
        const scoreAgainst = inTeam1 ? m.score2 : m.score1;
        const partners = (inTeam1 ? m.team1 : m.team2).filter((p) => p.id !== myPlayer.id);
        return [{ ...m, scoreFor, scoreAgainst, won: scoreFor > scoreAgainst, partners }];
      })
    : [];

  // Player of the Week — recomputed from match history (refreshed after every
  // finish), the schedule, and the arena's match defaults, so the board updates
  // live as scores land. Same pure ranking the /profile read uses, so client
  // and server never diverge.
  const leaderboard = useMemo(
    () => computeWeeklyLeaderboard({
      matches: matchHistory,
      schedule,
      countOffSchedule: matchDefaults.countOffScheduleGames,
      limit: matchDefaults.leaderboardSize,
    }),
    [matchHistory, schedule, matchDefaults.countOffScheduleGames, matchDefaults.leaderboardSize],
  );

  // Apply a server action result to local state (state, error, notification).
  const applyResult = (result) => {
    if (!result) return;
    setErrorMsg(result.error || '');
    if (result.notification) {
      setNotification(result.notification);
      setTimeout(() => setNotification(''), 5000);
    }
    if (result.state) {
      setPlayers(result.state.players);
      setQueue(result.state.queue);
      setCourts(result.state.courts);
      setMatchHistory(result.state.matchHistory);
      setHistory(result.state.history);
    }
  };

  // Run a server action inside a transition and reconcile the returned state.
  const run = (action, { sound = true } = {}) => {
    startTransition(async () => {
      const result = await action();
      applyResult(result);
      if (sound) playPaddleSound();
    });
  };

  const getPartnershipCount = (p1, p2) => {
    if (!history[p1]) return 0;
    return history[p1][p2] || 0;
  };

  const handleShuffleQueue = () => {
    if (!canManage || queue.length < 2) return;
    run(() => shuffleQueue(arenaId));
  };

  const handleFillCourt = (courtId) => {
    if (!canManage) return;
    run(() => fillCourt(arenaId, courtId));
  };

  const handleAddPlayer = (e) => {
    e.preventDefault();
    if (!canManage || !newFirstName.trim()) return;
    const first = newFirstName;
    const last = newLastName;
    setNewFirstName('');
    setNewLastName('');
    run(() => addPlayer(arenaId, first, last));
  };

  const handleRemovePlayer = (id) => {
    if (!canManage) return;
    run(() => removePlayer(arenaId, id));
  };

  const handleTriggerScoreModal = (court) => {
    if (!canManage) return;
    setSelectedCourtForScore(court);
    setTeam1Score('');
    setTeam2Score('');
    setScoreModalOpen(true);
  };

  const handleEndMatchWithScore = (courtId, score1, score2) => {
    setScoreModalOpen(false);
    setSelectedCourtForScore(null);
    run(() => endMatch(arenaId, courtId, score1, score2, autoMix));
  };

  const handleAddCourt = () => {
    if (!canManage) return;
    run(() => addCourt(arenaId));
  };

  const handleRemoveCourt = (id) => {
    if (!canManage) return;
    run(() => removeCourt(arenaId, id));
  };

  const handleSaveSchedule = (next) => {
    startTransition(async () => {
      try {
        const result = await updateArenaSchedule(arenaId, next);
        if (result?.error) {
          setScheduleError(result.error);
          return;
        }
        if (!result?.schedule) {
          setScheduleError('Failed to update schedule.');
          return;
        }
        setScheduleError('');
        setSchedule(result.schedule);
        setScheduleModalOpen(false);
      } catch {
        setScheduleError('Failed to update schedule. Please try again.');
      }
    });
  };

  // Tab definitions — shared by the desktop tab bar and the mobile bottom sheet.
  const navTabs = [
    { id: 'courts', label: 'Active Courts' },
    { id: 'thisweek', label: 'This Week' },
    { id: 'stats', label: 'Partnership Matrix' },
    { id: 'history', label: 'Match Log' },
    {
      id: 'members',
      label: 'Members',
      // Surface anything that needs the viewer's attention: pending join
      // requests and pending link requests for managers, and the viewer's own
      // pending link request for non-managers (managers' own request is
      // already counted in `pendingLinkRequests`, so don't double-add it).
      badge:
        (canManage
          ? pendingRequests.length + pendingLinkRequests.length
          : viewerLinkContext?.pendingRequest
            ? 1
            : 0) || null,
    },
    ...(myPlayer ? [{ id: 'mystats', label: 'My Stats' }] : []),
  ];
  // The "My Stats" tab is conditional on myPlayer. If it disappears (e.g. after
  // a refresh) while selected, fall back to the courts tab so content isn't
  // blank — corrected during render, React's recommended pattern over an effect.
  if (!navTabs.some((t) => t.id === activeTab)) {
    setActiveTab('courts');
  }

  const activeTabLabel = navTabs.find((t) => t.id === activeTab)?.label ?? 'Active Courts';

  // Anchor placed just above the tab content so we can scroll to it on mobile.
  const contentAnchorRef = useRef(null);
  // Refs to each desktop tab button, keyed by tab id — used to move DOM focus
  // when navigating the tablist with the arrow keys (ARIA roving tabindex).
  const tabRefs = useRef({});
  // Pending scroll-to-content timer, so a rapid re-select can cancel a stale one.
  const scrollTimerRef = useRef(null);

  // Switch tab, then scroll the page down to the freshly rendered content. The
  // delay lets the mobile drawer finish collapsing and the new tab content
  // mount before we scroll.
  const handleSelectTab = (tabId) => {
    setActiveTab(tabId);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      contentAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 320);
  };

  // Cancel any pending scroll timer when the component unmounts.
  useEffect(() => () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
  }, []);

  // Keyboard navigation for the desktop tablist (ARIA tabs pattern): Left/Right
  // move between tabs and Home/End jump to the ends, wrapping around. Selection
  // follows focus, and we move DOM focus to the newly selected tab.
  const handleTabKeyDown = (e) => {
    const idx = navTabs.findIndex((t) => t.id === activeTab);
    if (idx === -1) return;
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % navTabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + navTabs.length) % navTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = navTabs.length - 1;
    else return;
    e.preventDefault();
    const nextId = navTabs[next].id;
    setActiveTab(nextId);
    tabRefs.current[nextId]?.focus();
  };

  // Request to join; an owner/organizer must approve before membership is granted.
  const handleRequestJoin = () => {
    startTransition(async () => {
      const result = await requestToJoin(arenaId);
      if (result?.error) {
        setErrorMsg(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-emerald-100 selection:text-slate-900">

      <SiteHeader variant="arena" arenaName={arenaName} arenaSubtitle={description}>
        {/* Desktop / tablet: stat chips */}
        <div className="hidden md:flex items-stretch gap-2 text-xs">
          <div className="bg-slate-50 px-3.5 py-1.5 rounded-xl border border-slate-200/70">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wide">Players</span>
            <span className="text-sm font-bold text-slate-800">{players.length}</span>
          </div>
          <div className="bg-slate-50 px-3.5 py-1.5 rounded-xl border border-slate-200/70">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wide">In queue</span>
            <span className="text-sm font-bold text-emerald-600">{queue.length}</span>
          </div>
          <div className="bg-slate-50 px-3.5 py-1.5 rounded-xl border border-slate-200/70">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-wide">Live</span>
            <span className="text-sm font-bold text-sky-600">
              {liveCourtCount}
            </span>
          </div>
        </div>

        {/* Mobile: compact inline stat pills */}
        <div className="flex md:hidden gap-1.5 text-[11px]">
          <span className="bg-slate-100 border border-slate-200/60 rounded-lg px-2 py-1 font-bold text-slate-700">
            {players.length}<span className="text-slate-400 font-semibold"> players</span>
          </span>
          <span className="bg-slate-100 border border-slate-200/60 rounded-lg px-2 py-1 font-bold text-emerald-600">
            {queue.length}<span className="text-slate-400 font-semibold"> queued</span>
          </span>
          <span className="bg-slate-100 border border-slate-200/60 rounded-lg px-2 py-1 font-bold text-sky-600">
            {liveCourtCount}<span className="text-slate-400 font-semibold"> live</span>
          </span>
        </div>

        {canManage && (
          <Link
            href={`/arena/${arenaId}/settings`}
            className="inline-flex items-center gap-1.5 text-xs bg-slate-50 hover:bg-slate-100 text-slate-700 px-3 py-2 md:px-3.5 md:py-2.5 rounded-xl border border-slate-200/70 transition-all font-semibold"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </Link>
        )}

        <AuthStatus />
      </SiteHeader>

      {!canManage && (
        <div className="mx-4 md:mx-8 mt-4 p-3 bg-slate-100 border border-slate-200 text-slate-600 rounded-xl text-xs font-medium flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span>👁️</span>
            <span>
              {viewerRole
                ? "You're a member of this arena. An owner can promote you to organizer to manage it."
                : "You're viewing this arena. Only its owner and organizers can manage it."}
            </span>
          </span>
          {isAuthenticated && !viewerRole && viewerPending && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 font-bold px-3 py-1.5 rounded-lg shrink-0">
              Request pending approval
            </span>
          )}
          {isAuthenticated && !viewerRole && !viewerPending && (
            <button
              onClick={handleRequestJoin}
              disabled={isPending}
              className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg transition shrink-0"
            >
              Request to join
            </button>
          )}
          {!isAuthenticated && (
            <Link href="/login" className="text-xs text-emerald-700 font-bold hover:underline shrink-0">
              Sign in to join
            </Link>
          )}
        </div>
      )}

      {/* Dynamic Mixing Notification Toast Banner */}
      {notification && (
        <div className="mx-4 md:mx-8 mt-4 p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-medium flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center space-x-2">
            <span>✨</span>
            <span>{notification}</span>
          </div>
          <button onClick={() => setNotification('')} className="text-emerald-700 hover:text-emerald-900 font-bold ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Main Grid Workspace */}
      <main className="flex-1 p-4 pb-28 md:p-6 md:pb-6 lg:p-8 lg:pb-8 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* Left Column: Player Administration & Paddle Queue */}
        <div className="lg:col-span-5 space-y-6">

          {/* Quick Add Section */}
          <section className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
                Register Players
              </h3>
              <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
                One player at a time
              </span>
            </div>

            <form onSubmit={handleAddPlayer} className="flex gap-2">
              <input
                type="text"
                placeholder={canManage ? 'First name' : 'Sign in as the owner to add players'}
                value={newFirstName}
                onChange={(e) => setNewFirstName(e.target.value)}
                disabled={!canManage}
                className="flex-1 min-w-0 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 rounded-xl px-4 py-2.5 text-sm outline-none transition text-slate-800 placeholder-slate-400 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <input
                type="text"
                placeholder={canManage ? 'Last name (optional)' : ''}
                value={newLastName}
                onChange={(e) => setNewLastName(e.target.value)}
                disabled={!canManage}
                className="flex-1 min-w-0 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 rounded-xl px-4 py-2.5 text-sm outline-none transition text-slate-800 placeholder-slate-400 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={isPending || !canManage}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold px-5 py-2.5 rounded-xl transition duration-150 flex items-center justify-center shadow-sm shrink-0"
              >
                Add
              </button>
            </form>

            {errorMsg && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2">
                <span className="font-bold">⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}
          </section>

          {/* Visual Paddle Stack Section */}
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
                    Paddle Rack Stack
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Top 4 paddles will stack into the next available court.</p>
                </div>
                <span className="bg-emerald-50 text-emerald-800 border border-emerald-100/50 text-[10px] font-black tracking-wider uppercase px-2.5 py-1 rounded-full shrink-0">
                  {queue.length} Stacked
                </span>
              </div>

              {/* Silo Buster Controls */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200/60 items-center justify-between">
                <label className="flex items-center space-x-2 text-xs font-semibold text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoMix}
                    onChange={(e) => setAutoMix(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                  />
                  <span>Auto-Mix Rack After Each Finish</span>
                </label>

                <button
                  onClick={handleShuffleQueue}
                  disabled={queue.length < 2 || isPending || !canManage}
                  className="bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1"
                  title="Shuffle everyone currently waiting to break court locking"
                >
                  🔀 Mix Queue
                </button>
              </div>
            </div>

            <div className="p-4 space-y-2.5 max-h-[500px] overflow-y-auto custom-scrollbar bg-slate-50/20">
              {queue.length === 0 ? (
                <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-white">
                  <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3">

                  </div>
                  <p className="text-sm font-semibold text-slate-600">The rack is empty</p>
                  <p className="text-xs mt-1 text-slate-400">Register and add players to stack their paddles!</p>
                </div>
              ) : (
                queue.map((playerId, index) => {
                  const player = players.find(p => p.id === playerId);
                  if (!player) return null;

                  const isNextUp = index < 4;

                  return (
                    <div
                      key={playerId}
                      className={`flex items-center justify-between p-3.5 rounded-xl transition-all relative group ${
                        isNextUp
                          ? 'bg-emerald-50/40 border-2 border-emerald-500 shadow-sm'
                          : 'bg-white hover:bg-slate-50 border border-slate-200/80'
                      }`}
                    >
                      <div className="flex items-center space-x-3.5">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                          isNextUp ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {index + 1}
                        </div>

                        <div className={`w-9 h-9 rounded-full flex items-center justify-center border ${
                          isNextUp
                            ? 'border-emerald-200 bg-emerald-100/40 text-emerald-700'
                            : 'border-slate-200 bg-slate-50 text-slate-400'
                        }`}>
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2a4 4 0 00-4 4v4.5A5.5 5.5 0 0011.5 16v5a1 1 0 102 0v-5A5.5 5.5 0 0016 10.5V6a4 4 0 00-4-4zm-2 4a2 2 0 114 0v2h-4V6z"/>
                          </svg>
                        </div>

                        <div>
                          <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                            {fullName(player)}
                            {player.userId && player.userId === viewerUserId && (
                              <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                you
                              </span>
                            )}
                            {!player.userId && (
                              <span
                                className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600"
                                title="Walk-in player — no linked account. Link them from the Members tab."
                              >
                                walk-in
                              </span>
                            )}
                            {player.waitRounds >= matchmakingProp.starveThreshold && (
                              <span
                                className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                                  player.waitRounds >= matchmakingProp.emergencyWait
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-amber-100 text-amber-700'
                                }`}
                                title={`Waiting ${player.waitRounds} rounds`}
                              >
                                ⏳ {player.waitRounds}
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-slate-400 font-medium">
                            Played: {player.gamesPlayed} (W: {player.wins || 0} - L: {player.losses || 0})
                          </p>
                        </div>
                      </div>

                      {canManage && (
                        <div className="flex items-center space-x-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleRemovePlayer(player.id)}
                            className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:text-red-700 hover:bg-red-100 border border-red-100"
                            title="Remove Player"
                          >
                            ✕
                          </button>
                        </div>
                      )}

                      {isNextUp && (
                        <span className="absolute -top-2 right-4 text-[8px] tracking-widest uppercase font-black bg-emerald-600 text-white px-2 py-0.5 rounded-full shadow-sm">
                          ON DECK
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

        </div>

        {/* Right Column: Active Courts Grid */}
        <div className="lg:col-span-7 space-y-6">

          {/* Desktop: segmented tab control — equal-width segments on a single
              row, so the bar never wraps regardless of how many tabs there are. */}
          <div
            role="tablist"
            aria-label="Arena views"
            onKeyDown={handleTabKeyDown}
            className="hidden md:flex gap-1 p-1 rounded-2xl bg-slate-100/80 border border-slate-200/80 shadow-sm"
          >
            {navTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => { tabRefs.current[tab.id] = el; }}
                  role="tab"
                  id={`arena-tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`arena-panel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex-1 min-w-0 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl
                    text-[11px] font-extrabold uppercase tracking-[0.06em]
                    transition-all duration-200 ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-white/80'
                  }`}
                >
                  {isActive && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{tab.label}</span>
                  {tab.badge != null && (
                    <span className={`shrink-0 text-[9px] font-black rounded-full px-1.5 py-0.5 leading-none ${
                      isActive ? 'bg-emerald-400 text-slate-900' : 'bg-amber-500 text-white'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Mobile: persistent bottom navigation drawer */}
          <ArenaNavDrawer
            navTabs={navTabs}
            activeTab={activeTab}
            activeTabLabel={activeTabLabel}
            canManage={canManage}
            pendingRequests={pendingRequests}
            onSelectTab={handleSelectTab}
          />

          {/* Scroll target — selecting a tab on mobile scrolls here. */}
          <div ref={contentAnchorRef} className="scroll-mt-24" aria-hidden="true" />

          {activeTab === 'courts' && (
            <ArenaCourtsPanel
              courts={courts}
              players={players}
              canManage={canManage}
              isPending={isPending}
              queueLength={queue.length}
              onAddCourt={handleAddCourt}
              onFinishCourt={handleTriggerScoreModal}
              onFillCourt={handleFillCourt}
              onRemoveCourt={handleRemoveCourt}
            />
          )}

          {activeTab === 'thisweek' && (
            <div
              role="tabpanel"
              id="arena-panel-thisweek"
              aria-labelledby="arena-tab-thisweek"
              className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
                    🏆 Player of the Week
                  </h3>
                  <p className="text-xs text-slate-500 mt-1.5">{describeSchedule(schedule)}</p>
                </div>
                {canManage && (
                  <button
                    onClick={() => setScheduleModalOpen(true)}
                    className="shrink-0 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:text-emerald-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                  >
                    Edit schedule
                  </button>
                )}
              </div>

              {!leaderboard.hasData ? (
                <div className="py-12 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/20">
                  <p className="text-2xl mb-2">🏓</p>
                  <p className="text-sm font-semibold text-slate-500">No matches yet this week</p>
                  <p className="text-xs mt-1">Play some games to claim the top spot!</p>
                </div>
              ) : (
                <ol className="space-y-2">
                  {leaderboard.leaders.map((p) => {
                    const isMe = myPlayer?.id === p.playerId;
                    return (
                      <li
                        key={p.playerId}
                        className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                          isMe ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-100 bg-slate-50/50'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ring-1 shrink-0 ${
                            RANK_STYLES[p.rank] ?? 'bg-slate-100 text-slate-500 ring-slate-200'
                          }`}
                        >
                          {p.rank}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800 truncate flex items-center gap-2">
                            <span className="truncate">{p.name}</span>
                            {isMe && (
                              <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                You
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {p.games} game{p.games !== 1 ? 's' : ''} · {p.winPct}% win rate
                          </p>
                        </div>
                        <span className="text-right shrink-0">
                          <span className="block text-lg font-extrabold text-emerald-700 leading-none">{p.wins}</span>
                          <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">
                            {p.wins === 1 ? 'win' : 'wins'}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div
              role="tabpanel"
              id="arena-panel-stats"
              aria-labelledby="arena-tab-stats"
              className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in"
            >
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
                  Partnership Pairing Matrix
                </h3>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  To ensure maximum pairing variety, historical partnerships are tracked dynamically. The active court loader assesses cumulative partnerships for the top 4 players and implements the lineup with the lowest match history score.
                </p>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl bg-slate-50 custom-scrollbar">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="p-3 font-extrabold text-slate-500 border-r border-slate-200 sticky left-0 bg-slate-100">Player</th>
                      {players.map(p => (
                        <th key={p.id} className="p-3 font-extrabold text-slate-500 text-center truncate max-w-[80px]" title={fullName(p)}>
                          {p.firstName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map(rowPlayer => (
                      <tr key={rowPlayer.id} className="border-b border-slate-200/60 hover:bg-white transition">
                        <td className="p-3 font-bold text-slate-700 border-r border-slate-200 sticky left-0 bg-slate-50">
                          {fullName(rowPlayer)}
                          {rowPlayer.userId && rowPlayer.userId === viewerUserId && (
                            <span className="text-emerald-600 font-normal"> (you)</span>
                          )}
                        </td>
                        {players.map(colPlayer => {
                          const isSelf = rowPlayer.id === colPlayer.id;
                          const count = getPartnershipCount(rowPlayer.id, colPlayer.id);

                          return (
                            <td
                              key={colPlayer.id}
                              className={`p-3 text-center border-r border-slate-200/40 font-bold ${
                                isSelf
                                  ? 'bg-slate-100 text-slate-400 font-normal'
                                  : count > 0
                                    ? count >= 3
                                      ? 'bg-amber-50 text-amber-800'
                                      : 'bg-emerald-50 text-emerald-800'
                                    : 'text-slate-400 bg-white'
                              }`}
                            >
                              {isSelf ? '-' : count}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500">
                <div className="flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 rounded bg-white border border-slate-200"></span>
                  <span>Never Partnered</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 rounded bg-emerald-50 border border-emerald-100"></span>
                  <span>Few Partnerships</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-3.5 h-3.5 rounded bg-amber-50 border border-amber-100"></span>
                  <span>Repeated Pairings (Optimized Out)</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div
              role="tabpanel"
              id="arena-panel-history"
              aria-labelledby="arena-tab-history"
              className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in"
            >
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
                  Match History Log
                </h3>
                <p className="text-xs text-slate-500 mt-1.5">
                  Complete ledger of finished matches, final scores, and team results.
                </p>
              </div>

              {matchHistory.length === 0 ? (
                <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/20">
                  <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3 text-lg">
                    📊
                  </div>
                  <p className="text-sm font-semibold text-slate-600">No matches recorded yet</p>
                  <p className="text-xs mt-1 text-slate-400">Completed game summaries will show up here.</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
                  {matchHistory.map((match) => {
                    const team1Won = match.score1 > match.score2;
                    const team2Won = match.score2 > match.score1;

                    return (
                      <div key={match.id} className="border border-slate-100 rounded-xl bg-slate-50/50 p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold mb-3">
                          <span>{match.courtName}</span>
                          <span>{formatTimestamp(match.timestamp)}</span>
                        </div>

                        <div className="grid grid-cols-9 items-center gap-2">
                          {/* Team A Horizontal Layout in logs */}
                          <div className={`col-span-3 p-2.5 rounded-lg text-center border ${
                            team1Won ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-slate-100'
                          }`}>
                            <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Team A</div>
                            <div className="text-xs font-semibold text-slate-700 truncate">
                              {match.team1.map(p => p.firstName).join(' & ')}
                            </div>
                            {team1Won && <span className="inline-block mt-1.5 text-[8px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">Win</span>}
                          </div>

                          <div className="col-span-3 flex flex-col items-center justify-center">
                            <div className="flex items-center space-x-3 text-lg font-extrabold text-slate-800">
                              <span className={team1Won ? 'text-emerald-600 font-black' : ''}>{match.score1}</span>
                              <span className="text-slate-300 font-normal">:</span>
                              <span className={team2Won ? 'text-emerald-600 font-black' : ''}>{match.score2}</span>
                            </div>
                          </div>

                          {/* Team B Horizontal Layout in logs */}
                          <div className={`col-span-3 p-2.5 rounded-lg text-center border ${
                            team2Won ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-slate-100'
                          }`}>
                            <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Team B</div>
                            <div className="text-xs font-semibold text-slate-700 truncate">
                              {match.team2.map(p => p.firstName).join(' & ')}
                            </div>
                            {team2Won && <span className="inline-block mt-1.5 text-[8px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">Win</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'members' && (
            <div role="tabpanel" id="arena-panel-members" aria-labelledby="arena-tab-members">
              <ArenaMembers
                arenaId={arenaId}
                members={members}
                viewerUserId={viewerUserId}
                viewerRole={viewerRole}
                canManage={canManage}
                pendingRequests={pendingRequests}
                pendingLinkRequests={pendingLinkRequests}
                viewerLinkContext={viewerLinkContext}
              />
            </div>
          )}

          {activeTab === 'mystats' && myPlayer && (
            <div
              role="tabpanel"
              id="arena-panel-mystats"
              aria-labelledby="arena-tab-mystats"
              className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in"
            >
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
                  My Stats — {fullName(myPlayer)}
                </h3>
                <p className="text-xs text-slate-500 mt-1.5">
                  Your record in this arena. Stats update as you finish matches.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Games', value: myPlayer.gamesPlayed },
                  { label: 'Wins', value: myPlayer.wins },
                  { label: 'Losses', value: myPlayer.losses },
                  {
                    label: 'Win %',
                    value:
                      myPlayer.wins + myPlayer.losses > 0
                        ? `${Math.round((myPlayer.wins / (myPlayer.wins + myPlayer.losses)) * 100)}%`
                        : '—',
                  },
                ].map((s) => (
                  <div key={s.label} className="bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-3 text-center">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {s.label}
                    </span>
                    <span className="block text-xl font-extrabold text-slate-800 mt-0.5">{s.value}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-3">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Queue status
                  </span>
                  <span className="block text-sm font-bold text-slate-800 mt-0.5">
                    {myQueueIndex >= 0
                      ? `In the rack — position #${myQueueIndex + 1}`
                      : courts.some(
                            (c) => c.team1.includes(myPlayer.id) || c.team2.includes(myPlayer.id),
                          )
                        ? 'On a court'
                        : 'Not in the rack'}
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-3">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Rating
                  </span>
                  <span className="block text-sm font-bold text-slate-800 mt-0.5">
                    {myPlayer.gamesPlayed > 0 ? (
                      <>
                        {eloToDupr(myPlayer.rating).toFixed(3)}
                        <span className="text-slate-400 font-normal"> DUPR</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
                  My matches ({myMatches.length})
                </h4>
                {myMatches.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/20 text-xs">
                    No finished matches yet.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                    {myMatches.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl bg-slate-50/50 p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
                            <span
                              className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                                m.won ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {m.won ? 'Win' : 'Loss'}
                            </span>
                            <span className="truncate">
                              with {m.partners.map((p) => p.firstName).join(' & ') || '—'}
                            </span>
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {m.courtName} · {formatTimestamp(m.timestamp)}
                          </p>
                        </div>
                        <span className="text-sm font-extrabold text-slate-800 shrink-0">
                          {m.scoreFor}
                          <span className="text-slate-300 font-normal"> : </span>
                          {m.scoreAgainst}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* Schedule editor (owner or organizer) */}
      {scheduleModalOpen && canManage && (
        <ArenaScheduleModal
          schedule={schedule}
          onSave={handleSaveSchedule}
          onClose={() => {
            setScheduleError('');
            setScheduleModalOpen(false);
          }}
          isPending={isPending}
          error={scheduleError}
        />
      )}

      {/* Score Entry Modal — matches the CourtCard's visual language: slate-900
          court tile in the header, emerald = Team A, sky = Team B, stacked
          player names per side, a small slate VS pivot, then a stepper-equipped
          score row. Fields start empty (placeholder-only); Save is disabled
          until both contain a non-negative integer. */}
      {scoreModalOpen && selectedCourtForScore && (() => {
        const courtBadge =
          selectedCourtForScore.name?.match(/\d+/)?.[0]
          ?? selectedCourtForScore.name?.charAt(0)
          ?? '?';
        // Carry the player id along with the formatted name so the list items
        // get a stable React key (not the array index).
        const resolveSlot = (id) => ({ id, ...formatShortName(players.find((p) => p.id === id)) });
        const t1 = selectedCourtForScore.team1.map(resolveSlot);
        const t2 = selectedCourtForScore.team2.map(resolveSlot);
        const validation = validateMatchScore(team1Score, team2Score, matchDefaults.targetScore);
        const canSubmit = validation.ok;
        const closeModal = () => {
          setScoreModalOpen(false);
          setSelectedCourtForScore(null);
        };
        const submit = () => {
          if (!canSubmit) return;
          handleEndMatchWithScore(
            selectedCourtForScore.id,
            parseInt(team1Score, 10),
            parseInt(team2Score, 10),
          );
        };
        const onKeyDownSubmit = (e) => {
          if (e.key === 'Enter' && canSubmit) {
            e.preventDefault();
            submit();
          }
        };
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="score-modal-title"
              className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-xl animate-scale-up overflow-hidden"
            >
              {/* Header */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-r from-slate-50/80 to-white">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    aria-hidden="true"
                    className="shrink-0 w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-extrabold text-sm shadow-sm"
                  >
                    {courtBadge}
                  </div>
                  <div className="min-w-0">
                    <h3 id="score-modal-title" className="font-extrabold text-slate-900 text-sm truncate">
                      {selectedCourtForScore.name}
                    </h3>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mt-0.5">
                      Record final score
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="Close"
                  className="shrink-0 w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition"
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div className="px-5 py-5">
                {/* Identity row — TEAM A | VS | TEAM B (mirrors the card) */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="min-w-0">
                    <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-emerald-600 mb-1.5">
                      Team A
                    </div>
                    <ul className="space-y-1">
                      {t1.map((p) => (
                        <li
                          key={p.id}
                          className="text-sm font-bold text-slate-800 truncate leading-tight"
                          title={p.full}
                        >
                          {p.display}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <span
                    aria-hidden="true"
                    className="shrink-0 inline-flex w-9 h-9 rounded-full bg-slate-100 text-slate-500 items-center justify-center text-[10px] font-black tracking-[0.18em]"
                  >
                    VS
                  </span>
                  <div className="min-w-0 text-right">
                    <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-sky-600 mb-1.5">
                      Team B
                    </div>
                    <ul className="space-y-1">
                      {t2.map((p) => (
                        <li
                          key={p.id}
                          className="text-sm font-bold text-slate-800 truncate leading-tight"
                          title={p.full}
                        >
                          {p.display}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Score row — stepper buttons flanking each input */}
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <div className="flex items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTeam1Score(stepScore(team1Score, -1))}
                      aria-label="Decrease Team A score"
                      className="shrink-0 w-9 rounded-xl bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 font-extrabold text-lg flex items-center justify-center transition"
                    >
                      −
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={team1Score}
                      onChange={(e) => onScoreChange(setTeam1Score, e.target.value)}
                      onKeyDown={onKeyDownSubmit}
                      placeholder="0"
                      aria-label="Team A score"
                      className="flex-1 min-w-0 text-center bg-white border-2 border-emerald-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 rounded-xl py-3 text-2xl font-extrabold text-slate-800 placeholder:text-slate-300 outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setTeam1Score(stepScore(team1Score, 1))}
                      aria-label="Increase Team A score"
                      className="shrink-0 w-9 rounded-xl bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 font-extrabold text-lg flex items-center justify-center transition"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTeam2Score(stepScore(team2Score, -1))}
                      aria-label="Decrease Team B score"
                      className="shrink-0 w-9 rounded-xl bg-sky-50 hover:bg-sky-100 active:bg-sky-200 text-sky-700 font-extrabold text-lg flex items-center justify-center transition"
                    >
                      −
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={team2Score}
                      onChange={(e) => onScoreChange(setTeam2Score, e.target.value)}
                      onKeyDown={onKeyDownSubmit}
                      placeholder="0"
                      aria-label="Team B score"
                      className="flex-1 min-w-0 text-center bg-white border-2 border-sky-200 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15 rounded-xl py-3 text-2xl font-extrabold text-slate-800 placeholder:text-slate-300 outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => setTeam2Score(stepScore(team2Score, 1))}
                      aria-label="Increase Team B score"
                      className="shrink-0 w-9 rounded-xl bg-sky-50 hover:bg-sky-100 active:bg-sky-200 text-sky-700 font-extrabold text-lg flex items-center justify-center transition"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Hint while typing; red error once both scores are filled but
                    the scoreline is illegal (tie / target / win-by-2). */}
                <div className="mt-4">
                  {validation.complete && !validation.ok ? (
                    <div
                      role="alert"
                      className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px] font-semibold flex items-center gap-2"
                    >
                      <svg
                        className="w-3.5 h-3.5 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{validation.reason}</span>
                    </div>
                  ) : (
                    <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/70 text-slate-500 text-[11px] flex items-center justify-center gap-1.5">
                      <span className="font-bold text-slate-700">
                        First to {matchDefaults.targetScore}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span>Win by 2</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/40 flex gap-2.5">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className={`flex-1 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] rounded-xl transition ${
                    canSubmit
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  Save Score
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tailwind Animations Setup */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(241, 245, 249, 0.4);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.3);
          border-radius: 9999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.5);
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUp {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-fade-in {
          animation: fadeIn 0.15s ease-out forwards;
        }
        .animate-scale-up {
          animation: scaleUp 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}
