'use client';

import { useEffect, useState } from 'react';
import { applyEvent } from '@/lib/board-engine';
import { ON_DECK_SIZE } from '@/lib/matchmaking';
import { listArenaSnapshots, loadArenaSnapshot, loadPendingLog } from '@/lib/offline-store';
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
 * offline events replayed through the pure engine (none exist until Phase 2
 * ships writes; the hook keeps this shell forward-compatible). Stops at the
 * first event that no longer applies rather than guessing.
 */
function buildLocalBoard(snapshot, pending) {
  let state = snapshot.state;
  let pendingCount = 0;
  const settings = { targetScore: snapshot.matchDefaults?.targetScore, ...snapshot.matchmaking };
  for (const event of pending?.events ?? []) {
    const result = applyEvent(state, settings, event);
    if (result.error || !result.changed) break;
    state = result.state;
    pendingCount++;
  }
  return { state, pendingCount };
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

function SnapshotIndex({ snapshots }) {
  if (snapshots.length === 0) {
    return (
      <p className="max-w-sm text-sm text-slate-500">
        No arena has been saved for offline use yet. Open an arena while online
        and it will be available here next time.
      </p>
    );
  }
  return (
    <ul className="w-full max-w-sm space-y-2 text-left">
      {snapshots.map((s) => (
        <li key={s.arenaId}>
          <a
            href={`/arena/${s.arenaId}`}
            className="block rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-emerald-300"
          >
            <span className="block truncate font-semibold text-slate-900">{s.arenaName}</span>
            <span className="block text-xs text-slate-500">
              Saved {new Date(s.savedAt).toLocaleString()}
            </span>
          </a>
        </li>
      ))}
    </ul>
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

  if (view.kind !== 'board') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center bg-slate-50">
        <h1 className="font-display text-2xl font-bold text-slate-900">You&apos;re offline</h1>
        {view.kind === 'index' ? (
          <SnapshotIndex snapshots={view.snapshots} />
        ) : (
          <p className="max-w-sm text-sm text-slate-500">
            This arena hasn&apos;t been saved for offline use yet. Reconnect to
            load it once, and it will be available offline afterwards.
          </p>
        )}
        <RetryButton />
      </main>
    );
  }

  const { snapshot, state, pendingCount } = view;
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
