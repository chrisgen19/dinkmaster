'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { rsvpToActivity } from './actions';

/**
 * "I'm going" / "Can't make it" for one activity.
 *
 * Optimistic with rollback, following the `saveToggle` pattern in
 * arena-settings.js: the buttons flip immediately, and a failed write puts the
 * previous answer back with the server's message. Because going past a capacity
 * lands on the WAITLIST rather than GOING, the optimistic value is a guess — the
 * server's actual result replaces it either way, which is why the response
 * carries the resulting status.
 *
 * @param {object} props
 * @param {string} props.activityId
 * @param {{status:string, position:number|null}|null} props.viewerRsvp - the viewer's row, or null
 * @param {boolean} props.canRsvp - false for spectators, non-members, and arenas with RSVP off
 * @param {string|null} [props.disabledReason] - why the controls are inert, shown in place of them
 * @param {'full'|'compact'} [props.size]
 */
export function ArenaActivityRsvp({
  activityId,
  viewerRsvp,
  canRsvp,
  disabledReason = null,
  size = 'full',
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rsvp, setRsvp] = useState(viewerRsvp);
  const [error, setError] = useState('');

  if (!canRsvp) {
    return disabledReason ? <p className="text-xs text-slate-400">{disabledReason}</p> : null;
  }

  const answer = (status) => {
    const previous = rsvp;
    setError('');
    // Optimistic: GOING may come back as WAITLIST when the activity is full, so
    // this is a best guess that the server response immediately corrects.
    setRsvp({ status, position: null });
    startTransition(async () => {
      try {
        const result = await rsvpToActivity(activityId, status);
        if (result?.error) {
          setRsvp(previous);
          setError(result.error);
          return;
        }
        setRsvp({ status: result.status, position: null });
        // Counts, the waitlist, and anyone promoted by this change all live in
        // server-rendered markup, so pull a fresh copy rather than trying to
        // reproduce the promotion logic on the client.
        router.refresh();
      } catch {
        setRsvp(previous);
        setError('Could not save your RSVP. Please try again.');
      }
    });
  };

  const status = rsvp?.status ?? null;
  const going = status === 'GOING' || status === 'CHECKED_IN';
  const declined = status === 'DECLINED';
  const waitlisted = status === 'WAITLIST';
  const compact = size === 'compact';

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => answer('GOING')}
          disabled={isPending}
          aria-pressed={going || waitlisted}
          className={`inline-flex items-center gap-1.5 rounded-xl font-bold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${
            compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
          } ${
            going || waitlisted
              ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {waitlisted ? 'On the waitlist' : "I'm going"}
        </button>

        <button
          type="button"
          onClick={() => answer('DECLINED')}
          disabled={isPending}
          aria-pressed={declined}
          className={`inline-flex items-center gap-1.5 rounded-xl font-bold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${
            compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
          } ${
            declined
              ? 'bg-slate-700 text-white shadow-sm hover:bg-slate-800'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          Can’t make it
        </button>
      </div>

      {waitlisted && (
        <p className="text-xs font-medium text-amber-700">
          The session is full — you’ll move up automatically if someone drops.
        </p>
      )}
      {status === 'CHECKED_IN' && (
        <p className="text-xs font-medium text-emerald-700">You’re checked in.</p>
      )}
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}
