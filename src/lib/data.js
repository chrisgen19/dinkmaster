import { prisma } from '@/lib/prisma';
import { nextStateStamp } from '@/lib/state-freshness';

/**
 * Build the full arena state in the exact shape the UI consumes, scoped to a
 * single arena.
 *
 * @param {string} arenaId - the arena whose players/courts/matches to read
 * @returns {Promise<{
 *   fetchedAt: number,
 *   players: Array<{id:string,userId:string|null,firstName:string,lastName:string|null,gamesPlayed:number,wins:number,losses:number,waitRounds:number,rating:number,skipBoosted:boolean,gamesOffset:number}>,
 *   queue: string[],
 *   courts: Array<{id:string,name:string,status:string,team1:string[],team2:string[],fillBumpedPlayerIds:string[],slots:Array<{playerId:string,team:number,prevQueueOrder:number|null,prevWaitRounds:number|null}>}>,
 *   matchHistory: Array<{id:string,courtName:string,team1:Array<{id:string,firstName:string,lastName:string|null}>,team2:Array<{id:string,firstName:string,lastName:string|null}>,score1:number,score2:number,timestamp:string}>,
 *   history: Record<string, Record<string, number>>,
 *   lastSessionResetAt: string|null,
 *   offlineHold: {label:string, heldAt:string}|null
 * }>}
 */
