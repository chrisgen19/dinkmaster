'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  checkOutPlayer,
  skipPlayer,
  shuffleQueue,
  fillCourt,
  cancelFill,
  editCourtLineup,
  endMatch,
  addCourt,
  removeCourt,
  requestToJoin,
  updateArenaSchedule,
  startActivity,
} from './actions';
import { DEFAULT_STARVE_THRESHOLD, DEFAULT_EMERGENCY_WAIT, ON_DECK_SIZE } from '@/lib/matchmaking';
import { DEFAULT_TARGET_SCORE, DEFAULT_AUTO_MIX, DEFAULT_COUNT_OFF_SCHEDULE, DEFAULT_SHOW_PARTNERSHIP_MATRIX } from '@/lib/match-defaults';
import { computeWeeklyLeaderboard, DEFAULT_LEADERBOARD_SIZE } from '@/lib/leaderboard';
import { createStateFreshnessGuard } from '@/lib/state-freshness';
import { saveArenaSnapshot } from '@/lib/offline-store';
import { useArenaOffline } from './arena-offline';
import {
  OfflineActiveBanner,
  OfflineBlockedDialog,
  OfflineDivergenceDialog,
  OfflineHoldNotice,
  OfflinePromptBanner,
} from './arena-offline-banner';
import { OFFLINE_UNAVAILABLE_MESSAGE, holdExpiryDelay, isHoldActive } from './arena-offline-state';
import { computeActivityStats } from '@/lib/activities';
import { stepScore, validateMatchScore } from '@/lib/scoring';
import { formatShortName, profileHref } from '@/lib/player-display';
import { hasConfiguredSchedule, describeSchedule } from '@/lib/schedule-format';
import { AuthStatus } from './auth-status';
import { SiteHeader } from './site-header';
import { ArenaMembers } from './arena-members';
import { ArenaHistory } from './arena-history';
import { ArenaMyStats } from './arena-mystats';
import { ArenaMobileNav, ArenaContentSwipe } from './arena-mobile-nav';
import { ArenaHero } from './arena-hero';
import { TabIcon, TabBadge } from './arena-tab-icons';
import { ArenaScheduleModal } from './arena-schedule-modal';
import { ArenaCourtsPanel } from './arena-courts-panel';
import { CourtEditModal } from './court-edit-modal';
import { SkipPickerModal } from './skip-picker-modal';
import { ArenaThisWeek } from './arena-this-week';
import { ArenaActivityBanner } from './arena-activity-banner';
import { ArenaPrepRosterModal } from './arena-prep-roster-modal';
import { PaddleRackStack } from './paddle-rack-stack';

/** Display name: "First Last", or just "First" when no last name is set. */
const fullName = (p) => (p?.lastName ? `${p.firstName} ${p.lastName}` : p?.firstName ?? 'Unknown');

/**
 * Per-arena monotonic apply-guard for `getState` snapshots, so an out-of-order
 * (older) snapshot from a slow action response can't clobber a newer SSE push
 * (or vice-versa). Module-scoped (not a React ref): it's bookkeeping, not
 * render state — nothing re-renders off it, and keeping it out of the
 * component avoids reading a ref inside render-adjacent closures. Semantics
 * (equal stamps apply, stampless payloads apply) live in state-freshness.js
 * alongside their tests.
 */
const shouldApplyServerState = createStateFreshnessGuard();

/** Accept only digits or an empty string into a controlled score input. */
const onScoreChange = (setter, raw) => {
  if (raw === '' || /^\d+$/.test(raw)) setter(raw);
};

/**
 * Numeric badge for the Members tab in the arena nav. Counts unresolved
 * items needing the viewer's attention: pending join + link requests for
 * managers, and the viewer's own pending self-link for non-managers.
 * A manager's own self-link is already inside `pendingLinkRequests`, so it
 * must not be added a second time via `viewerLinkContext`. Returns `null`
 * (not 0) when there is nothing to surface, so the consumer can render a
 * falsy badge without an extra check.
 */
