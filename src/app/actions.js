'use server';

import { prisma } from '@/lib/prisma';
import { getState } from '@/lib/data';
import { requireUser, requireArenaOwner, requireArenaManager } from '@/lib/session';
import { ROLES } from '@/lib/roles';
import { STARVE_THRESHOLD, EMERGENCY_WAIT } from '@/lib/matchmaking';
import { computeMatchRatings, RATING_BASELINE } from '@/lib/rating';

/** Canonical (sorted) pair so each partnership has exactly one row. */
function canonicalPair(x, y) {
  return x < y ? [x, y] : [y, x];
}

/** Increment the partnership count for a pair, creating the row if absent. */
async function bumpPartnership(tx, arenaId, x, y) {
  const [playerA, playerB] = canonicalPair(x, y);
  await tx.partnership.upsert({
    where: { playerA_playerB: { playerA, playerB } },
    create: { arenaId, playerA, playerB, count: 1 },
    update: { count: { increment: 1 } },
  });
}

/** Highest queueOrder currently assigned to an active player, or 0 if the rack is empty. */
async function maxQueueOrder(tx, arenaId) {
  const top = await tx.player.aggregate({
    where: { arenaId, leftAt: null },
    _max: { queueOrder: true },
  });
  return top._max.queueOrder ?? 0;
}

