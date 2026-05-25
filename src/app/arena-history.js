'use client';

import { useMemo } from 'react';
import { MatchHistory } from './match-history';
import { toMatch } from '@/lib/match-history';

/**
 * History tab: read-only ledger of completed matches with final scores and
 * team rosters. Names shown here are snapshots stored on the match record, so
 * they survive deletion of the originating player (see the deletion warning
 * in [[arena-members]]).
 *
 * Thin adapter over the shared <MatchHistory> component — converts arena's
 * `{team1, team2, score1, score2}` shape into the unified `Match` shape and
 * renders in `neutral` perspective.
 */
export function ArenaHistory({ matches, formatTimestamp }) {
  const normalised = useMemo(() => matches.map((m) => toMatch(m)), [matches]);

  return (
    <div
      role="tabpanel"
      id="arena-panel-history"
      aria-labelledby="arena-tab-history"
    >
      <MatchHistory
        matches={normalised}
        perspective="neutral"
        title="Match History Log"
        description="Complete ledger of finished matches, final scores, and team results."
        formatTimestamp={formatTimestamp}
      />
    </div>
  );
}