const computeMembersBadge = ({ canManage, pendingRequests, pendingLinkRequests, viewerLinkContext }) => {
  const count = canManage
    ? pendingRequests.length + pendingLinkRequests.length
    : viewerLinkContext?.pendingRequest
      ? 1
      : 0;
  return count || null;
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
  matchmaking: matchmakingProp = { starveThreshold: DEFAULT_STARVE_THRESHOLD, emergencyWait: DEFAULT_EMERGENCY_WAIT, skipRestoresPriority: true, skipPickReplacement: true },
  matchDefaults = {
    targetScore: DEFAULT_TARGET_SCORE,
    autoMixDefault: DEFAULT_AUTO_MIX,
    leaderboardSize: DEFAULT_LEADERBOARD_SIZE,
    countOffScheduleGames: DEFAULT_COUNT_OFF_SCHEDULE,
    showPartnershipMatrix: DEFAULT_SHOW_PARTNERSHIP_MATRIX,
  },
  sessionPrep = { autoResetOnSession: true, lastSessionResetAt: null },
  // Soonest upcoming activity, resolved server-side. Drives the prep banner's
  // CTA so it opens exactly the night it displays. Null when the arena has
  // nothing scheduled ahead, which renders no banner.
  nextActivity = null,
  // RSVPs for the open activity. Server-rendered rather than part of getState:
  // attendance changes far less often than the board, so paying for it on every
  // SSE frame would be waste. The prep roster refreshes after a bulk check-in.
  activityAttendees = [],
  canManage,
  viewerRole,
  viewerUserId,
  isAuthenticated,
  members = [],
  pendingRequests = [],
  viewerPending = false,
  pendingLinkRequests = [],
  viewerLinkContext = null,
  invites = [],
  // Set when this component is mounted by the offline shell from an IndexedDB
  // snapshot (a cold offline boot), rather than server-rendered live. It tells
  // the offline hook to start/resume a local session on mount even though no
  // `offline` event fired (the device was already offline before load).
  offlineBoot = false,
}) {
  const router = useRouter();
  const [players, setPlayers] = useState(initialState.players);
  const [queue, setQueue] = useState(initialState.queue);
  const [courts, setCourts] = useState(initialState.courts);
  const [matchHistory, setMatchHistory] = useState(initialState.matchHistory);
  const [history, setHistory] = useState(initialState.history);
  // Local copy of the session-prep server state so the banner reflects a
  // just-fired `prepareNextSession` without waiting for a server refetch.
  // Declared up here (rather than alongside the other modal/UI state below)
  // because the prop-refresh resync block right after this needs to call
  // `setLastSessionResetAt` — declaring it later would TDZ-throw on render.
  const [lastSessionResetAt, setLastSessionResetAt] = useState(sessionPrep.lastSessionResetAt);
  // The open activity, from getState. Every session-scoped surface (the rack
  // tile, My Stats, the prep banner) keys off its id, so it must resync
  // alongside `lastSessionResetAt` on every server payload — and for the same
  // TDZ reason, it's declared up here rather than with the UI state below.
  const [currentActivity, setCurrentActivity] = useState(initialState.currentActivity ?? null);
  // Arena schedule (powers the "This Week" leaderboard window). Declared up
  // here, before `persistSnapshot`, so the offline snapshot captures the LIVE
  // schedule: `handleSaveSchedule` updates this state without a
  // `router.refresh()`, so the `initialSchedule` prop would go stale after an
  // edit. Its editor state (modal open / error) stays with the other UI state
  // below. (Same up-front-declaration reason as `lastSessionResetAt`.)
  const [schedule, setSchedule] = useState(initialSchedule);
  // Advisory "a manager is running this board offline" flag from getState;
  // resynced on every server payload, never touched by local engine states.
  const [offlineHold, setOfflineHold] = useState(initialState.offlineHold ?? null);
  // Error/notification banners. Declared up here (not with the other UI
  // state below) because the offline hook wiring right after needs the
  // setters, and react-hooks/immutability enforces declaration order.
  const [errorMsg, setErrorMsg] = useState('');
  const [notification, setNotification] = useState('');

  // Current board in the getState shape, as a ref so offline-mode callbacks
  // (resolve command, persist snapshot) read the LIVE board without being
  // recreated on every board change. Initialized once here (the lint-safe
  // render pattern) and kept in sync by the effect below plus direct writes
  // in the two apply callbacks.
  const boardStateRef = useRef(null);
  if (boardStateRef.current == null) {
    boardStateRef.current = {
      players: initialState.players,
      queue: initialState.queue,
      courts: initialState.courts,
      matchHistory: initialState.matchHistory,
      history: initialState.history,
      lastSessionResetAt: initialState.lastSessionResetAt,
      // Carried into the offline engine so a match finished during an outage
      // gets stamped with the open activity, and so a cold offline boot knows
      // which activity to scope its tallies to.
      currentActivity: initialState.currentActivity ?? null,
    };
  }
  // Stamp of the last applied server snapshot: recorded as the offline
  // session's base (`pending.base.fetchedAt`) so the Phase 3 sync can tell
  // which server state the event log forked from. Plain state (not a ref) so
  // every consumer stays clean under react-hooks/refs; it changes only when
  // fresher server payloads apply, which re-render anyway.
  const [lastServerFetchedAt, setLastServerFetchedAt] = useState(initialState.fetchedAt ?? null);
  const advanceServerStamp = (fetchedAt) => {
    if (fetchedAt) setLastServerFetchedAt((prev) => (fetchedAt > (prev ?? 0) ? fetchedAt : prev));
  };

  // Expire a stale advisory hold on its own schedule. The banner's TTL is
  // checked during render, and an idle arena page can go hours without one
  // (SSE heartbeats update no state), so a device that died holding the
  // board would otherwise keep its notice up well past the TTL.
  useEffect(() => {
    const delay = holdExpiryDelay(offlineHold);
    if (delay === null) return;
    const timer = setTimeout(() => setOfflineHold(null), delay);
    return () => clearTimeout(timer);
  }, [offlineHold]);

  // Post-commit catch-all keeping the board ref current for every path that
  // sets board state (including the render-time prop resync, which may not
  // touch refs itself under react-hooks/refs).
  useEffect(() => {
    boardStateRef.current = { players, queue, courts, matchHistory, history, lastSessionResetAt, currentActivity };
  }, [players, queue, courts, matchHistory, history, lastSessionResetAt, currentActivity]);

  // Write a board produced by the LOCAL engine (offline mode) into state.
  // Bypasses the freshness guard on purpose: local states carry no fetchedAt
  // and must not compete with server stamps. The ref is written immediately
  // (not just via the effect) so two quick offline commands in the same tick
  // can't resolve against a stale board.
  const applyLocalState = useCallback((state) => {
    boardStateRef.current = {
      players: state.players,
      queue: state.queue,
      courts: state.courts,
      matchHistory: state.matchHistory,
      history: state.history,
      lastSessionResetAt: state.lastSessionResetAt ?? null,
      // The engine spreads `...state`, so it round-trips its own value. The
      // fallback reads the ref (not the `currentActivity` state) because this
      // callback is memoized with an empty dep array — closing over the state
      // would capture a stale value. It only matters for a snapshot saved
      // before this field existed.
      currentActivity: state.currentActivity ?? boardStateRef.current?.currentActivity ?? null,
    };
    setPlayers(state.players);
    setQueue(state.queue);
    setCourts(state.courts);
    setMatchHistory(state.matchHistory);
    setHistory(state.history);
    if ('lastSessionResetAt' in state) setLastSessionResetAt(state.lastSessionResetAt);
    // Same guard as above: the offline engine's local states carry no
    // `currentActivity` key, so a locally-applied board can't blank out the
    // open activity and silently reset every session-scoped tally to zero.
    if ('currentActivity' in state) setCurrentActivity(state.currentActivity ?? null);
    // Sync responses arrive through this path too (applySyncedState); they
    // carry `offlineHold: null` after the server cleared it. Engine states
    // never have the key, so a live hold can't be wiped by local play.
    if ('offlineHold' in state) setOfflineHold(state.offlineHold ?? null);
  }, []);

  // Save the current board as this arena's IndexedDB snapshot: the offline
  // shell renders it, and an offline session replays its event log over it.
  const persistSnapshot = useCallback(
    () =>
      saveArenaSnapshot({
        arenaId,
        arenaName,
        savedAt: Date.now(),
        canManage,
        viewerRole,
        viewerUserId,
        matchmaking: matchmakingProp,
        matchDefaults,
        // Extra props the interactive board needs when the offline shell
        // mounts <Arena> from this snapshot (cold offline boot). Server-only
        // data (members, requests, invites) is intentionally omitted; it
        // defaults to empty offline.
        description,
        schedule,
        // Merge the LIVE reset timestamp over the prop: `prepareNextSession`
        // updates the `lastSessionResetAt` state (via applyResult) without
        // refreshing the `sessionPrep` prop, so the prop goes stale after a
        // "Start a new session". Without this, a cold offline boot would
        // initialize the session boundary from the old reset time and
        // mis-window the prep banner and session-scoped stats.
        sessionPrep: { ...sessionPrep, lastSessionResetAt },
        isAuthenticated,
        state: boardStateRef.current,
      }),
    [
      arenaId,
      arenaName,
      canManage,
      viewerRole,
      viewerUserId,
      matchmakingProp,
      matchDefaults,
      description,
      schedule,
      sessionPrep,
      lastSessionResetAt,
      isAuthenticated,
    ],
  );

  const getBoardState = useCallback(() => boardStateRef.current, []);

  // Apply the sync response's server state. Unlike plain applyLocalState,
  // this ALSO advances the module freshness guard (and the base stamp), so
  // when offline mode deactivates right after, a stale pre-sync SSE frame
  // can't win against the just-synced board.
  const applySyncedState = useCallback((state) => {
    if (!state) return;
    shouldApplyServerState(arenaId, state);
    if (state.fetchedAt) {
      setLastServerFetchedAt((prev) => (state.fetchedAt > (prev ?? 0) ? state.fetchedAt : prev));
    }
    applyLocalState(state);
  }, [arenaId, applyLocalState]);

  // Post-sync report: success toast, plus an explicit note when best-effort
  // had to skip events that no longer applied.
  const handleSynced = useCallback(({ appliedCount, skipped }) => {
    setNotification(
      `Offline session synced: ${appliedCount} ${appliedCount === 1 ? 'change' : 'changes'} saved.`,
    );
    setTimeout(() => setNotification(''), 5000);
    setErrorMsg(
      skipped.length > 0
        ? `${skipped.length} offline ${skipped.length === 1 ? 'change' : 'changes'} could not be applied (the board had moved on) and ${skipped.length === 1 ? 'was' : 'were'} skipped.`
        : '',
    );
  }, []);

  // Offline session mode (manager-only): local board mutations recorded to an
  // IndexedDB event log while the connection is down, replayed to the server
  // on reconnect. See arena-offline.js.
  const offline = useArenaOffline({
    arenaId,
    canManage,
    offlineBoot,
    settingsProps: { matchmaking: matchmakingProp, matchDefaults },
    getBoardState,
    applyLocalState,
    applySyncedState,
    onSynced: handleSynced,
    lastServerFetchedAt,
    persistSnapshot,
  });
  const { offlineActive } = offline;

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
    // Prop resyncs go through the same monotonic guard as SSE pushes and
    // action results: a `router.refresh()` response rendered from an OLDER
    // snapshot than an SSE frame that already applied must not roll the
    // board backward. When the payload is fresh (the common case) it applies
    // and advances the stamp, which also stops an older queued SSE frame
    // from overwriting it afterwards.
    // While an offline session runs, server payloads must NOT touch the
    // board (the local event log owns it). Gated on the STATE flag (render
    // code may not read refs) and checked first so the freshness stamp
    // doesn't advance on skipped frames.
    if (!offline.offlineActive && shouldApplyServerState(arenaId, initialState)) {
      advanceServerStamp(initialState.fetchedAt);
      setPlayers(initialState.players);
      setQueue(initialState.queue);
      setCourts(initialState.courts);
      setMatchHistory(initialState.matchHistory);
      setHistory(initialState.history);
      // `lastSessionResetAt` is now the server-authoritative cutoff for the
      // session-scoped overlay. Resync it alongside the other fields so a
      // `router.refresh()` that doesn't flow through `applyResult` (e.g. a
      // child component refreshing after a link approval) still surfaces a
      // concurrent reset that happened on the server.
      setLastSessionResetAt(initialState.lastSessionResetAt);
      setCurrentActivity(initialState.currentActivity ?? null);
      setOfflineHold(initialState.offlineHold ?? null);
    }
  }

  const [isPending, startTransition] = useTransition();

  const [scoreModalOpen, setScoreModalOpen] = useState(false);
  const [selectedCourtForScore, setSelectedCourtForScore] = useState(null);
  // Score inputs are stored as strings so the field can be empty (placeholder-only)
  // until the organizer types or steps a value. Parsed to numbers on save.
  const [team1Score, setTeam1Score] = useState('');
  const [team2Score, setTeam2Score] = useState('');

  // The court whose fill is pending cancellation, surfaced in a confirm modal
  // so a destructive "return to deck" can't fire on a stray click. Null = closed.
  const [courtToCancel, setCourtToCancel] = useState(null);
  // The court whose teams are being manually edited (null = editor closed), plus
  // a modal-scoped error so a save race surfaces inside the editor, not behind it.
  const [courtToEdit, setCourtToEdit] = useState(null);
  const [editError, setEditError] = useState('');
  // Bumped on a save race to remount the editor, so its working lineup re-seeds
  // from the (rolled-back, authoritative) court and drops the now-invalid pick.
  const [editResetKey, setEditResetKey] = useState(0);

  // Skip-with-replacement picker (SkipPickerModal): when a manager skips an
  // on-deck paddle and the arena has `skipPickReplacement` on, the modal
  // opens listing waiting paddles. Null = closed. Selection lives inside the
  // modal (it unmounts on close); the race error stays HERE because the
  // server action sets it and feeds it back into the modal via prop — the
  // page-level banner would be hidden behind the modal's backdrop.
  const [skipPickerSkippedId, setSkipPickerSkippedId] = useState(null);
  const [skipPickerError, setSkipPickerError] = useState('');

  const [activeTab, setActiveTab] = useState('courts');

  const [autoMix, setAutoMix] = useState(matchDefaults.autoMixDefault);

  // Schedule editor state (the `schedule` value itself is declared up top so
  // `persistSnapshot` can capture the live edit; see there).
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

  // Viewer notice can be dismissed for the session.
  const [viewerNoticeDismissed, setViewerNoticeDismissed] = useState(false);
  // Height of the sticky site header, so the floating viewer notice OR the
  // manager prep banner can sit flush beneath it. Measured because the
  // header grows when the arena name wraps or the stat chips reflow on
  // narrow viewports. Seeded with a typical height so the notice is
  // positioned correctly on the first paint, before the ResizeObserver
  // refines it.
  const [headerHeight, setHeaderHeight] = useState(96);
  // Prep Roster modal — managers tap a banner button to open it. State lives
  // here (rather than inside the banner) so the modal renders at the page
  // root, outside the banner.
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  // "Copied!" feedback inside the sync-blocked dialog's copy-as-JSON button.
  const [copiedOfflineLog, setCopiedOfflineLog] = useState(false);

  // Persist the dismissal for the browser session, per arena, so a router
  // refresh (e.g. after requesting to join) or reload keeps it hidden.
  const noticeDismissKey = `arena:${arenaId}:viewerNoticeDismissed`;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring dismissal from sessionStorage (a client-only external store) on mount
    if (sessionStorage.getItem(noticeDismissKey) === '1') setViewerNoticeDismissed(true);
  }, [noticeDismissKey]);

  const dismissViewerNotice = () => {
    setViewerNoticeDismissed(true);
    sessionStorage.setItem(noticeDismissKey, '1');
  };

  useEffect(() => {
    // The viewer notice pins itself `headerHeight + 12px` below the sticky
    // site header; this observer keeps that offset fresh as the header
    // resizes. (The manager prep banner is in-flow now, so it doesn't use this.)
    const header = document.querySelector('[data-site-header]');
    if (!header) return undefined;
    const measure = () => {
      const h = header.getBoundingClientRect().height;
      setHeaderHeight(h);
      // Also publish as a CSS variable so the mobile tab strip
      // (`sticky top-[var(--site-header-h)]`) tucks under the real header
      // height instead of its 64px fallback.
      document.documentElement.style.setProperty('--site-header-h', `${h}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => {
      ro.disconnect();
      // Remove the var on unmount: /profile's Match Log day labels consume it
      // too (with a 64px fallback), and a stale arena-page measurement left on
      // documentElement would pin them at the wrong offset after a client-side
      // arena → profile navigation — and never update on rotate/resize, since
      // only this page observes the header.
      document.documentElement.style.removeProperty('--site-header-h');
    };
  }, []);

  // Measure the desktop tab bar so the sticky PaddleRack can sit exactly below
  // it instead of relying on a hardcoded height guess (which drifts whenever
  // the tab bar's padding / type size changes). Stays 0 on mobile where the
  // bar isn't rendered.
  const tabBarRef = useRef(null);
  const [tabBarHeight, setTabBarHeight] = useState(0);
  useEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return undefined;
    const measure = () => setTabBarHeight(bar.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
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

  // Escape closes the cancel-fill confirm modal too (keyboard partner to the
  // backdrop click and the "Keep Playing" button). Suppressed while the action
  // is in flight: handleConfirmCancelFill keeps the modal open until the result
  // lands so a NOT_PLAYING/INVALID_COURT race surfaces in context, and that
  // promise would be broken if Esc could still dismiss mid-action. `isPending`
  // is in the deps so the listener captures its current value, not a stale one.
  useEffect(() => {
    if (!courtToCancel) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !isPending) setCourtToCancel(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [courtToCancel, isPending]);

  // Activity-scoped overlay of games / wins / losses. The DB `Player` row holds
  // lifetime counters (incremented on every `endMatch` and surfaced on
  // /profile), but inside the arena view those numbers stop matching what the
  // This Week leaderboard shows once a new session opens. We recompute
  // games/W/L from the matches stamped with the open activity and overlay them
  // onto the players array so the Paddle Rack tile and the My Stats tab (both
  // derived from `players` / `myPlayer`) read off the same truth the
  // leaderboard does.
  //
  // Keyed on the activity id rather than the old `>= lastSessionResetAt`
  // timestamp cutoff: a match finishing either side of a boundary now lands
  // where it actually belongs instead of wherever the clock put it. A null
  // activity id means nothing is open yet and the tally counts everything,
  // preserving the old null-boundary behaviour.
  const currentActivityId = currentActivity?.id ?? null;
  const sessionStats = useMemo(
    () => computeActivityStats(matchHistory, currentActivityId),
    [matchHistory, currentActivityId],
  );
  // Preserve the lifetime `gamesPlayed` under `lifetimeGamesPlayed` so the My
  // Stats tab's "show rating" / "play a few matches" gates can keep asking
  // "have they ever played?" rather than "have they played this session?" —
  // otherwise a Reset Session would hide a rated player's rating until they
  // finished their first game in the new session.
  const displayPlayers = useMemo(
    () =>
      players.map((p) => {
        const s = sessionStats.get(p.id);
        return {
          ...p,
          lifetimeGamesPlayed: p.gamesPlayed,
          gamesPlayed: s?.games ?? 0,
          wins: s?.wins ?? 0,
          losses: s?.losses ?? 0,
        };
      }),
    [players, sessionStats],
  );
  // The viewer's own linked player in this arena (null for guests / non-players).
  const myPlayer = viewerUserId
    ? displayPlayers.find((p) => p.userId === viewerUserId) ?? null
    : null;
  // Resolve an arena playerId to a profile link, with the same rules as the
  // rack (shared `profileHref` in @/lib/player-display). Looks the player up
  // in the LIVE roster: leaderboard entries and match-history snapshots carry
  // ids of players who may since have left or been deleted — those resolve to
  // null and render as plain text instead of a dead link. Passed to the This
  // Week leaderboard and the History tab's roster badges.
  const playerProfileHrefFor = useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p]));
    const viewer = { viewerUserId, viewerIsMember: viewerRole !== null };
    return (playerId) => {
      const p = playerId ? byId.get(playerId) : null;
      return p ? profileHref({ userId: p.userId, playerId: p.id }, viewer) : null;
    };
  }, [players, viewerUserId, viewerRole]);
  // Courts with a match in progress — surfaced in the header stats and the
  // tab badge, so compute it once.
  const liveCourtCount = courts.filter((c) => c.status === 'playing').length;

  // Who is mid-match right now. The Members tab uses these to disable the
  // Delete / Remove actions (the server refuses to delete an on-court player),
  // so a manager sees the action gated up front instead of hitting an error
  // after confirming. Derived from the live local `courts` state — not a
  // server prop — so it stays correct as matches start/finish without a refetch.
  const onCourtPlayerIds = useMemo(() => {
    const ids = new Set();
    for (const c of courts) {
      if (c.status !== 'playing') continue;
      for (const id of [...c.team1, ...c.team2]) ids.add(id);
    }
    return ids;
  }, [courts]);
  const onCourtUserIds = useMemo(() => {
    const ids = new Set();
    for (const p of displayPlayers) {
      if (p.userId && onCourtPlayerIds.has(p.id)) ids.add(p.userId);
    }
    return ids;
  }, [displayPlayers, onCourtPlayerIds]);

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

  // Apply just the board state from a server `getState` payload. Shared by
  // `applyResult` (this viewer's own actions) and the realtime SSE
  // subscription (other users' changes), so a live push reconciles the board
  // without touching this viewer's own error/notification banners. Stable
  // identity (setters are stable) so the SSE effect doesn't re-subscribe.
  const applyServerState = useCallback((state) => {
    if (!state) return;
    // Offline session gate: while the local event log owns the board, no
    // server payload (SSE frame or action result) may overwrite it. Checked
    // before the freshness guard so skipped frames don't advance the stamp.
    // Uses the STATE flag (this callback stays ref-free for react-hooks/refs);
    // the identity change on offline toggle just re-subscribes the SSE
    // stream, which is idle during an offline session anyway.
    if (offlineActive) return;
    // Monotonic guard (see `shouldApplyServerState`): ignore a snapshot older
    // than one already applied, so a slow action response can't clobber a
    // newer SSE push that landed first (and vice-versa).
    if (!shouldApplyServerState(arenaId, state)) return;
    setLastServerFetchedAt((prev) =>
      state.fetchedAt && state.fetchedAt > (prev ?? 0) ? state.fetchedAt : prev,
    );
    setPlayers(state.players);
    setQueue(state.queue);
    setCourts(state.courts);
    setMatchHistory(state.matchHistory);
    setHistory(state.history);
    // Server-authoritative reset boundary: kept in sync on every action so
    // session-scoped tallies (rack tile, My Stats) never key off a client-
    // stamped timestamp that could disagree with `Match.createdAt` for a
    // match finishing right around a reset.
    if ('lastSessionResetAt' in state) {
      setLastSessionResetAt(state.lastSessionResetAt);
    }
    // The open activity is the real boundary the tallies key off. Same guard,
    // same reason: a local engine state must not blank it.
    if ('currentActivity' in state) {
      setCurrentActivity(state.currentActivity ?? null);
    }
    // Advisory hold rides every server payload; guarded so a local engine
    // state (which never carries the key) can't clear a live hold.
    if ('offlineHold' in state) {
      setOfflineHold(state.offlineHold ?? null);
    }
  }, [arenaId, offlineActive]);

  // Apply a server action result to local state (state, error, notification).
  const applyResult = (result) => {
    if (!result) return;
    setErrorMsg(result.error || '');
    if (result.notification) {
      setNotification(result.notification);
      setTimeout(() => setNotification(''), 5000);
    }
    applyServerState(result.state);
  };

  // Realtime: subscribe to this arena's SSE stream so changes made by other
  // users (an organizer filling a court, a match being scored, the rack
  // shuffling, a player joining/leaving) reflect on this screen within ~1s
  // with no manual refresh. The stream emits the full getState payload; we
  // reconcile only the board, leaving this viewer's own banners intact.
  // The route re-sends the full current state on every (re)connect, so any
  // reconnect is also an instant catch-up. EventSource only self-reconnects
  // when it sees an `error` event — but device sleep, tab backgrounding, and
  // idle NAT timeouts kill the TCP stream SILENTLY: no error fires,
  // readyState stays OPEN, and the stream is a zombie (connected-looking,
  // receives nothing). So we track when we last heard ANYTHING (state frames
  // or the route's 25s `ping` events) and force a fresh connection when the
  // page returns (visibilitychange / pageshow / online) having gone quiet, or
  // when the foreground watchdog notices the same staleness (desktop NAT
  // drops, where visibility never changes). A CLOSED stream (fatal response —
  // EventSource gives up) gets a delayed manual retry. If the stream can't be
  // established at all (e.g. a serverless host that can't hold it open), the
  // app simply falls back to refresh-on-own-action behavior — no errors.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const HEARTBEAT_MS = 25_000; // must match the stream route's ping cadence
    const STALE_AFTER_MS = HEARTBEAT_MS * 2 + 5_000; // two missed pings ⇒ assume dead
    const CLOSED_RETRY_MS = 5_000;
    let source = null;
    let lastHeardAt = Date.now();
    let closedRetryTimer = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      // Cancel any pending CLOSED-retry: if a staleness reconnect (page
      // return) beats the timer — easy, since hidden tabs throttle/freeze
      // setTimeout — the stale timer would otherwise fire afterwards and tear
      // down the freshly-opened healthy stream for a pointless reconnect.
      if (closedRetryTimer) {
        clearTimeout(closedRetryTimer);
        closedRetryTimer = null;
      }
      source?.close();
      source = new EventSource(`/api/arena/${arenaId}/stream`);
      lastHeardAt = Date.now();
      source.addEventListener('state', (event) => {
        lastHeardAt = Date.now();
        try {
          applyServerState(JSON.parse(event.data));
        } catch {
          // Ignore a malformed frame; the next push will resync.
        }
      });
      source.addEventListener('ping', () => {
        lastHeardAt = Date.now();
      });
      source.addEventListener('error', () => {
        // CONNECTING = EventSource is already retrying on its own (honoring
        // the route's `retry: 3000`) — leave it alone. CLOSED = it gave up
        // (e.g. a non-200 response); only that needs a manual delayed retry.
        if (source?.readyState === EventSource.CLOSED && !disposed && !closedRetryTimer) {
          closedRetryTimer = setTimeout(() => {
            closedRetryTimer = null;
            connect();
          }, CLOSED_RETRY_MS);
        }
      });
    };

    // Reconnect when the stream has gone quiet past two heartbeats. Healthy
    // streams never trip this (a ping lands every 25s); a zombie does. Runs
    // on page-return signals and on a foreground interval — background tabs
    // throttle timers, but that's fine: the page-return signals cover the
    // wake-up, the interval covers quiet death while visible.
    const reconnectIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastHeardAt > STALE_AFTER_MS) connect();
    };
    const watchdog = setInterval(reconnectIfStale, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', reconnectIfStale);
    window.addEventListener('pageshow', reconnectIfStale); // bfcache restores
    window.addEventListener('online', reconnectIfStale);

    connect();
    return () => {
      disposed = true;
      clearInterval(watchdog);
      if (closedRetryTimer) clearTimeout(closedRetryTimer);
      document.removeEventListener('visibilitychange', reconnectIfStale);
      window.removeEventListener('pageshow', reconnectIfStale);
      window.removeEventListener('online', reconnectIfStale);
      source?.close();
    };
  }, [arenaId, applyServerState]);

  // Persist the latest board to IndexedDB (throttled to idle time) so the
  // offline shell (/offline-board) can render this arena with no connection:
  // the read-only offline experience. Saved for every viewer, since snapshots
  // hold only board data that is already publicly readable via this page and
  // its SSE stream, plus the viewer's own role flags. Failures are swallowed
  // inside offline-store; a private-mode browser just gets no offline copy.
  // PAUSED during an offline session: the stored snapshot is the base the
  // pending event log replays over, so overwriting it with locally-mutated
  // state would double-apply events on resume/sync.
  useEffect(() => {
    if (offline.offlineActive) return;
    // Also hold while a reload is still resuming: `offlineActive` is false on
    // first paint until the async resume effect activates, and an idle write of
    // the live server props here would clobber the base snapshot the pending
    // log replays over.
    if (offline.resuming) return;
    // requestIdleCallback keeps the write off the interaction path; the
    // timeout fallback covers Safari (no rIC) with a small fixed delay.
    let idleId = null;
    let timerId = null;
    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(persistSnapshot, { timeout: 2000 });
    } else {
      timerId = setTimeout(persistSnapshot, 500);
    }
    return () => {
      if (idleId !== null) window.cancelIdleCallback(idleId);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [
    persistSnapshot,
    offline.offlineActive,
    offline.resuming,
    players,
    queue,
    courts,
    matchHistory,
    history,
    lastSessionResetAt,
  ]);

  // Run a server action inside a transition and reconcile the returned state.
  // `refresh` additionally re-fetches the server-rendered props (used when an
  // action changes data the local `applyResult` state doesn't cover, e.g. the
  // Members tab's walk-in list sourced from `viewerLinkContext`).
  const run = (action, { sound = true, refresh = false } = {}) => {
    startTransition(async () => {
      try {
        const result = await action();
        applyResult(result);
        if (sound) playPaddleSound();
        if (refresh && !result?.error) router.refresh();
      } catch {
        // A server action that throws (rather than returning { error }) is a
        // network/transport failure. Nothing was applied locally, so telling
        // the manager to redo the action is always safe; the offline prompt
        // offers to keep running the board locally.
        setErrorMsg('Connection problem: that change was not saved. Please try again.');
        offline.notifyActionFailed();
      }
    });
  };

  // Offline-mode counterpart of `run`: resolve the command through the local
  // board engine, persist the event, apply the new board, and surface the
  // same error/notification banners the server path uses.
  const runLocalCommand = (command, { sound = true } = {}) => {
    startTransition(async () => {
      const result = await offline.runLocal(command);
      setErrorMsg(result.error || '');
      if (result.error || result.noop) return;
      if (result.notification) {
        setNotification(result.notification);
        setTimeout(() => setNotification(''), 5000);
      }
      if (sound) playPaddleSound();
    });
  };

  const getPartnershipCount = (p1, p2) => {
    if (!history[p1]) return 0;
    return history[p1][p2] || 0;
  };

  const handleShuffleQueue = () => {
    if (!canManage || queue.length < 2) return;
    if (offline.offlineActive) return runLocalCommand({ type: 'shuffleQueue' });
    run(() => shuffleQueue(arenaId));
  };

  const handleFillCourt = (courtId) => {
    if (!canManage) return;
    if (offline.offlineActive) return runLocalCommand({ type: 'fillCourt', courtId });
    run(() => fillCourt(arenaId, courtId));
  };

  // The rack X takes a player off the rack (reversible) rather than deleting
  // them. Works for walk-ins and linked members alike; re-add via the Prep
  // Roster modal's check-in. Permanent deletion lives in the Members tab, so
  // refresh server props after — a walk-in un-racked this session (including
  // one added via Prep Roster after page load) must show up immediately in
  // Members → Walk-ins, which reads from `viewerLinkContext`, not local state.
  const handleUnrackPlayer = (id) => {
    if (!canManage) return;
    // Offline: no `refresh` counterpart exists (server props can't refetch),
    // so the Members walk-in list catches up after the session syncs.
    if (offline.offlineActive) return runLocalCommand({ type: 'checkOut', playerId: id });
    run(() => checkOutPlayer(arenaId, id), { refresh: true });
  };

  // No canManage gate: skip is self-service (a member can rest their own
  // paddle). The server re-authorizes (own paddle or manager), and the Skip
  // button only renders for authorized rows (deriveRackRow `canSkip`).
  //
  // When the manager has `skipPickReplacement` on (the default), instead of
  // firing the action immediately we open a picker modal so the manager
  // chooses which waiting paddle fills the freed on-deck slot. Non-managers
  // (self-rest) always auto-pick the first waiting player, matching the
  // pre-picker behavior. The decision lives here (not in the rack) so the
  // modal renders at the page root, consistent with the score / cancel-fill
  // modals.
  const handleSkipPlayer = (id) => {
    // Only open the picker when there's actually a RENDERABLE waiting paddle to
    // pick (other than the one being skipped). Use the same id→player
    // resolution the modal's list uses (`players.find(...)`), not just raw
    // queue ids, so the open-condition is provably identical to what renders —
    // the manager never lands on a modal with an empty, unconfirmable list.
    const hasWaiting = queue
      .slice(ON_DECK_SIZE)
      .some((qid) => qid !== id && players.some((p) => p.id === qid));
    if (canManage && matchmakingProp.skipPickReplacement && hasWaiting) {
      setSkipPickerSkippedId(id);
      return;
    }
    // Offline mode is manager-only, so `isManager` is always true here.
    if (offline.offlineActive) return runLocalCommand({ type: 'skipPlayer', playerId: id, isManager: true });
    run(() => skipPlayer(arenaId, id));
  };

  // Modal confirm — fire the skip with the picked replacement (chosen inside
  // SkipPickerModal). The server re-validates that the replacement is still
  // in waiting under the queue lock; if it raced, the response surfaces
  // "no longer available" and the modal stays open — the error prop clears
  // the modal's stale pick so the manager picks again from the refreshed list.
  const handleConfirmSkipWithReplacement = (replacementId) => {
    if (!skipPickerSkippedId || !replacementId) return;
    const skippedId = skipPickerSkippedId;
    if (offline.offlineActive) {
      // Mirror the online race handling: the engine returns the same
      // "no longer available" copy when the picked replacement left the
      // waiting pool, and the picker stays open for a re-pick.
      startTransition(async () => {
        const result = await offline.runLocal({
          type: 'skipPlayer',
          playerId: skippedId,
          replacementId,
          isManager: true,
        });
        if (result.error && /no longer available/i.test(result.error)) {
          setSkipPickerError(result.error);
          return;
        }
        setErrorMsg(result.error || '');
        if (result.notification) {
          setNotification(result.notification);
          setTimeout(() => setNotification(''), 5000);
        }
        setSkipPickerError('');
        setSkipPickerSkippedId(null);
      });
      return;
    }
    startTransition(async () => {
      const result = await skipPlayer(arenaId, skippedId, replacementId);
      const raced = result?.error && /no longer available/i.test(result.error);
      if (raced) {
        // Keep the picker open so the manager can pick again. Reconcile the
        // refreshed waiting list (state only — no page banner, which would be
        // hidden behind the modal) and surface the error INSIDE the modal.
        if (result.state) applyResult({ state: result.state });
        setSkipPickerError(result.error);
      } else {
        // Success, or a non-race error (e.g. invalid target / arena gone) that
        // warrants closing — let applyResult drive the page banner as usual.
        applyResult(result);
        setSkipPickerError('');
        setSkipPickerSkippedId(null);
      }
    });
  };

  const handleCancelSkipPicker = () => {
    if (isPending) return; // don't dismiss mid-flight
    setSkipPickerSkippedId(null);
    setSkipPickerError('');
  };

  const handleTriggerScoreModal = (court) => {
    if (!canManage) return;
    setSelectedCourtForScore(court);
    setTeam1Score('');
    setTeam2Score('');
    setScoreModalOpen(true);
  };

  // Open the confirm modal for a court's fill cancellation (manager-only).
  const handleRequestCancelFill = (court) => {
    if (!canManage) return;
    setCourtToCancel(court);
  };

  // Confirmed: return the four to the rack and undo the fill (no match recorded).
  // Keeps the modal open until the action resolves (both buttons are already
  // disabled by isPending), so a race/no-op error doesn't manifest as the modal
  // disappearing followed by a context-free banner.
  const handleConfirmCancelFill = () => {
    if (!courtToCancel) return;
    const courtId = courtToCancel.id;
    if (offline.offlineActive) {
      startTransition(async () => {
        const result = await offline.runLocal({ type: 'cancelFill', courtId });
        setErrorMsg(result.error || '');
        setCourtToCancel(null);
      });
      return;
    }
    startTransition(async () => {
      const result = await cancelFill(arenaId, courtId);
      applyResult(result);
      setCourtToCancel(null);
    });
  };

  // Open the manual team editor for a live court (manager-only). Works
  // offline too: the edit runs through the local board engine.
  const handleRequestEditCourt = (court) => {
    if (!canManage) return;
    setEditError('');
    setCourtToEdit(court);
  };

  // Commit the edited lineup. Mirrors the skip-picker race handling: a stale
  // pick ("no longer available") keeps the editor open with the error inside it
  // so the manager can re-pick from the reconciled rack; any other outcome closes
  // and lets the page banner report it.
  const handleConfirmEditLineup = (team1Ids, team2Ids) => {
    if (!courtToEdit) return;
    const courtId = courtToEdit.id;
    startTransition(async () => {
      // Offline: resolve through the local engine. It mirrors the server's
      // race copy ("rack changed. Please try again."), so the same re-pick
      // path below applies. applyLocalState is driven inside runLocal.
      const result = offline.offlineActive
        ? await offline.runLocal({ type: 'editCourtLineup', courtId, team1Ids, team2Ids })
        : await editCourtLineup(arenaId, courtId, team1Ids, team2Ids);
      const raced = result?.error && /no longer available|Please try again/i.test(result.error);
      if (raced) {
        if (result.state) applyResult({ state: result.state });
        setEditError(result.error);
        // Refresh the editor's court from the reconciled state (it was frozen at
        // open time — a concurrent edit could have changed the on-court four),
        // then remount so the working lineup re-seeds from that authoritative
        // four and drops the now-unavailable pick instead of resubmitting it.
        // Offline, runLocal applies state itself and returns none, so fall back
        // to the live board state (unchanged on a rejected edit).
        const freshCourt = (result.state?.courts ?? courts).find((c) => c.id === courtId);
        if (freshCourt) setCourtToEdit(freshCourt);
        setEditResetKey((k) => k + 1);
      } else {
        applyResult(result);
        setEditError('');
        setCourtToEdit(null);
        // Only chime on a real save — a non-race error (NOT_PLAYING /
        // INVALID_COURT) also lands here and shouldn't sound like success.
        if (!result?.error) playPaddleSound();
      }
    });
  };

  const handleEndMatchWithScore = (courtId, score1, score2) => {
    setScoreModalOpen(false);
    setSelectedCourtForScore(null);
    if (offline.offlineActive) {
      return runLocalCommand({ type: 'endMatch', courtId, score1, score2, autoMix });
    }
    run(() => endMatch(arenaId, courtId, score1, score2, autoMix));
  };

  const handleAddCourt = () => {
    if (!canManage) return;
    if (offline.offlineActive) {
      setErrorMsg(OFFLINE_UNAVAILABLE_MESSAGE);
      return;
    }
    run(() => addCourt(arenaId));
  };

  const handleRemoveCourt = (id) => {
    if (!canManage) return;
    if (offline.offlineActive) {
      setErrorMsg(OFFLINE_UNAVAILABLE_MESSAGE);
      return;
    }
    run(() => removeCourt(arenaId, id));
  };

  /**
   * Cross the session boundary: close the open activity, open `activityId`,
   * then drop the manager straight into the roster modal so they fill the empty
   * rack in one flow.
   *
   * Takes an explicit id so the banner opens exactly the night it displayed —
   * previously the server re-derived "next session" from the schedule at tap
   * time, which could resolve to a different window than the one on screen.
   * Omitting it falls back to that server-side resolution, which is what the
   * Settings → Sessions button still wants.
   */
  const handleStartActivity = (activityId = null) => {
    if (!canManage) return;
    if (offline.offlineActive) {
      setErrorMsg(OFFLINE_UNAVAILABLE_MESSAGE);
      return;
    }
    if (!window.confirm(
      'Start a new session? This empties the rack and starts a fresh partnership matrix so tonight\'s mix is unbiased. Lifetime stats, match history, and the previous session\'s standings are not touched.',
    )) return;
    startTransition(async () => {
      try {
        const result = await startActivity(arenaId, activityId ? { activityId } : {});
        applyResult(result);
        if (!result?.error) {
          // `applyResult` already pulled the server-persisted `currentActivity`
          // out of `result.state`, so the banner and the activity-scoped
          // overlays re-render against the row the server actually opened.
          setRosterModalOpen(true);
        }
      } catch {
        setErrorMsg('Something went wrong preparing the session. Please try again.');
      }
    });
  };

  const handleSaveSchedule = (next) => {
    if (offline.offlineActive) {
      setScheduleError(OFFLINE_UNAVAILABLE_MESSAGE);
      return;
    }
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
    // Partnership Matrix is an opt-in, arena-wide view (Settings → Match
    // Defaults); hidden by default. When absent, the guard below sends a viewer
    // sitting on `stats` back to the courts tab.
    ...(matchDefaults.showPartnershipMatrix ? [{ id: 'stats', label: 'Partnership Matrix' }] : []),
    { id: 'history', label: 'Match Log' },
    {
      id: 'members',
      label: 'Members',
      badge: computeMembersBadge({
        canManage,
        pendingRequests,
        pendingLinkRequests,
        viewerLinkContext,
      }),
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

  // Start an offline session from the connection-lost prompt.
  const handleEnterOffline = () => {
    startTransition(async () => {
      const entered = await offline.enterOffline();
      if (!entered) {
        setErrorMsg('Could not start offline mode on this device (storage unavailable or another tab is already running it).');
      }
    });
  };

  // Discard the offline session WITHOUT syncing: drops the pending log behind
  // an explicit confirm (syncing is the save path). Only meaningful when there
  // are unsynced changes; with none it just returns to the live board.
  const handleExitOffline = () => {
    const message =
      offline.pendingCount > 0
        ? `Discard ${offline.pendingCount} unsynced ${offline.pendingCount === 1 ? 'change' : 'changes'} and return to the live board? They will be lost; sync instead to save them.`
        : 'Leave offline mode and return to the live board?';
    if (!window.confirm(message)) return;
    offline.exitOfflineDiscard();
  };

  // Divergence-dialog discard: same confirm, clearer context.
  const handleDiscardDiverged = () => {
    if (!window.confirm(
      `Discard ${offline.pendingCount} offline ${offline.pendingCount === 1 ? 'change' : 'changes'} and return to the live board? This cannot be undone.`,
    )) return;
    offline.exitOfflineDiscard();
  };

  const handleCopyOfflineLog = () => {
    startTransition(async () => {
      const copied = await offline.copyLogJson();
      setCopiedOfflineLog(copied);
      if (!copied) setErrorMsg('Could not copy to the clipboard on this device.');
    });
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

      <SiteHeader variant="home">
        <AuthStatus />
      </SiteHeader>

      <ArenaHero
        arenaId={arenaId}
        arenaName={arenaName}
        description={description}
        scheduleLabel={hasConfiguredSchedule(schedule) ? describeSchedule(schedule) : null}
        playerCount={players.length}
        queueLength={queue.length}
        liveCourtCount={liveCourtCount}
        canManage={canManage}
        invites={invites}
      />

      {offline.offlineActive && (
        <OfflineActiveBanner
          pendingCount={offline.pendingCount}
          syncing={offline.syncState.status === 'syncing'}
          syncError={offline.syncState.error}
          onSync={() => offline.syncNow('strict')}
          onDiscard={handleExitOffline}
        />
      )}
      {!offline.offlineActive && offline.promptVisible && canManage && (
        <OfflinePromptBanner
          blocked={offline.otherTabActive}
          onEnter={handleEnterOffline}
          onDismiss={offline.dismissPrompt}
        />
      )}
      {/* Advisory: someone ELSE is running this board offline. Hidden on the
          holding device itself (it shows the offline banner instead), once the
          hold stamp ages past the TTL (a lost device never releases), and
          while the connection-lost prompt is up (all three banners share one
          floating slot), so the actionable prompt takes precedence over
          this informational notice rather than painting on top of it. */}
      {!offline.offlineActive && !offline.promptVisible && isHoldActive(offlineHold) && (
        <OfflineHoldNotice label={offlineHold.label} />
      )}

      {offline.syncState.status === 'divergence' && (
        <OfflineDivergenceDialog
          pendingCount={offline.pendingCount}
          syncing={false}
          onBestEffort={() => offline.syncNow('best-effort')}
          onDiscard={handleDiscardDiverged}
          onKeepOffline={offline.dismissSyncState}
        />
      )}
      {offline.syncState.status === 'blocked' && (
        <OfflineBlockedDialog
          error={offline.syncState.error}
          copied={copiedOfflineLog}
          onCopy={handleCopyOfflineLog}
          onDiscard={handleDiscardDiverged}
          onClose={() => {
            setCopiedOfflineLog(false);
            offline.dismissSyncState();
          }}
        />
      )}

      <ArenaActivityBanner
        arenaId={arenaId}
        canManage={canManage}
        currentActivity={currentActivity}
        nextActivity={nextActivity}
        autoResetOnSession={sessionPrep.autoResetOnSession}
        checkedInCount={queue.length}
        isPending={isPending}
        onStartActivity={handleStartActivity}
        onOpenRoster={() => setRosterModalOpen(true)}
      />

      {!canManage && !viewerNoticeDismissed && (
        <div className="mt-2 w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
          <div
            role="status"
            className="relative p-4 pr-10 bg-emerald-50/95 backdrop-blur border border-emerald-200 text-emerald-900 rounded-2xl shadow-lg shadow-emerald-900/10 flex flex-col items-center text-center gap-3 animate-fade-in"
          >
            <button
              onClick={dismissViewerNotice}
              aria-label="Dismiss notice"
              className="absolute top-3 right-3 grid place-items-center h-7 w-7 rounded-lg text-emerald-700/70 hover:text-emerald-900 hover:bg-emerald-100 transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 shrink-0 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <p className="text-sm font-semibold leading-snug">
                {viewerRole
                  ? "You're a member of this arena. An owner can promote you to organizer to manage it."
                  : "You're viewing this arena. Only its owner and organizers can manage it."}
              </p>
            </div>
            {isAuthenticated && !viewerRole && viewerPending && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 font-bold px-3 py-1.5 rounded-lg">
                Request pending approval
              </span>
            )}
            {isAuthenticated && !viewerRole && !viewerPending && (
              <button
                onClick={handleRequestJoin}
                disabled={isPending}
                className="text-sm bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg transition"
              >
                Request to join
              </button>
            )}
            {!isAuthenticated && (
              <Link href="/login" className="text-sm bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-4 py-2 rounded-lg transition">
                Sign in to join
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Success notification — floating toast, bottom-right. Fixed (not in
          flow) so it overlays instead of shoving the layout down. Sits below
          modals (z-[100]). Auto-dismisses after 5s; also dismissible. */}
      {notification && (
        <div className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm">
          <div
            role="status"
            className="relative overflow-hidden flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/95 to-teal-50/90 px-4 py-3 text-emerald-900 shadow-xl shadow-emerald-900/10 ring-1 ring-emerald-900/5 backdrop-blur-md animate-fade-in"
          >
            <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-emerald-300/20 blur-2xl" />
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{notification}</p>
            <button
              type="button"
              onClick={() => setNotification('')}
              aria-label="Dismiss notification"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-emerald-700/60 transition hover:bg-emerald-500/10 hover:text-emerald-900"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Desktop sticky tab bar — sits below the SiteHeader on `md+`, pinned
          so users can switch tabs after scrolling deep into Match Log etc.
          The `top` offset is the live SiteHeader height — published as
          `--site-header-h` by the ResizeObserver above — so the bar tucks
          right beneath it on any header size. The 64px fallback matches the
          mobile strip and keeps the bar pinned correctly on the very first
          paint, before the observer fires. Hidden on mobile (the bottom
          sheet handles that). */}
      <div
        ref={tabBarRef}
        className="hidden md:block sticky top-[var(--site-header-h,64px)] z-30 bg-slate-50/85 backdrop-blur-md border-y border-slate-200/70"
      >
        <div
          role="tablist"
          aria-label="Arena views"
          onKeyDown={handleTabKeyDown}
          className="w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-2.5 flex gap-1.5 overflow-x-auto"
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
                className={`group relative shrink-0 inline-flex items-center gap-2 rounded-full
                  px-4 py-2.5 text-sm font-extrabold tracking-tight
                  transition-all duration-200 ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm shadow-slate-900/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white ring-1 ring-transparent hover:ring-slate-200'
                }`}
              >
                <TabIcon
                  id={tab.id}
                  className={`w-4 h-4 ${isActive ? 'text-emerald-300' : 'text-slate-400 group-hover:text-slate-500'}`}
                />
                <span>{tab.label}</span>
                <TabBadge value={tab.badge} active={isActive} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile: sticky scrollable tab strip + bottom-sheet drawer. Rendered
          OUTSIDE the main grid so it spans the page width. */}
      <ArenaMobileNav
        navTabs={navTabs}
        activeTab={activeTab}
        activeTabLabel={activeTabLabel}
        onSelectTab={handleSelectTab}
      />

      {/* Main Grid Workspace
          The PaddleRack is rendered in two positions so DOM order always
          matches visual order at every breakpoint:
            • Position 1 (desktop-only): left sidebar, first in DOM → correct
              left-to-right focus order on lg+.
            • Position 2 (mobile-only): below the tab content, second in DOM →
              correct top-to-bottom focus order on mobile.
          Only one is visible at a time via responsive display utilities. */}
      <main className="flex-1 p-4 pb-28 md:p-6 md:pb-8 lg:p-8 lg:pb-10 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* Left Column: PaddleRack — desktop only (hidden below lg).
            First in DOM so keyboard focus flows left → right on lg+. */}
        <div
          style={{ top: headerHeight + tabBarHeight }}
          className="hidden lg:block lg:col-span-5 lg:sticky lg:self-start space-y-6"
        >
          <PaddleRackStack
            idPrefix="rack-desktop"
            queue={queue}
            players={displayPlayers}
            canManage={canManage}
            viewerUserId={viewerUserId}
            viewerIsMember={viewerRole !== null}
            autoMix={autoMix}
            onToggleAutoMix={setAutoMix}
            onAddPlayers={() => setRosterModalOpen(true)}
            onShuffle={handleShuffleQueue}
            onUnrackPlayer={handleUnrackPlayer}
            onSkipPlayer={handleSkipPlayer}
            isPending={isPending}
            starveThreshold={matchmakingProp.starveThreshold}
            emergencyWait={matchmakingProp.emergencyWait}
            skipRestoresPriority={matchmakingProp.skipRestoresPriority}
            errorMsg={errorMsg}
          />
        </div>

        {/* Right Column: Tab content */}
        <div className="lg:col-span-7 space-y-6">

          {/* Scroll target — selecting a tab on mobile scrolls here. */}
          <div ref={contentAnchorRef} className="scroll-mt-24" aria-hidden="true" />

          <ArenaContentSwipe
            navTabs={navTabs}
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
          >

          {activeTab === 'courts' && (
            <ArenaCourtsPanel
              courts={courts}
              players={displayPlayers}
              canManage={canManage}
              isPending={isPending}
              queueLength={queue.length}
              onAddCourt={handleAddCourt}
              onFinishCourt={handleTriggerScoreModal}
              onEditCourt={handleRequestEditCourt}
              onCancelCourt={handleRequestCancelFill}
              onFillCourt={handleFillCourt}
              onRemoveCourt={handleRemoveCourt}
              profileHrefFor={playerProfileHrefFor}
            />
          )}

          {activeTab === 'thisweek' && (
            <div
              role="tabpanel"
              id="arena-panel-thisweek"
              aria-labelledby="arena-tab-thisweek"
            >
              <ArenaThisWeek
                leaderboard={leaderboard}
                myPlayerId={myPlayer?.id ?? null}
                profileHrefFor={playerProfileHrefFor}
                scheduleLabel={hasConfiguredSchedule(schedule) ? describeSchedule(schedule) : null}
                canManage={canManage}
                onEditSchedule={() => setScheduleModalOpen(true)}
              />
            </div>
          )}

          {activeTab === 'stats' && matchDefaults.showPartnershipMatrix && (
            <div
              role="tabpanel"
              id="arena-panel-stats"
              aria-labelledby="arena-tab-stats"
              className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in"
            >
              <div>
                <h3 className="font-display text-base md:text-lg font-extrabold tracking-tight text-slate-900">
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
            <ArenaHistory
              matches={matchHistory}
              formatTimestamp={formatTimestamp}
              profileHrefFor={playerProfileHrefFor}
            />
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
                onCourtPlayerIds={onCourtPlayerIds}
                onCourtUserIds={onCourtUserIds}
              />
            </div>
          )}

          {activeTab === 'mystats' && myPlayer && (
            <ArenaMyStats
              myPlayer={myPlayer}
              matchHistory={matchHistory}
              activityId={currentActivityId}
              queue={queue}
              courts={courts}
              formatTimestamp={formatTimestamp}
            />
          )}

          </ArenaContentSwipe>
        </div>

        {/* PaddleRack — mobile only (hidden at lg+, where the desktop
            instance above takes over). Visible below lg only on the
            Active Courts tab; hidden on all other tabs. Second in DOM
            so mobile keyboard focus flows top → bottom (courts → rack). */}
        <div className={`space-y-6 ${activeTab === 'courts' ? 'lg:hidden' : 'hidden'}`}>
          <PaddleRackStack
            idPrefix="rack-mobile"
            queue={queue}
            players={displayPlayers}
            canManage={canManage}
            viewerUserId={viewerUserId}
            viewerIsMember={viewerRole !== null}
            autoMix={autoMix}
            onToggleAutoMix={setAutoMix}
            onAddPlayers={() => setRosterModalOpen(true)}
            onShuffle={handleShuffleQueue}
            onUnrackPlayer={handleUnrackPlayer}
            onSkipPlayer={handleSkipPlayer}
            isPending={isPending}
            starveThreshold={matchmakingProp.starveThreshold}
            emergencyWait={matchmakingProp.emergencyWait}
            skipRestoresPriority={matchmakingProp.skipRestoresPriority}
            errorMsg={errorMsg}
          />
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

      {/* Prep Roster modal (owner or organizer). Each toggle hits a server
          action immediately; the parent reconciles state via applyResult. */}
      {rosterModalOpen && canManage && (
        <ArenaPrepRosterModal
          arenaId={arenaId}
          members={members}
          players={displayPlayers}
          queue={queue}
          pendingRequests={pendingRequests}
          pendingLinkRequests={pendingLinkRequests}
          attendees={activityAttendees}
          activityId={currentActivityId}
          onApplyResult={applyResult}
          offlineRunLocal={offline.offlineActive ? offline.runLocal : null}
          onClose={() => setRosterModalOpen(false)}
        />
      )}

      {/* Manual team editor — drag to swap partners, substitute from the deck/
          waiting list. Commits the final lineup via editCourtLineup. The modal
          owns its own portal (same PWA-safe rule as the others). */}
      {mounted && courtToEdit && (
        <CourtEditModal
          key={editResetKey}
          court={courtToEdit}
          players={displayPlayers}
          queue={queue}
          isPending={isPending}
          error={editError}
          onSave={handleConfirmEditLineup}
          onClose={() => {
            setCourtToEdit(null);
            setEditError('');
          }}
        />
      )}

      {/* Cancel-Fill Confirm Modal — guards the destructive "return to deck"
          action so it can't fire on a stray click. Confirming sends the four
          back to their original rack spots without recording a match.
          Rendered via portal to document.body so no ancestor's
          overflow/transform/filter can clip this fixed overlay (the project's
          PWA-safe modal rule, mirroring ArenaMobileSheet). */}
      {mounted && courtToCancel && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            // Ignore backdrop dismiss while the cancel is in flight; both
            // buttons are already disabled, and Esc is suppressed too, so the
            // modal stays put until the result lands.
            if (e.target === e.currentTarget && !isPending) setCourtToCancel(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-fill-title"
            aria-describedby="cancel-fill-desc"
            className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full shadow-xl animate-scale-up overflow-hidden"
          >
            <div className="px-5 py-5">
              <h3 id="cancel-fill-title" className="font-extrabold text-slate-900 text-base">
                Cancel this match?
              </h3>
              <p id="cancel-fill-desc" className="text-sm text-slate-600 mt-2 leading-relaxed">
                The four players on{' '}
                <span className="font-bold text-slate-800">{courtToCancel.name}</span>{' '}
                go back to the front of the rack in their original order.{' '}
                <span className="font-semibold">No game is recorded</span> — no scores, wins,
                losses, or rating changes.
              </p>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setCourtToCancel(null)}
                disabled={isPending}
                className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-200/60 disabled:opacity-50 font-bold text-xs uppercase tracking-wide transition"
              >
                Keep Playing
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelFill}
                disabled={isPending}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs uppercase tracking-wide transition shadow-sm shadow-red-600/20"
              >
                Cancel & Return to Deck
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Skip + Pick Replacement Modal — manager picks who fills the freed
          on-deck slot when skipping a paddle. Self-contained component (own
          portal, Esc handler, scroll lock, selection state); this parent
          owns the open trigger, the server action, and the race error fed
          back in via `error`. See skip-picker-modal.js. */}
      {mounted && skipPickerSkippedId && (
        <SkipPickerModal
          skippedId={skipPickerSkippedId}
          players={displayPlayers}
          queue={queue}
          isPending={isPending}
          error={skipPickerError}
          onConfirm={handleConfirmSkipWithReplacement}
          onClose={handleCancelSkipPicker}
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
                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm shadow-emerald-700/20'
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
