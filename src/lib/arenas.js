import { prisma } from '@/lib/prisma';
import { getWeeklyLeaderboard } from '@/lib/leaderboard-server';
import {
  bestPartner,
  currentStreak,
  enrichRecentMatches,
  favoriteCourt,
} from '@/lib/user-insights';

/**
 * List every arena for the public directory, with owner and content counts.
 * @returns {Promise<Array<{id:string,name:string,description:string|null,ownerId:string,ownerName:string,playerCount:number,courtCount:number,matchCount:number}>>}
 */
export async function listArenas() {
  const arenas = await prisma.arena.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      owner: { select: { id: true, name: true } },
      // Count active players only — departed rows are kept for history but
      // must not inflate the public directory's player count.
      _count: { select: { players: { where: { leftAt: null } }, courts: true, matches: true } },
    },
  });

  return arenas.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    ownerId: a.ownerId,
    ownerName: a.owner.name,
    playerCount: a._count.players,
    courtCount: a._count.courts,
    matchCount: a._count.matches,
  }));
}

/**
 * Fetch one arena's scalar fields, or null if it does not exist. Explicitly
 * selected (not `include`) so a manager-facing page only receives known-safe
 * columns rather than every future Arena field.
 * @param {string} id
 */
export async function getArena(id) {
  return prisma.arena.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      ownerId: true,
      scheduleDays: true,
      scheduleStart: true,
      scheduleEnd: true,
      timezone: true,
      starveThreshold: true,
      emergencyWait: true,
      skipRestoresPriority: true,
      skipPickReplacement: true,
      targetScore: true,
      autoMixDefault: true,
      leaderboardSize: true,
      countOffScheduleGames: true,
      showPartnershipMatrix: true,
      lastSessionResetAt: true,
      autoResetOnSession: true,
    },
  });
}

/**
 * List an arena's members (oldest first) with role. Returns only
 * non-sensitive fields: `/arena/[id]` is publicly viewable, so email and
 * other account identifiers must not be in this payload. `hasLinkedPlayer`
 * flags members who already have an active `Player` row in this arena —
 * the manager direct-link modal uses it to append a `· existing player`
 * suffix on those option labels, signalling that picking them will merge
 * stats into the walk-in (rather than hiding them, which would make the
 * canonical "claim historical walk-in" flow unreachable).
 * @param {string} arenaId
 * @returns {Promise<Array<{membershipId:string,userId:string,name:string,role:string,hasLinkedPlayer:boolean}>>}
 */