// App-wide key for a transaction-scoped Postgres advisory lock. Every
// transaction that assigns queueOrder positions takes this lock first, so
// concurrent finishes/adds/shuffles are serialized and can never read the
// same maxQueueOrder and write duplicate positions. The lock is keyed per
// arena (second key) so unrelated arenas never block each other. Released
// on commit/rollback.
const QUEUE_LOCK_KEY = 920425;
function lockQueue(tx, arenaId) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUEUE_LOCK_KEY}, hashtext(${arenaId}))`;
}

/** Unbiased Fisher-Yates shuffle (returns a new array). */
function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Create a player on an arena's rack inside a transaction: credit the current
 * group-average `gamesOffset` (so a latecomer rotates as a peer, not catch-up)
 * and append them to the bottom of the queue. The caller must hold `lockQueue`.
 */
async function addArenaPlayer(tx, arenaId, { userId = null, firstName, lastName }) {
  const gamesOffset = await groupAverageMetric(tx, arenaId);
  const order = (await maxQueueOrder(tx, arenaId)) + 1;
  return tx.player.create({
    data: { arenaId, userId, firstName, lastName: lastName || null, queueOrder: order, gamesOffset },
  });
}

/**
 * The current group's average ordering metric (gamesPlayed + gamesOffset over
 * active players), used to slot a joiner in as a peer rather than giving them a
 * catch-up advantage for games they weren't here for.
 */
async function groupAverageMetric(tx, arenaId) {
  const active = await tx.player.findMany({
    where: { arenaId, leftAt: null },
    select: { gamesPlayed: true, gamesOffset: true },
  });
  return active.length
    ? Math.round(active.reduce((sum, p) => sum + p.gamesPlayed + p.gamesOffset, 0) / active.length)
    : 0;
}

/**
 * Make `user` an active, queued player in the arena. Reactivates their existing
 * (possibly departed) row so prior stats and match history are reclaimed, or
 * creates a fresh one. Either way they slot in at the bottom of the rack as a
 * peer (effective metric = current group average). Caller must hold `lockQueue`.
 */
async function activateArenaPlayer(tx, arenaId, user) {
  const existing = await tx.player.findUnique({
    where: { arenaId_userId: { arenaId, userId: user.id } },
    select: { id: true, gamesPlayed: true, leftAt: true, queueOrder: true },
  });
  if (!existing) {
    return addArenaPlayer(tx, arenaId, {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  }
  // Already an active player — nothing to do. This covers both a player on the
  // rack (queueOrder set) and one currently on a court (queueOrder null);
  // re-queuing the latter would put the same person in the rack AND on a court.
  if (existing.leftAt === null) return existing;

  const avg = await groupAverageMetric(tx, arenaId);
  const order = (await maxQueueOrder(tx, arenaId)) + 1;
  return tx.player.update({
    where: { id: existing.id },
    data: {
      leftAt: null,
      queueOrder: order,
      waitRounds: 0,
      // Keep lifetime stats, but reset the effective ordering metric to the
      // group average so a returner rotates as a peer (offset may go negative).
      gamesOffset: avg - existing.gamesPlayed,
    },
  });
}

/**
 * Remove a user from an arena inside a transaction: deactivate their linked
 * player (kept for history — `leftAt` set, pulled off the rack) and delete
 * their non-owner membership. Returns false when the player is mid-match so the
 * caller can abort. Caller must hold `lockQueue`.
 */
async function removeArenaMember(tx, arenaId, userId) {
  const player = await tx.player.findUnique({
    where: { arenaId_userId: { arenaId, userId } },
    select: { id: true },
  });
  if (player) {
    const onCourt = await tx.courtSlot.findFirst({
      where: { playerId: player.id, court: { status: 'playing' } },
    });
    if (onCourt) return false;
    // Deactivate rather than delete: the row (stats + partnership history) is
    // kept so the user's record survives and a rejoin reclaims it.
    await tx.player.update({
      where: { id: player.id },
      data: { leftAt: new Date(), queueOrder: null, waitRounds: 0 },
    });
  }
  await tx.arenaMembership.deleteMany({
    where: { arenaId, userId, role: { not: ROLES.OWNER } },
  });
  // Clear any stale pending request for the same user (cheap insurance against
  // odd orderings — a leaver should not be left with a lingering request).
  await tx.joinRequest.deleteMany({ where: { arenaId, userId } });
  return true;
}

// --- Arena management -----------------------------------------------------

/** Create a new arena owned by the current user, seeded with two courts. */
export async function createArena(nameInput) {
  const guard = await requireUser();
  if (guard.error) return { error: guard.error };

  const name = (nameInput ?? '').trim();
  if (name.length === 0) return { error: 'Please enter an arena name.' };
  if (name.length > 80) return { error: 'Arena name is too long (max 80 characters).' };

  const arena = await prisma.arena.create({
    data: {
      name,
      ownerId: guard.user.id,
      courts: {
        create: [
          { name: 'Court 1', position: 1 },
          { name: 'Court 2', position: 2 },
        ],
      },
      // The creator is the OWNER member, so the members list is uniform.
      memberships: {
        create: { userId: guard.user.id, role: ROLES.OWNER },
      },
      // ...and the first player on the rack: a registered user is also a
      // player. Brand-new arena, so queueOrder 1 and no gamesOffset.
      players: {
        create: {
          userId: guard.user.id,
          firstName: guard.user.firstName,
          lastName: guard.user.lastName,
          queueOrder: 1,
        },
      },
    },
  });

  return { arena: { id: arena.id, name: arena.name } };
}

/** Rename an arena (owner only). */
export async function renameArena(arenaId, nameInput) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error };

  const name = (nameInput ?? '').trim();
  if (name.length === 0) return { error: 'Please enter an arena name.' };
  if (name.length > 80) return { error: 'Arena name is too long (max 80 characters).' };

  await prisma.arena.update({ where: { id: arenaId }, data: { name } });
  return { arena: { id: arenaId, name } };
}

/**
 * Update an arena's General settings — name (required) and an optional
 * description blurb. Manager-gated (owner or organizer), unlike the legacy
 * owner-only `renameArena`. Empty description is stored as null.
 */
export async function updateArenaGeneral(arenaId, { name: nameInput, description: descInput } = {}) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  const name = (nameInput ?? '').trim();
  if (name.length === 0) return { error: 'Please enter an arena name.' };
  if (name.length > 80) return { error: 'Arena name is too long (max 80 characters).' };

  const description = (descInput ?? '').trim() || null;
  if (description && description.length > 280) {
    return { error: 'Description is too long (max 280 characters).' };
  }

  // updateMany (not update) so a concurrent delete is a clean count===0
  // instead of a thrown P2025; scoped to id only since any manager may write.
  // A manager demoted between the guard and this write still succeeds — a
  // narrow TOCTOU window we accept, same as the other manager-gated actions.
  const updated = await prisma.arena.updateMany({ where: { id: arenaId }, data: { name, description } });
  if (updated.count === 0) return { error: 'This arena no longer exists.' };
  return { arena: { id: arenaId, name, description } };
}

/** "HH:MM" 24-hour clock, e.g. "06:00" or "22:30". */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether a string is a timezone Intl can resolve (rejects typos/injection). */
function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Set an arena's recurring play schedule — powers the schedule-aware weekly
 * leaderboard. Manager-gated (owner or organizer), like the rest of arena
 * settings. `days` are weekday numbers (0 = Sunday … 6 = Saturday);
 * `start`/`end` are "HH:MM" strings or empty for unset.
 */
export async function updateArenaSchedule(arenaId, { days, start, end, timezone } = {}) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  const dayList = Array.isArray(days) ? days : [];
  // Strict parse: blanks and non-decimal strings (`''`, `'   '`, `'0x1'`) must
  // not coerce to a valid weekday, so require a pure decimal token before
  // converting to Number; everything else becomes NaN and fails the range check.
  const parsedDays = dayList.map((d) => {
    if (typeof d === 'number') return d;
    if (typeof d !== 'string') return NaN;
    const token = d.trim();
    return /^\d+$/.test(token) ? Number(token) : NaN;
  });
  if (parsedDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { error: 'Schedule days must be between Sunday (0) and Saturday (6).' };
  }
  const normalizedDays = [...new Set(parsedDays)].sort((a, b) => a - b);

  const startTime = (start ?? '').trim() || null;
  const endTime = (end ?? '').trim() || null;
  if (startTime && !TIME_RE.test(startTime)) return { error: 'Start time must be in HH:MM format.' };
  if (endTime && !TIME_RE.test(endTime)) return { error: 'End time must be in HH:MM format.' };
  if (startTime && endTime && endTime <= startTime) {
    return { error: 'End time must be after start time.' };
  }

  const tz = (timezone ?? '').trim() || 'Asia/Manila';
  if (!isValidTimeZone(tz)) return { error: 'Unrecognized timezone.' };

  // updateMany (not update) so a concurrent delete is a clean count===0
  // instead of a thrown P2025; scoped to id only since any manager may write.
  // A manager demoted between the guard and this write still succeeds — a
  // narrow TOCTOU window we accept, same as the other manager-gated actions.
  const updated = await prisma.arena.updateMany({
    where: { id: arenaId },
    data: { scheduleDays: normalizedDays, scheduleStart: startTime, scheduleEnd: endTime, timezone: tz },
  });
  if (updated.count === 0) return { error: 'This arena no longer exists.' };
  return { schedule: { days: normalizedDays, start: startTime, end: endTime, timezone: tz } };
}

// --- Arena play (owner-gated, scoped by arenaId) --------------------------

/** Add one player (first name required, last name optional) to the bottom of the rack. */
export async function addPlayer(arenaId, firstNameInput, lastNameInput) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  const firstName = (firstNameInput ?? '').trim();
  const lastName = (lastNameInput ?? '').trim();

  if (firstName.length === 0) return { state: await getState(arenaId) };
  if (firstName.length > 60 || lastName.length > 60) {
    return { error: 'Player name is too long (max 60 characters).', state: await getState(arenaId) };
  }

  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    await addArenaPlayer(tx, arenaId, { firstName, lastName });
  });

  return { state: await getState(arenaId) };
}

/** Remove a player, unless they are mid-match on a court. */
export async function removePlayer(arenaId, playerId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  let blockedReason = '';
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // A linked player is a registered member — removing them from the rack
    // would orphan their membership. The owner must use the Members tab.
    const player = await tx.player.findFirst({
      where: { id: playerId, arenaId },
      select: { userId: true },
    });
    if (player?.userId) {
      blockedReason = 'MEMBER';
      return;
    }
    // Re-check under the lock: a concurrent fillCourt can't slip this player
    // onto a court between the check and the delete (which would cascade the
    // new slot and leave the court with three players).
    const slot = await tx.courtSlot.findFirst({
      where: { playerId, player: { arenaId }, court: { status: 'playing' } },
    });
    if (slot) {
      blockedReason = 'PLAYING';
      return;
    }
    // Delete the player and their partnership rows together (no FK to cascade
    // these). Both are scoped deleteMany calls: a playerId from another arena —
    // or one already removed by a concurrent call — simply matches zero rows,
    // so there is no P2025 to catch.
    await tx.partnership.deleteMany({
      where: { arenaId, OR: [{ playerA: playerId }, { playerB: playerId }] },
    });
    await tx.player.deleteMany({ where: { id: playerId, arenaId } });
  });

  if (blockedReason === 'MEMBER') {
    return {
      error: 'This player has an account — remove them from the Members tab instead.',
      state: await getState(arenaId),
    };
  }
  if (blockedReason === 'PLAYING') {
    return {
      error: 'Cannot remove a player currently playing on court! Finish their match first.',
      state: await getState(arenaId),
    };
  }
  return { state: await getState(arenaId) };
}

/**
 * Link a temporary (walk-in) player to a registered member: the temp player
 * keeps its id, stats, and queue position but gains a `userId`, and the
 * member's auto-created player is merged away. Owner only. This is how a
 * walk-in's record carries over once they have an account.
 */
export async function linkPlayerToMember(arenaId, playerId, userId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  let reason = '';
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);

    const temp = await tx.player.findFirst({
      where: { id: playerId, arenaId },
      select: { id: true, userId: true, gamesPlayed: true, rating: true },
    });
    if (!temp) {
      reason = 'NO_PLAYER';
      return;
    }
    if (temp.userId) {
      reason = 'ALREADY_LINKED';
      return;
    }

    const membership = await tx.arenaMembership.findUnique({
      where: { arenaId_userId: { arenaId, userId } },
    });
    if (!membership) {
      reason = 'NOT_MEMBER';
      return;
    }

    // Merge the member's own auto-created player into the temp player so it
    // becomes their single linked player (the @@unique([arenaId,userId])
    // constraint also forbids two linked players for one user). The temp
    // player keeps its id, queue position, and court slot.
    const ownPlayer = await tx.player.findUnique({
      where: { arenaId_userId: { arenaId, userId } },
      select: { id: true, gamesPlayed: true, wins: true, losses: true, rating: true },
    });
    if (ownPlayer) {
      const onCourt = await tx.courtSlot.findFirst({
        where: { playerId: ownPlayer.id, court: { status: 'playing' } },
      });
      if (onCourt) {
        reason = 'MEMBER_PLAYING';
        return;
      }
      // Fold the existing player's win/loss/game counters into the survivor
      // and re-point its finished-match snapshots, so nothing the member has
      // already played is lost when the records are merged. Elo is not
      // additive, so blend the two ratings by games played — a row with no
      // games (never rated, still at baseline) contributes nothing and the
      // survivor simply keeps the other side's rating.
      const totalGames = temp.gamesPlayed + ownPlayer.gamesPlayed;
      const mergedRating =
        totalGames > 0
          ? Math.round(
              (temp.rating * temp.gamesPlayed + ownPlayer.rating * ownPlayer.gamesPlayed) /
                totalGames,
            )
          : temp.rating;
      await tx.player.update({
        where: { id: temp.id },
        data: {
          userId,
          gamesPlayed: { increment: ownPlayer.gamesPlayed },
          wins: { increment: ownPlayer.wins },
          losses: { increment: ownPlayer.losses },
          rating: mergedRating,
        },
      });
      await tx.matchPlayer.updateMany({
        where: { playerId: ownPlayer.id },
        data: { playerId: temp.id },
      });
      await tx.partnership.deleteMany({
        where: { arenaId, OR: [{ playerA: ownPlayer.id }, { playerB: ownPlayer.id }] },
      });
      await tx.player.deleteMany({ where: { id: ownPlayer.id, arenaId } });
    } else {
      await tx.player.update({ where: { id: temp.id }, data: { userId } });
    }
  });

  const messages = {
    NO_PLAYER: 'That player no longer exists.',
    ALREADY_LINKED: 'That player is already linked to an account.',
    NOT_MEMBER: 'That user must join the arena before they can be linked.',
    MEMBER_PLAYING: 'That member is on a court. Finish their match first.',
  };
  if (reason) return { error: messages[reason], state: await getState(arenaId) };
  return { state: await getState(arenaId) };
}

/** Randomly reorder everyone currently waiting in the rack. */
export async function shuffleQueue(arenaId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  let shuffledAny = false;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // Read the queued set under the lock so we never write a position onto a
    // player a concurrent fillCourt just moved onto a court.
    const queued = await tx.player.findMany({
      where: { arenaId, leftAt: null, queueOrder: { not: null } },
      select: { id: true },
    });
    if (queued.length < 2) return;
    const shuffled = shuffle(queued);
    for (let i = 0; i < shuffled.length; i++) {
      await tx.player.update({ where: { id: shuffled[i].id }, data: { queueOrder: i + 1 } });
    }
    shuffledAny = true;
  });

  return {
    notification: shuffledAny
      ? '🔀 Manual Queue Shuffle: All waiting players mixed successfully!'
      : '',
    state: await getState(arenaId),
  };
}

/** Stack the top 4 waiting players onto a court using the lowest-partnership matchup. */
export async function fillCourt(arenaId, courtId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);
      // Atomically claim the court only if it is still vacant (row-locks it).
      // The arenaId guard also rejects a courtId from another arena.
      const claimed = await tx.court.updateMany({
        where: { id: courtId, arenaId, status: 'vacant' },
        data: { status: 'playing' },
      });
      if (claimed.count !== 1) throw new Error('COURT_UNAVAILABLE');

      // Select the current top 4 inside the tx so we never act on a stale snapshot.
      const queued = await tx.player.findMany({
        where: { arenaId, leftAt: null, queueOrder: { not: null } },
        orderBy: { queueOrder: 'asc' },
        take: 4,
        select: { id: true },
      });
      if (queued.length < 4) throw new Error('NOT_ENOUGH');

      const [p0, p1, p2, p3] = queued.map((p) => p.id);

      // Remove exactly these four from the rack; bail if any slipped away meanwhile.
      const dequeued = await tx.player.updateMany({
        where: { id: { in: [p0, p1, p2, p3] }, queueOrder: { not: null } },
        data: { gamesPlayed: { increment: 1 }, queueOrder: null, waitRounds: 0 },
      });
      if (dequeued.count !== 4) throw new Error('QUEUE_CHANGED');

      // Everyone still waiting in this arena was skipped this round.
      await tx.player.updateMany({
        where: { arenaId, leftAt: null, queueOrder: { not: null } },
        data: { waitRounds: { increment: 1 } },
      });

      // Pick the matchup with the fewest prior partnerships (random tie-break).
      const rows = await tx.partnership.findMany({
        where: { arenaId, playerA: { in: [p0, p1, p2, p3] }, playerB: { in: [p0, p1, p2, p3] } },
      });
      const countFor = (x, y) => {
        const [a, b] = canonicalPair(x, y);
        return rows.find((r) => r.playerA === a && r.playerB === b)?.count ?? 0;
      };
      const matchups = [
        { team1: [p0, p1], team2: [p2, p3], weight: countFor(p0, p1) + countFor(p2, p3) },
        { team1: [p0, p2], team2: [p1, p3], weight: countFor(p0, p2) + countFor(p1, p3) },
        { team1: [p0, p3], team2: [p1, p2], weight: countFor(p0, p3) + countFor(p1, p2) },
      ];
      const minWeight = Math.min(...matchups.map((m) => m.weight));
      const best = shuffle(matchups.filter((m) => m.weight === minWeight))[0];

      await tx.courtSlot.createMany({
        data: [
          ...best.team1.map((playerId) => ({ courtId, playerId, team: 1 })),
          ...best.team2.map((playerId) => ({ courtId, playerId, team: 2 })),
        ],
      });
      await bumpPartnership(tx, arenaId, best.team1[0], best.team1[1]);
      await bumpPartnership(tx, arenaId, best.team2[0], best.team2[1]);
    });
  } catch (err) {
    if (err?.message === 'NOT_ENOUGH') {
      return {
        error: 'Need at least 4 players stacked in the queue to load a court!',
        state: await getState(arenaId),
      };
    }
    // Court taken, queue shifted, or a unique violation (P2002) from a concurrent fill.
    if (err?.code === 'P2002' || ['COURT_UNAVAILABLE', 'QUEUE_CHANGED'].includes(err?.message)) {
      return {
        error: 'The court or queue changed while loading. Please try again.',
        state: await getState(arenaId),
      };
    }
    throw err;
  }

  return { state: await getState(arenaId) };
}

/** Record a finished match's score, update records, and recycle players to the rack. */
export async function endMatch(arenaId, courtId, score1, score2, autoMix) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  const s1 = parseInt(score1, 10) || 0;
  const s2 = parseInt(score2, 10) || 0;
  const team1Won = s1 > s2;
  const team2Won = s2 > s1;

  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);
      // Atomically claim the finish: only one caller can flip playing -> vacant,
      // so concurrent endMatch calls for the same court can't double-record.
      const claimed = await tx.court.updateMany({
        where: { id: courtId, arenaId, status: 'playing' },
        data: { status: 'vacant' },
      });
      if (claimed.count !== 1) throw new Error('ALREADY_FINISHED');

      // Read the authoritative slot snapshot inside the transaction.
      const court = await tx.court.findUnique({ where: { id: courtId } });
      const slots = await tx.courtSlot.findMany({
        where: { courtId },
        include: { player: true },
      });
      const team1 = slots.filter((s) => s.team === 1);
      const team2 = slots.filter((s) => s.team === 2);

      const base = await maxQueueOrder(tx, arenaId);
      // Recycle finished players back into the rack in randomized order.
      const recycled = shuffle(slots);

      await tx.match.create({
        data: {
          arenaId,
          courtName: court.name,
          score1: s1,
          score2: s2,
          players: {
            create: slots.map((s) => ({
              playerId: s.playerId,
              playerFirstName: s.player.firstName,
              playerLastName: s.player.lastName,
              team: s.team,
            })),
          },
        },
      });

      if (team1Won || team2Won) {
        const winners = (team1Won ? team1 : team2).map((s) => s.playerId);
        const losers = (team1Won ? team2 : team1).map((s) => s.playerId);
        await tx.player.updateMany({ where: { id: { in: winners } }, data: { wins: { increment: 1 } } });
        await tx.player.updateMany({ where: { id: { in: losers } }, data: { losses: { increment: 1 } } });
      }

      // Update Elo skill ratings (Phase 6). A filled court is always two
      // players per team; guard anyway so a malformed court can't crash a finish.
      if (team1.length === 2 && team2.length === 2) {
        const outcome = team1Won ? 1 : team2Won ? 2 : 0;
        const next = computeMatchRatings({
          team1: [team1[0].player.rating, team1[1].player.rating],
          team2: [team2[0].player.rating, team2[1].player.rating],
          outcome,
        });
        await tx.player.update({ where: { id: team1[0].playerId }, data: { rating: next.team1[0] } });
        await tx.player.update({ where: { id: team1[1].playerId }, data: { rating: next.team1[1] } });
        await tx.player.update({ where: { id: team2[0].playerId }, data: { rating: next.team2[0] } });
        await tx.player.update({ where: { id: team2[1].playerId }, data: { rating: next.team2[1] } });
      }

      await tx.courtSlot.deleteMany({ where: { courtId } });

      for (let i = 0; i < recycled.length; i++) {
        await tx.player.update({
          where: { id: recycled[i].playerId },
          data: { queueOrder: base + i + 1 },
        });
      }
    });
  } catch (err) {
    // Court was already finished/vacant (a concurrent or duplicate call won) — no-op.
    if (err?.message === 'ALREADY_FINISHED') return { state: await getState(arenaId) };
    throw err;
  }

  // Decide whether to auto-mix (Silo-Buster) based on the other courts' state.
  const otherCourts = await prisma.court.findMany({
    where: { arenaId, id: { not: courtId } },
  });
  const otherPlaying = otherCourts.filter((c) => c.status === 'playing').length;
  const queuedCount = await prisma.player.count({
    where: { arenaId, leftAt: null, queueOrder: { not: null } },
  });

  let notification = '';
  // Mix the whole rack on every finish (when enabled and more than one court's
  // worth of players are waiting, so the next four can actually differ) — this
  // stops the same group of four from locking together every round.
  if (autoMix && queuedCount > 4) {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);
      // Read the queued set under the lock so a concurrent fillCourt can't make
      // us reassign a position to a player who is now on a court.
      const queued = await tx.player.findMany({
        where: { arenaId, leftAt: null, queueOrder: { not: null } },
        select: { id: true, gamesPlayed: true, gamesOffset: true, waitRounds: true },
      });
      if (queued.length === 0) return;
      // Sort lexicographically: band first (emergency > protected > fresh),
      // then in the emergency band strictly by wait, then by FEWEST games
      // played-since-joining (gamesPlayed + gamesOffset, so a player who has
      // played less goes ahead but a late joiner can't hog), then a random
      // tie-break for variety among equals.
      const bandOf = (w) =>
        w >= EMERGENCY_WAIT ? 2 : w >= STARVE_THRESHOLD ? 1 : 0;
      const scored = queued
        .map((p) => ({
          id: p.id,
          band: bandOf(p.waitRounds),
          waitRounds: p.waitRounds,
          games: p.gamesPlayed + p.gamesOffset,
          rand: Math.random(),
        }))
        .sort((a, b) => {
          if (a.band !== b.band) return b.band - a.band; // emergency > protected > fresh
          if (a.band === 2 && a.waitRounds !== b.waitRounds) return b.waitRounds - a.waitRounds; // strict longest-first
          if (a.games !== b.games) return a.games - b.games; // fewest games-since-joining first
          return a.rand - b.rand; // random tie-break among equals
        });
      for (let i = 0; i < scored.length; i++) {
        await tx.player.update({ where: { id: scored[i].id }, data: { queueOrder: i + 1 } });
      }
    });
    notification = '⚡ Silo-Buster: Mixed the rack (longest-waiting up next) to keep matchups fresh and fair!';
  } else if (otherPlaying > 0) {
    notification = '💡 Recommended: Wait for other courts to finish before stacking again, to allow a complete mix of player pools!';
  }

  return { notification, state: await getState(arenaId) };
}

/** Add a new vacant court at the end. */
export async function addCourt(arenaId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  // Serialize under the queue lock so concurrent adds can't read the same
  // count/position and create duplicate court names/positions.
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    const count = await tx.court.count({ where: { arenaId } });
    const position =
      (await tx.court.aggregate({ where: { arenaId }, _max: { position: true } }))._max.position ?? 0;
    await tx.court.create({
      data: { arenaId, name: `Court ${count + 1}`, position: position + 1 },
    });
  });
  return { state: await getState(arenaId) };
}

/** Remove a court, unless a game is in progress on it. */
export async function removeCourt(arenaId, courtId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  let blocked = false;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // Conditional delete under the lock: only remove the court if it is still
    // vacant, so it can't race a concurrent fillCourt that just claimed it
    // (which would cascade-delete the new slots and strand its players).
    const deleted = await tx.court.deleteMany({
      where: { id: courtId, arenaId, status: 'vacant' },
    });
    if (deleted.count === 0) {
      // Nothing deleted: either it's now playing, or already gone. Scope the
      // lookup to this arena so a courtId from another arena reports as gone
      // (not as a misleading "active game").
      const stillThere = await tx.court.findFirst({
        where: { id: courtId, arenaId },
        select: { id: true },
      });
      if (stillThere) blocked = true; // exists but not vacant -> active game
    }
  });

  if (blocked) {
    return { error: 'Cannot remove a court with an active game!', state: await getState(arenaId) };
  }
  return { state: await getState(arenaId) };
}

/**
 * Reset the arena session: clear match history, partnership counts, and live
 * court assignments, and send every player back to the rack with fresh stats.
 * Players and courts themselves are kept.
 */
export async function resetArena(arenaId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    // Wipe history and live state for this arena only.
    await tx.match.deleteMany({ where: { arenaId } }); // cascades MatchPlayer
    await tx.courtSlot.deleteMany({ where: { court: { arenaId } } });
    await tx.partnership.deleteMany({ where: { arenaId } });
    await tx.court.updateMany({ where: { arenaId }, data: { status: 'vacant' } });

    // Clear stats for EVERY player in the arena, departed rows included: a
    // reset wipes the arena's match history, so a later rejoin (which reuses
    // the departed Player row and keeps its lifetime stats) must not
    // resurrect pre-reset games/wins/losses or a stale Elo from matches that
    // no longer exist. queueOrder is assigned per active player below.
    await tx.player.updateMany({
      where: { arenaId },
      data: { gamesPlayed: 0, wins: 0, losses: 0, waitRounds: 0, gamesOffset: 0, rating: RATING_BASELINE },
    });

    // Send every active player back to the rack. Departed players (leftAt
    // set) are skipped so a reset can't silently re-queue an invisible
    // former member — they keep queueOrder null.
    const players = await tx.player.findMany({
      where: { arenaId, leftAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    for (let i = 0; i < players.length; i++) {
      await tx.player.update({
        where: { id: players[i].id },
        data: { queueOrder: i + 1 },
      });
    }
  });

  return { state: await getState(arenaId) };
}

// --- Membership (Phase 3) -------------------------------------------------

/**
 * Request to join an arena. Arenas are public to browse but join-gated: this
 * records a pending `JoinRequest` that an owner/organizer must approve. Owners
 * and existing members need no request. Idempotent.
 */
export async function requestToJoin(arenaId) {
  const guard = await requireUser();
  if (guard.error) return { error: guard.error };
  if (!arenaId) return { error: 'Arena not found.' };

  const arena = await prisma.arena.findUnique({ where: { id: arenaId } });
  if (!arena) return { error: 'Arena not found.' };
  if (arena.ownerId === guard.user.id) return { ok: true };

  const membership = await prisma.arenaMembership.findUnique({
    where: { arenaId_userId: { arenaId, userId: guard.user.id } },
  });
  if (membership) return { ok: true }; // already a member

  await prisma.joinRequest.upsert({
    where: { arenaId_userId: { arenaId, userId: guard.user.id } },
    create: { arenaId, userId: guard.user.id },
    update: {}, // request already pending
  });
  return { ok: true };
}

/**
 * Approve a pending join request (owner or organizer): the requester becomes a
 * MEMBER and a queued player, and the request is consumed.
 */
export async function approveJoinRequest(arenaId, userId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  let reason = '';
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    const request = await tx.joinRequest.findUnique({
      where: { arenaId_userId: { arenaId, userId } },
    });
    if (!request) {
      reason = 'NO_REQUEST';
      return;
    }
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!user) {
      reason = 'NO_USER';
      return;
    }
    await tx.arenaMembership.upsert({
      where: { arenaId_userId: { arenaId, userId } },
      create: { arenaId, userId, role: ROLES.MEMBER },
      update: {}, // already a member somehow — keep their role
    });
    await activateArenaPlayer(tx, arenaId, user);
    await tx.joinRequest.deleteMany({ where: { arenaId, userId } });
  });

  if (reason === 'NO_REQUEST') return { error: 'That join request no longer exists.' };
  if (reason === 'NO_USER') return { error: 'That user no longer exists.' };
  return { ok: true };
}

/** Reject (delete) a pending join request (owner or organizer). */
export async function rejectJoinRequest(arenaId, userId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  await prisma.joinRequest.deleteMany({ where: { arenaId, userId } });
  return { ok: true };
}

/** Leave an arena: drop your membership and your rack player. */
export async function leaveArena(arenaId) {
  const guard = await requireUser();
  if (guard.error) return { error: guard.error };
  if (!arenaId) return { error: 'Arena not found.' };

  const arena = await prisma.arena.findUnique({ where: { id: arenaId } });
  if (!arena) return { error: 'Arena not found.' };
  if (arena.ownerId === guard.user.id) {
    return { error: 'The owner cannot leave. Transfer ownership first.' };
  }

  let removed = true;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    removed = await removeArenaMember(tx, arenaId, guard.user.id);
  });
  if (!removed) {
    return { error: 'Finish your current match before leaving the arena.' };
  }
  return { ok: true };
}

/** Promote or demote a member between ORGANIZER and MEMBER (owner only). */
export async function updateMemberRole(arenaId, userId, role) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error };

  if (role !== ROLES.ORGANIZER && role !== ROLES.MEMBER) {
    return { error: 'Invalid role.' };
  }
  if (userId === guard.arena.ownerId) {
    return { error: "The owner's role cannot be changed here." };
  }

  // role: { not: OWNER } is belt-and-suspenders — never touch the owner row.
  const updated = await prisma.arenaMembership.updateMany({
    where: { arenaId, userId, role: { not: ROLES.OWNER } },
    data: { role },
  });
  if (updated.count === 0) return { error: 'That user is not a member of this arena.' };
  return { ok: true };
}

/**
 * Remove a member from the arena (owner only): drops their membership and
 * their rack player. The owner cannot be removed.
 */
export async function removeMember(arenaId, userId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error };

  if (userId === guard.arena.ownerId) {
    return { error: 'The owner cannot be removed.' };
  }

  let removed = true;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    removed = await removeArenaMember(tx, arenaId, userId);
  });
  if (!removed) {
    return { error: 'That member is on a court. Finish their match first.' };
  }
  return { ok: true };
}

/**
 * Transfer ownership to another member. The new owner must already be a
 * member; the previous owner stays on as an ORGANIZER.
 */
export async function transferOwnership(arenaId, newOwnerUserId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error };

  const prevOwnerId = guard.arena.ownerId;
  if (newOwnerUserId === prevOwnerId) {
    return { error: 'That user already owns this arena.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.arenaMembership.findUnique({
        where: { arenaId_userId: { arenaId, userId: newOwnerUserId } },
      });
      if (!target) throw new Error('NOT_A_MEMBER');

      // Atomically claim the transfer: flip ownerId only if the caller is
      // still the canonical owner. `requireArenaOwner` ran before this
      // transaction, so a concurrent transfer (double-submit / two tabs)
      // could already have moved ownership — its updateMany then matches
      // zero rows and the whole transaction rolls back, keeping
      // `Arena.ownerId` and the OWNER membership row in sync.
      const claimed = await tx.arena.updateMany({
        where: { id: arenaId, ownerId: prevOwnerId },
        data: { ownerId: newOwnerUserId },
      });
      if (claimed.count !== 1) throw new Error('OWNERSHIP_CHANGED');

      await tx.arenaMembership.update({
        where: { arenaId_userId: { arenaId, userId: newOwnerUserId } },
        data: { role: ROLES.OWNER },
      });
      await tx.arenaMembership.update({
        where: { arenaId_userId: { arenaId, userId: prevOwnerId } },
        data: { role: ROLES.ORGANIZER },
      });
    });
  } catch (err) {
    if (err?.message === 'NOT_A_MEMBER') {
      return { error: 'The new owner must join the arena as a member first.' };
    }
    if (err?.message === 'OWNERSHIP_CHANGED') {
      return { error: 'Ownership changed while processing. Please try again.' };
    }
    throw err;
  }
  return { ok: true };
}

/**
 * Permanently delete an arena and everything scoped to it (players, courts,
 * matches, partnerships, memberships, join requests — all `onDelete: Cascade`).
 * Owner only, and irreversible. Scoped to the caller's id so a concurrent
 * ownership transfer can't let a former owner delete the arena out from under
 * the new one.
 */
export async function deleteArena(arenaId) {
  const guard = await requireArenaOwner(arenaId);
  if (guard.error) return { error: guard.error };

  const deleted = await prisma.arena.deleteMany({
    where: { id: arenaId, ownerId: guard.user.id },
  });
  if (deleted.count !== 1) {
    return { error: 'Ownership changed while processing. Please try again.' };
  }
  return { ok: true };
}