export async function getState(arenaId) {
  // Guard against an undefined arenaId: Prisma drops `where: { arenaId: undefined }`
  // entirely, which would read every arena's data instead of one.
  if (!arenaId) throw new Error('getState requires an arenaId');

  // Stamp at read START, not finish. Concurrent getState calls exist by
  // design (SSE initial snapshot vs. hub pump vs. action responses), and a
  // slow read that began BEFORE a commit must not outrank a fast read that
  // began after it. With a strictly increasing start stamp the ordering is
  // sound: every board commit fires a NOTIFY trigger, the resulting pump read
  // starts after the commit (so it sees it — READ COMMITTED) and carries a
  // strictly higher stamp than any pre-commit read, so the fresh frame always
  // wins the client's monotonic guard and a stale late-finisher is discarded.
  const fetchedAt = nextStateStamp();

  const [players, courts, matches, partnerships, arena] = await Promise.all([
    // Active players only: a departed member's row is kept (leftAt set) for
    // history but must not appear on the rack, matrix, or player count.
    prisma.player.findMany({ where: { arenaId, leftAt: null }, orderBy: { createdAt: 'asc' } }),
    prisma.court.findMany({
      where: { arenaId },
      orderBy: { position: 'asc' },
      include: { slots: true },
    }),
    prisma.match.findMany({
      where: { arenaId },
      // The id tie-break matters: `deleteMatch` picks the newest row with the
      // same ordering, and the arena's ledger offers its delete affordance on
      // whichever row lands first here. Ordering by `createdAt` alone lets the
      // two disagree when rows share a timestamp (possible for matches synced
      // from an older offline batch), putting the button on a row the server
      // would refuse.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { players: true },
    }),
    prisma.partnership.findMany({ where: { arenaId } }),
    // Session boundary lives on Arena. We surface it on every refresh so the
    // client can key session-scoped stats (rack tile, My Stats) off the
    // server-persisted timestamp instead of a client-stamped `new Date()`,
    // which would drift under clock skew / network latency around a reset.
    prisma.arena.findUnique({
      where: { id: arenaId },
      select: {
        lastSessionResetAt: true,
        offlineHolderLabel: true,
        offlineHeldAt: true,
        // Win/lose deck alternation pointer. Board STATE, not a setting: the
        // rack UI names the deck that stacks next, and the offline engine has
        // to fork from the same value the server holds.
        lastDeckFilled: true,
        // This one IS a setting, and the only matchmaking setting that rides
        // the board stream. It has to, because it decides WHICH FOUR the client
        // names in `fillCourt`'s `expected` guard: a client holding a stale
        // value sends the wrong four, the server refuses, and — since the
        // refusal response carries this state — it would otherwise never learn
        // better and every retry would fail the same way. The other
        // matchmaking settings only tint badges or steer server-side choices,
        // so they stay on the page props.
        splitDeckByResult: true,
      },
    }),
  ]);

  const queue = players
    .filter((p) => p.queueOrder !== null)
    .sort((a, b) => a.queueOrder - b.queueOrder)
    .map((p) => p.id);

  const courtState = courts.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    team1: c.slots.filter((s) => s.team === 1).map((s) => s.playerId),
    team2: c.slots.filter((s) => s.team === 2).map((s) => s.playerId),
    // Fill bookkeeping, surfaced so the offline board engine can mirror
    // cancelFill/endMatch exactly. Board data is already public via the SSE
    // stream, and these are non-sensitive ints/id arrays.
    fillBumpedPlayerIds: c.fillBumpedPlayerIds,
    fillPrevDeck: c.fillPrevDeck,
    slots: c.slots.map((s) => ({
      playerId: s.playerId,
      team: s.team,
      prevQueueOrder: s.prevQueueOrder,
      prevWaitRounds: s.prevWaitRounds,
    })),
  }));

  // Use the snapshotted names so history survives player deletion.
  const teamSnapshot = (m, team) =>
    m.players
      .filter((mp) => mp.team === team)
      .map((mp) => ({ id: mp.playerId, firstName: mp.playerFirstName, lastName: mp.playerLastName }));

  const matchHistory = matches.map((m) => ({
    id: m.id,
    courtName: m.courtName,
    team1: teamSnapshot(m, 1),
    team2: teamSnapshot(m, 2),
    score1: m.score1,
    score2: m.score2,
    // The target this match was played under, so the correction dialog states
    // the rule the server will actually validate against. Null for matches
    // recorded before it was captured; the client falls back to the arena's
    // current setting exactly as `updateMatchScore` does.
    targetScore: m.targetScore,
    // Set when a manager corrected this scoreline after the fact; the ledger
    // marks those rows so a rewrite isn't invisible to the people who played.
    // Null for every match that has never been edited.
    editedAt: m.editedAt ? new Date(m.editedAt).toISOString() : null,
    // ISO string; formatted in the client so it uses the viewer's locale/timezone.
    timestamp: new Date(m.createdAt).toISOString(),
  }));

  // Expand canonical partnership rows into the symmetric matrix the UI reads.
  const history = {};
  for (const { playerA, playerB, count } of partnerships) {
    (history[playerA] ??= {})[playerB] = count;
    (history[playerB] ??= {})[playerA] = count;
  }

  return {
    // Read-start stamp (see above) so the client can discard a snapshot older
    // than one it already applied — preventing a slow action response from
    // clobbering a newer SSE push, and vice-versa.
    fetchedAt,
    players: players.map((p) => ({
      id: p.id,
      userId: p.userId,
      firstName: p.firstName,
      lastName: p.lastName,
      gamesPlayed: p.gamesPlayed,
      wins: p.wins,
      losses: p.losses,
      waitRounds: p.waitRounds,
      rating: p.rating,
      skipBoosted: p.skipBoosted,
      // Needed by the offline board engine: check-in re-anchors gamesOffset to
      // the group average, and auto-mix sorts by gamesPlayed + gamesOffset.
      gamesOffset: p.gamesOffset,
    })),
    queue,
    courts: courtState,
    matchHistory,
    history,
    lastSessionResetAt: arena?.lastSessionResetAt ? arena.lastSessionResetAt.toISOString() : null,
    // "W" | "L" | null — which deck `fillCourt` stacked last. Drives the
    // W -> L -> W alternation, so both the rack UI and the offline engine read
    // it. Always null for an arena not running `splitDeckByResult`.
    lastDeckFilled: arena?.lastDeckFilled ?? null,
    // Whether the arena is running win/lose decks (see the select above for
    // why this setting, alone among the matchmaking ones, ships with the board).
    splitDeckByResult: arena?.splitDeckByResult ?? false,
    // Advisory "a manager is running the board offline" flag. Both columns
    // are always written together; require both so a half-cleared row can't
    // render a nameless banner. Freshness is judged client-side (a dead
    // device never releases its hold).
    offlineHold:
      arena?.offlineHolderLabel && arena?.offlineHeldAt
        ? { label: arena.offlineHolderLabel, heldAt: arena.offlineHeldAt.toISOString() }
        : null,
  };
}
