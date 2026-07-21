'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ON_DECK_SIZE } from '@/lib/matchmaking';
import { listArenaSnapshots, loadArenaSnapshot, loadPendingLog } from '@/lib/offline-store';
import Arena from '../arena';
import { replayEvents } from '../arena-offline-state';
import { RetryButton } from '../offline/retry-button';

/** Display name: "First Last", or just "First" when no last name is set. */
const fullName = (p) => (p?.lastName ? `${p.firstName} ${p.lastName}` : p?.firstName ?? 'Unknown');

/** Arena id when the shell was served as the SW fallback for /arena/[id]. */
function arenaIdFromLocation() {
  const match = window.location.pathname.match(/^\/arena\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

/**
 * Rebuild the freshest local board: the saved snapshot plus any pending
 * offline events replayed through the pure engine. The pending log stores the
 * settings snapshot the events were resolved under; fall back to the arena
 * snapshot's props for a log written before entry (defensive only).
 */
function buildLocalBoard(snapshot, pending) {
  const settings =
    pending?.settings ?? { targetScore: snapshot.matchDefaults?.targetScore, ...snapshot.matchmaking };
  const { state } = replayEvents(snapshot.state, settings, pending?.events);
  // Report every recorded event as unsynced, not just the ones that replayed
  // for display: if replay stopped early on a mismatch, the un-replayed events
  // are still waiting to sync and the banner must not undercount them.
  return { state, pendingCount: pending?.events?.length ?? 0 };
}

function OfflineCourtCard({ court, playersById }) {
  const names = (ids) => ids.map((id) => fullName(playersById.get(id))).join(' & ');
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display font-bold text-slate-900">{court.name}</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
            court.status === 'playing'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-100 text-slate-500'
          }`}
        >
          {court.status === 'playing' ? 'Playing' : 'Vacant'}
        </span>
      </div>
      {court.status === 'playing' ? (
        <div className="mt-3 space-y-1 text-sm text-slate-700">
          <p className="truncate">{names(court.team1)}</p>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">vs</p>
          <p className="truncate">{names(court.team2)}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">No match in progress.</p>
      )}
    </div>
  );
}

function OfflineRack({ queue, playersById }) {
  if (queue.length === 0) {
    return <p className="text-sm text-slate-400">The rack is empty.</p>;
  }
  return (
    <ol className="space-y-1.5">
      {queue.map((id, index) => {
        const onDeck = index < ON_DECK_SIZE;
        return (
          <li
            key={id}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
              onDeck ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'
            }`}
          >
            <span
              className={`w-6 shrink-0 text-center text-xs font-bold ${
                onDeck ? 'text-emerald-700' : 'text-slate-400'
              }`}
            >
              {index + 1}
            </span>
            <span className="truncate font-medium text-slate-800">
              {fullName(playersById.get(id))}
            </span>
            {onDeck && (
              <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                On deck
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Offline arena directory: what the manager sees when they launch the app
 * (`/arenas`, the PWA start_url) with no connection. Lists every arena saved
 * in IndexedDB so they can still open a board, instead of the dead-end
 * generic offline page.
 */
function OfflineDirectory({ snapshots }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* unoptimized so it hits the precached raw icon path; the
                /_next/image optimizer route isn't available offline. */}
            <Image
              src="/icons/icon-192.png"
              alt=""
              width={36}
              height={36}
              unoptimized
              className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-inset ring-slate-200"
            />
            <div className="min-w-0">
              <p className="font-display font-extrabold leading-none text-slate-900">DinkMaster</p>
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Offline
              </p>
            </div>
          </div>
          <RetryButton />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6 md:px-6">
        <h1 className="font-display text-xl font-extrabold tracking-tight text-slate-900">
          Your arenas
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Saved for offline use. Open one to see its last board; reconnect for the latest.
        </p>

        {snapshots.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
            No arena has been saved yet. Open an arena while online and it will appear
            here next time.
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {snapshots.map((s) => (
              <li key={s.arenaId}>
                <a
                  href={`/arena/${s.arenaId}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-slate-900">{s.arenaName}</span>
                    <span className="block text-xs text-slate-400">
                      Saved {new Date(s.savedAt).toLocaleString()}
                    </span>
                  </span>
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 text-slate-300"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

/**
 * Client shell that renders the last saved arena board from IndexedDB while
 * offline. Read-only by design in Phase 1: every mutation still requires the
 * live arena page.
 */
export function OfflineBoardShell() {
  // 'loading' → one of: 'board' (snapshot found), 'index' (direct visit),
  // 'missing' (arena URL but nothing saved for it).
  const [view, setView] = useState({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const arenaId = arenaIdFromLocation();
      if (!arenaId) {
        const snapshots = await listArenaSnapshots();
        if (!cancelled) setView({ kind: 'index', snapshots });
        return;
      }
      const snapshot = await loadArenaSnapshot(arenaId);
      if (!snapshot) {
        if (!cancelled) setView({ kind: 'missing' });
        return;
      }
      const pending = await loadPendingLog(arenaId);
      const { state, pendingCount } = buildLocalBoard(snapshot, pending);
      if (!cancelled) setView({ kind: 'board', snapshot, state, pendingCount });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (view.kind === 'loading') {
    return <main className="min-h-screen bg-slate-50" />;
  }

  // Launched offline at /arenas: show the directory of saved arenas.
  if (view.kind === 'index') {
    return <OfflineDirectory snapshots={view.snapshots} />;
  }

  // Arena URL, but nothing saved for it: a dead end until reconnect.
  if (view.kind === 'missing') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center bg-slate-50">
        <h1 className="font-display text-2xl font-bold text-slate-900">You&apos;re offline</h1>
        <p className="max-w-sm text-sm text-slate-500">
          This arena hasn&apos;t been saved for offline use yet. Reconnect to load it
          once, and it will be available offline afterwards.
        </p>
        <RetryButton />
      </main>
    );
  }

  const { snapshot, state, pendingCount } = view;

  // A manager gets the FULL interactive board, mounted from the snapshot and
  // started in offline mode (offlineBoot). This is what lets them RESUME an
  // offline session that was interrupted (app closed, phone locked) while
  // still offline, and keep running the board: check in/out, fill, score,
  // skip, edit teams. Server-only props (members, requests, invites) are
  // omitted from the snapshot and default to empty offline. Spectators, who
  // can't run the board anyway, get the lightweight read-only view below.
  if (snapshot.canManage) {
    return (
      <Arena
        initialState={state}
        arenaId={snapshot.arenaId}
        arenaName={snapshot.arenaName}
        description={snapshot.description}
        schedule={snapshot.schedule}
        matchmaking={snapshot.matchmaking}
        matchDefaults={snapshot.matchDefaults}
        sessionPrep={snapshot.sessionPrep}
        canManage={snapshot.canManage}
        viewerRole={snapshot.viewerRole}
        viewerUserId={snapshot.viewerUserId}
        isAuthenticated={snapshot.isAuthenticated ?? true}
        offlineBoot
      />
    );
  }

  const playersById = new Map(state.players.map((p) => [p.id, p]));

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm font-medium text-amber-900">
        Offline — showing the board saved {new Date(snapshot.savedAt).toLocaleString()}
        {pendingCount > 0 && ` (+${pendingCount} unsynced ${pendingCount === 1 ? 'change' : 'changes'})`}
      </div>

      <div className="mx-auto max-w-3xl px-4 pt-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">
            {snapshot.arenaName}
          </h1>
          <RetryButton />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Read-only offline view. Reconnect to run the board.
        </p>

        <h2 className="mt-6 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Courts
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {state.courts.map((court) => (
            <OfflineCourtCard key={court.id} court={court} playersById={playersById} />
          ))}
          {state.courts.length === 0 && (
            <p className="text-sm text-slate-400">No courts configured.</p>
          )}
        </div>

        <h2 className="mt-8 mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Paddle rack ({state.queue.length} waiting)
        </h2>
        <OfflineRack queue={state.queue} playersById={playersById} />
      </div>
    </main>
  );
}
