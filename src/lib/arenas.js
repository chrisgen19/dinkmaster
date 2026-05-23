import { prisma } from '@/lib/prisma';
import { getWeeklyLeaderboard } from '@/lib/leaderboard-server';

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
    },
  });
}

/**
 * List an arena's members (oldest first) with role. Returns only
 * non-sensitive fields: `/arena/[id]` is publicly viewable, so email and
 * other account identifiers must not be in this payload.
 * @param {string} arenaId
 * @returns {Promise<Array<{membershipId:string,userId:string,name:string,role:string}>>}
 */
export async function getArenaMembers(arenaId) {
  const members = await prisma.arenaMembership.findMany({
    where: { arenaId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return members.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    role: m.role,
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
 * Aggregate a user's player record across every arena they play in — powers
 * the global `/profile` page.
 * @param {string} userId
 * @returns {Promise<{
 *   totals:{arenas:number,gamesPlayed:number,wins:number,losses:number,winPct:number,rating:number|null,weeklyWins:number,weeklyArenasLed:number},
 *   arenas:Array<{arenaId:string,arenaName:string,gamesPlayed:number,wins:number,losses:number,rating:number,inQueue:boolean,active:boolean,weeklyWins:number,weeklyRank:number|null}>,
 *   recentMatches:Array<{matchId:string,arenaName:string,courtName:string,won:boolean,scoreFor:number,scoreAgainst:number,timestamp:string}>
 * }>}
 */
export async function getUserPlayerStats(userId) {
  const players = await prisma.player.findMany({
    where: { userId },
    include: { arena: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

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

  // Recent matches across all the user's arenas. `MatchPlayer.playerId` is a
  // plain id snapshot (no FK), so it is matched against the user's player ids.
  const playerIds = players.map((p) => p.id);
  const matchPlayers = playerIds.length
    ? await prisma.matchPlayer.findMany({
        where: { playerId: { in: playerIds } },
        include: { match: { include: { arena: { select: { name: true } } } } },
        orderBy: { match: { createdAt: 'desc' } },
        take: 20,
      })
    : [];

  const recentMatches = matchPlayers.map((mp) => {
    const m = mp.match;
    const scoreFor = mp.team === 1 ? m.score1 : m.score2;
    const scoreAgainst = mp.team === 1 ? m.score2 : m.score1;
    return {
      matchId: m.id,
      arenaName: m.arena.name,
      courtName: m.courtName,
      won: scoreFor > scoreAgainst,
      scoreFor,
      scoreAgainst,
      // ISO string; formatted client-side in the viewer's locale.
      timestamp: new Date(m.createdAt).toISOString(),
    };
  });

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
  };
}