export async function getArenaMembers(arenaId) {
  const members = await prisma.arenaMembership.findMany({
    where: { arenaId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          // One linked Player per (arena, user) — active rows have leftAt null.
          players: {
            where: { arenaId, leftAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return members.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    role: m.role,
    hasLinkedPlayer: m.user.players.length > 0,
  }));
}

/**
 * All of a user's arena memberships, as `{ arenaId, role }` rows — used to
 * badge the directory.
 * @param {string} userId
 */
export async function getUserMemberships(userId) {
  return prisma.arenaMembership.findMany({
    where: { userId },
    select: { arenaId: true, role: true },
  });
}

/**
 * An arena's pending join requests (oldest first), with the requester's name.
 * Name only — same non-PII shape as `getArenaMembers`. For owner/organizer use.
 * @param {string} arenaId
 * @returns {Promise<Array<{requestId:string,userId:string,name:string,requestedAt:string}>>}
 */
export async function getArenaJoinRequests(arenaId) {
  const requests = await prisma.joinRequest.findMany({
    where: { arenaId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return requests.map((r) => ({
    requestId: r.id,
    userId: r.userId,
    name: r.user.name,
    requestedAt: new Date(r.createdAt).toISOString(),
  }));
}

/** Walk-in display name; mirrors `formatShortName` for an empty linked user. */
function playerDisplayName(p) {
  return p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName;
}

/**
 * An arena's pending link requests (oldest first), with the requesting
 * member's name and the orphan Player they want to claim. For owner/organizer
 * use in the Members tab. Same non-PII shape as the join requests loader.
 * @param {string} arenaId
 * @returns {Promise<Array<{requestId:string,userId:string,memberName:string,playerId:string,playerName:string,requestedAt:string}>>}
 */
export async function getArenaLinkRequests(arenaId) {
  const requests = await prisma.linkRequest.findMany({
    where: { arenaId },
    include: {
      user: { select: { id: true, name: true } },
      player: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return requests.map((r) => ({
    requestId: r.id,
    userId: r.userId,
    memberName: r.user.name,
    playerId: r.playerId,
    playerName: playerDisplayName(r.player),
    requestedAt: new Date(r.createdAt).toISOString(),
  }));
}

/**
 * Per-viewer link-request context for the Members tab. Returns the viewer's
 * pending link request (if any), the full active walk-in list (for the
 * manager Walk-ins pill — each row carries `hasPendingRequest` so the UI
 * can show a "claim pending" badge), and the claimable subset (the
 * self-link modal's option list). Returns `null`-shaped fields when no
 * viewer is signed in or no arena is given, so the Members tab can render
 * safely without extra conditionals.
 * @param {string} arenaId
 * @param {string|null|undefined} userId
 */
export async function getViewerLinkContext(arenaId, userId) {
  if (!userId || !arenaId) {
    return { pendingRequest: null, orphanPlayers: [], claimableOrphans: [] };
  }

  const [pending, orphans] = await Promise.all([
    prisma.linkRequest.findUnique({
      where: { arenaId_userId: { arenaId, userId } },
      include: {
        player: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.player.findMany({
      // All active walk-ins. Includes ones that already have a pending
      // LinkRequest so managers can still see + act on them (direct-link,
      // approve via the Requests pill, or remove). The self-link modal uses
      // `claimableOrphans` below, which excludes already-claimed rows.
      where: { arenaId, userId: null, leftAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        linkRequests: { select: { id: true }, take: 1 },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
  ]);

  const orphanPlayers = orphans.map((p) => ({
    id: p.id,
    displayName: playerDisplayName(p),
    hasPendingRequest: p.linkRequests.length > 0,
  }));

  return {
    pendingRequest: pending
      ? {
          requestId: pending.id,
          playerId: pending.playerId,
          playerName: playerDisplayName(pending.player),
        }
      : null,
    // Full list of active walk-ins (for the manager Walk-ins pill).
    orphanPlayers,
    // Subset eligible for a self-link request (no other pending claim).
    // Drives the member self-link modal's option list.
    claimableOrphans: orphanPlayers.filter((p) => !p.hasPendingRequest),
  };
}

/**
 * The set of arena ids a user has a pending join request in — used to badge
 * the directory and arena page.
 * @param {string} userId
 * @returns {Promise<Set<string>>}
 */
export async function getUserPendingRequestArenaIds(userId) {
  const requests = await prisma.joinRequest.findMany({
    where: { userId },
    select: { arenaId: true },
  });
  return new Set(requests.map((r) => r.arenaId));
}

/**
 * Whether a user has a pending join request in a specific arena.
 * @param {string} arenaId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function hasPendingJoinRequest(arenaId, userId) {
  const request = await prisma.joinRequest.findUnique({
    where: { arenaId_userId: { arenaId, userId } },
  });
  return !!request;
}

/**
 * An arena's active invite links, for the manager Share UI. Returns code +
 * mode only (no creator PII); the client builds the absolute URL from
 * `window.location.origin`. Newest first.
 * @param {string} arenaId
 * @returns {Promise<Array<{id:string,code:string,mode:string,createdAt:string}>>}
 */
export async function getArenaInvites(arenaId) {
  const invites = await prisma.arenaInvite.findMany({
    where: { arenaId, active: true },
    select: { id: true, code: true, mode: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return invites.map((i) => ({
    id: i.id,
    code: i.code,
    mode: i.mode,
    createdAt: new Date(i.createdAt).toISOString(),
  }));
}

/**
 * Resolve an active invite by its code for the `/join/[code]` route. Returns
 * the arena identity + mode, or null when the code is unknown or revoked (so
 * the route can render a clean "no longer valid" state).
 * @param {string} code
 * @returns {Promise<{arenaId:string,arenaName:string,mode:string}|null>}
 */
export async function getArenaInviteByCode(code) {
  if (!code) return null;
  const invite = await prisma.arenaInvite.findFirst({
    where: { code, active: true },
    select: { mode: true, arena: { select: { id: true, name: true } } },
  });
  if (!invite) return null;
  return { arenaId: invite.arena.id, arenaName: invite.arena.name, mode: invite.mode };
}

/**
 * Whether two users share at least one arena (both have a membership in it).
 * The owner's membership row mirrors role OWNER, so memberships cover owners
 * too. Powers the access gate for viewing another user's profile.
 * @param {string} viewerUserId
 * @param {string} targetUserId
 * @returns {Promise<boolean>}
 */
export async function usersShareArena(viewerUserId, targetUserId) {
  if (!viewerUserId || !targetUserId) return false;
  const row = await prisma.arenaMembership.findFirst({
    where: {
      userId: viewerUserId,
      arena: { memberships: { some: { userId: targetUserId } } },
    },
    select: { id: true },
  });
  return !!row;
}

/**
 * Load another user's public profile for a viewer, gated on a shared arena.
 * Returns `null` when ids are missing, the two users share no arena, or the
 * target doesn't exist — the `/u/[userId]` route turns that into a 404 so it
 * never reveals whether an account exists. Name only (no email): the only PII
 * on the profile is excluded for non-self viewers.
 * @param {string} targetUserId
 * @param {string} viewerUserId
 * @returns {Promise<{name:string, stats:Awaited<ReturnType<typeof getUserPlayerStats>>}|null>}
 */
export async function getViewableUserProfile(targetUserId, viewerUserId) {
  if (!targetUserId || !viewerUserId) return null;
  if (!(await usersShareArena(viewerUserId, targetUserId))) return null;

  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { name: true },
  });
  if (!user) return null;

  const stats = await getUserPlayerStats(targetUserId);
  return { name: user.name, stats };
}

/**
 * Aggregate a user's player record across every arena they play in — powers
 * the global `/profile` page.
 * @param {string} userId
 * @returns {Promise<{
 *   totals:{arenas:number,gamesPlayed:number,wins:number,losses:number,winPct:number,rating:number|null,weeklyWins:number,weeklyArenasLed:number},
 *   arenas:Array<{arenaId:string,arenaName:string,gamesPlayed:number,wins:number,losses:number,rating:number,inQueue:boolean,active:boolean,weeklyWins:number,weeklyRank:number|null}>,
 *   recentMatches:Array<{matchId:string,arenaName:string,courtName:string,scoreFor:number,scoreAgainst:number,timestamp:string,partners:Array<{firstName:string,lastName:string|null}>,opponents:Array<{firstName:string,lastName:string|null}>}>,
 *   insights:{
 *     bestPartner:{name:string,games:number,wins:number,winPct:number}|null,
 *     favoriteCourt:{name:string,games:number}|null,
 *     streak:{kind:'W'|'L',count:number}|null,
 *   },
 * }>}
 */
export async function getUserPlayerStats(userId) {
  const players = await prisma.player.findMany({
    where: { userId },
    include: { arena: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return buildPlayerStats(players);
}

/**
 * Shared aggregation: turn a list of Player rows (each with `arena.name`) into
 * the profile stats bundle — totals, per-arena cards, weekly standing, recent
 * matches, and insights. Backs both the cross-arena account profile
 * (`getUserPlayerStats`, many rows) and the single-row walk-in profile
 * (`getViewablePlayerProfile`, one row). All the downstream logic already
 * operates over a list of players, so a walk-in is just a list of one.
 * @param {Array<object>} players
 */
async function buildPlayerStats(players) {
  const sum = players.reduce(
    (acc, p) => ({
      gamesPlayed: acc.gamesPlayed + p.gamesPlayed,
      wins: acc.wins + p.wins,
      losses: acc.losses + p.losses,
    }),
    { gamesPlayed: 0, wins: 0, losses: 0 },
  );
  const decided = sum.wins + sum.losses;

  // `queueOrder` is a raw, gap-prone ordering value (not a 1-based rank), and
  // computing a true per-arena position would need every arena's full queue.
  // The profile only needs whether the player is currently racked, so expose
  // a boolean rather than a misleading number.
  // This week's standing per active arena: run the same weekly leaderboard the
  // arena tab shows and pick out this user's row (wins + rank). Departed arenas
  // are skipped — a left player isn't competing this week.
  //
  // De-dupe by arenaId before fetching: today a user has at most one player
  // per arena, but the read is expensive enough (schedule + week matches +
  // match players) that we keep one leaderboard call per unique arena and
  // pass a single `now` so every board lands in the same week window even if
  // /profile is loaded at the Monday boundary.
  const activePlayers = players.filter((p) => p.leftAt === null);
  const uniqueArenaIds = [...new Set(activePlayers.map((p) => p.arenaId))];
  const now = new Date();
  const boardByArena = new Map();
  await Promise.all(
    uniqueArenaIds.map(async (arenaId) => {
      const board = await getWeeklyLeaderboard(arenaId, { now, limit: Infinity });
      boardByArena.set(arenaId, board);
    }),
  );

  const weeklyByArena = new Map();
  for (const p of activePlayers) {
    const board = boardByArena.get(p.arenaId);
    const me = board?.leaders.find((l) => l.playerId === p.id);
    weeklyByArena.set(p.arenaId, { wins: me?.wins ?? 0, rank: me?.rank ?? null });
  }

  const arenas = players.map((p) => {
    const weekly = p.leftAt === null ? weeklyByArena.get(p.arenaId) : null;
    return {
      arenaId: p.arenaId,
      arenaName: p.arena.name,
      gamesPlayed: p.gamesPlayed,
      wins: p.wins,
      losses: p.losses,
      rating: p.rating, // internal Elo; the UI maps it to a DUPR display value
      inQueue: p.queueOrder !== null,
      active: p.leftAt === null, // false = arena the user has left (history kept)
      weeklyWins: weekly?.wins ?? 0,
      weeklyRank: weekly?.rank ?? null,
    };
  });

  // Weekly headline: total wins this week and how many arenas the user leads.
  const weekly = {
    wins: [...weeklyByArena.values()].reduce((acc, w) => acc + w.wins, 0),
    arenasLed: [...weeklyByArena.values()].filter((w) => w.rank === 1).length,
  };

  // Global rating: a match-weighted average of the user's active arena Elos
  // (weight = games played there). An unconverged baseline row in a new or
  // secondary arena has few/zero games, so it barely moves — or is excluded
  // entirely (0 games) — and can't deflate a strong player's global rating.
  const ratingWeight = activePlayers.reduce((acc, p) => acc + p.gamesPlayed, 0);
  const rating = ratingWeight
    ? activePlayers.reduce((acc, p) => acc + p.rating * p.gamesPlayed, 0) / ratingWeight
    : null;

  // Recent matches + insights across all the user's arenas. `MatchPlayer.playerId`
  // is a plain id snapshot (no FK), so it is matched against the user's player
  // ids. We pull the most-recent 500 rows (a couple of years of casual play)
  // for aggregations, then slice the top 20 for the display feed.
  const playerIds = players.map((p) => p.id);
  const playerIdSet = new Set(playerIds);
  const matchPlayers = playerIds.length
    ? await prisma.matchPlayer.findMany({
        where: { playerId: { in: playerIds } },
        include: {
          match: {
            include: {
              arena: { select: { name: true } },
              // All 4 participants per match — fuels partner/opponent rosters
              // and the best-partner aggregation. Cheap: each match has
              // exactly 4 MatchPlayer rows.
              players: true,
            },
          },
        },
        orderBy: { match: { createdAt: 'desc' } },
        take: 500,
      })
    : [];

  // A viewer has at most one Player per arena and a match belongs to a single
  // arena, so legitimately there is at most one of the viewer's MatchPlayer
  // rows per match. A historic link/merge could leave two rows for the same
  // match (the same playerId on both teams); collapse to one row per match so
  // the feed's React keys stay unique and the aggregations don't double-count.
  // The DB now enforces uniqueness, so this only guards already-corrupt data.
  const seenMatchIds = new Set();
  const uniqueMatchPlayers = matchPlayers.filter((mp) => {
    if (seenMatchIds.has(mp.matchId)) return false;
    seenMatchIds.add(mp.matchId);
    return true;
  });

  const recentMatches = enrichRecentMatches(uniqueMatchPlayers.slice(0, 20), playerIdSet);
  const insights = {
    bestPartner: bestPartner(uniqueMatchPlayers, playerIdSet),
    favoriteCourt: favoriteCourt(uniqueMatchPlayers),
    streak: currentStreak(uniqueMatchPlayers),
  };

  return {
    totals: {
      arenas: players.length,
      gamesPlayed: sum.gamesPlayed,
      wins: sum.wins,
      losses: sum.losses,
      winPct: decided ? Math.round((sum.wins / decided) * 100) : 0,
      rating, // internal Elo (match-weighted); null when no games played yet
      weeklyWins: weekly.wins,
      weeklyArenasLed: weekly.arenasLed,
    },
    arenas,
    recentMatches,
    insights,
  };
}

/**
 * Load a single Player's profile for a viewer — the walk-in counterpart to
 * `getViewableUserProfile`. Returns:
 *  - `null` when the player is missing, or it's a walk-in whose (only) arena the
 *    viewer doesn't belong to (the `/p/[playerId]` route 404s either way);
 *  - `{ redirectUserId }` when the player is linked to an account — its
 *    canonical, cross-arena profile lives at `/u/[userId]`, so the route
 *    redirects there;
 *  - `{ name, stats }` for an accessible walk-in (single-arena record).
 * @param {string} playerId
 * @param {string} viewerUserId
 */
export async function getViewablePlayerProfile(playerId, viewerUserId) {
  if (!playerId || !viewerUserId) return null;

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { arena: { select: { name: true } } },
  });
  if (!player) return null;

  // Linked players have a richer cross-arena profile keyed by their account.
  // Gate the redirect on the same shared-arena rule `/u/[userId]` enforces, so
  // a viewer who couldn't see that profile can't learn the account id from the
  // redirect (the destination would 404 anyway).
  if (player.userId) {
    if (!(await usersShareArena(viewerUserId, player.userId))) return null;
    return { redirectUserId: player.userId };
  }

  // Walk-in: gate on the viewer belonging to the walk-in's arena (the only one
  // it lives in), mirroring the shared-arena rule for accounts.
  const membership = await prisma.arenaMembership.findUnique({
    where: { arenaId_userId: { arenaId: player.arenaId, userId: viewerUserId } },
    select: { id: true },
  });
  if (!membership) return null;

  const stats = await buildPlayerStats([player]);
  const name = player.lastName ? `${player.firstName} ${player.lastName}` : player.firstName;
  return { name, stats };
}
