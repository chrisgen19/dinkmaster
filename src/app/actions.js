'use server';

import { prisma } from '@/lib/prisma';
import { getState } from '@/lib/data';
import { getCurrentUser, requireUser, requireArenaOwner, requireArenaManager } from '@/lib/session';
import { ROLES, canManageArena } from '@/lib/roles';
import { generateInviteCode } from '@/lib/invite-code';
import { INVITE_MODES, isInviteMode } from '@/lib/invites';
import { MAX_WAIT_THRESHOLD } from '@/lib/matchmaking';
import {
  DEFAULT_TARGET_SCORE,
  MIN_TARGET_SCORE,
  MAX_TARGET_SCORE,
  MIN_LEADERBOARD_SIZE,
  MAX_LEADERBOARD_SIZE,
} from '@/lib/match-defaults';
import { RATING_BASELINE } from '@/lib/rating';
import { validateMatchScore } from '@/lib/scoring';
import { diffLineup, validateLineup } from '@/lib/court-lineup';
// Board mutation internals live in board-apply so the offline sync replay
// (Phase 3) can apply a recorded event log through the exact same code paths.
// Each action below still owns its auth guard, transaction, and error mapping.
import {
  addArenaPlayer,
  applyAutoMixTx,
  applyCancelFillTx,
  applyCheckInTx,
  applyCheckOutTx,
  applyEndMatchTx,
  applyEventTx,
  applyFillCourtTx,
  applyShuffleQueueTx,
  applySkipPlayerTx,
  bumpPartnership,
  groupAverageMetric,
  lockQueue,
  maxQueueOrder,
  readBoardStateTx,
  unbumpPartnership,
} from '@/lib/board-apply';
import { boardFingerprint } from '@/lib/board-fingerprint';

// Separate advisory-lock namespace for invite creation, keyed per arena, so two
// managers minting a link for the same arena are serialized and can't both pass
// the "one active link per mode" check. Distinct key from the queue lock so
// invite creation never contends with rack mutations. Released on commit/rollback.
const INVITE_LOCK_KEY = 920426;
function lockArenaInvites(tx, arenaId) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVITE_LOCK_KEY}, hashtext(${arenaId}))`;
}

/**
 * Whether `userId` may still manage this arena's invites (owner or organizer),
 * read inside the caller's transaction. The owner's membership row mirrors their
 * role as OWNER, so a single membership lookup covers everyone. Used to
 * re-validate authority *under* `lockArenaInvites` after the pre-lock
 * `requireArenaManager`/`requireArenaOwner`, so a concurrently demoted or removed
 * manager can't mint or mutate invites with stale auth.
 */
async function callerCanManageInvites(tx, arenaId, userId) {
  const membership = await tx.arenaMembership.findUnique({
    where: { arenaId_userId: { arenaId, userId } },
    select: { role: true },
  });
  return !!membership && canManageArena(membership.role);
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
      skipBoosted: false,
      // Keep lifetime stats, but reset the effective ordering metric to the
      // group average so a returner rotates as a peer (offset may go negative).
      gamesOffset: avg - existing.gamesPlayed,
    },
  });
}

/**
 * Remove a user from an arena inside a transaction: deactivate their linked
 * player (kept for history — `leftAt` set, pulled off the rack) and delete
 * their non-owner membership, and revoke any invite links they issued. Returns
 * false when the player is mid-match so the caller can abort. Caller must hold
 * `lockArenaInvites` then `lockQueue` (that order — the invite revocation is
 * serialized against `redeemArenaInvite`).
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
      data: { leftAt: new Date(), queueOrder: null, waitRounds: 0, skipBoosted: false },
    });
  }
  await tx.arenaMembership.deleteMany({
    where: { arenaId, userId, role: { not: ROLES.OWNER } },
  });
  // Clear any stale pending request for the same user (cheap insurance against
  // odd orderings — a leaver should not be left with a lingering request).
  await tx.joinRequest.deleteMany({ where: { arenaId, userId } });
  await tx.linkRequest.deleteMany({ where: { arenaId, userId } });
  // Revoke any invite links this user issued: leaving or being removed strips
  // their authority, and a copied AUTO_JOIN link would otherwise keep granting
  // instant membership until a current manager noticed and revoked it.
  await tx.arenaInvite.updateMany({
    where: { arenaId, createdBy: userId, active: true },
    data: { active: false },
  });
  return true;
}

// --- Arena management -----------------------------------------------------

/**
 * Create a new arena owned by the current user, seeded with two courts.
 * Accepts either a string (legacy: just a name) or an object with optional
 * description + recurring schedule fields. Schedule + description validation
 * mirrors `updateArenaGeneral` / `updateArenaSchedule` so the create page can
 * collect them in one shot.
 */
export async function createArena(input) {
  const guard = await requireUser();
  if (guard.error) return { error: guard.error };

  const payload = typeof input === 'string' ? { name: input } : (input ?? {});
  const name = (payload.name ?? '').trim();
  if (name.length === 0) return { error: 'Please enter an arena name.' };
  if (name.length > 80) return { error: 'Arena name is too long (max 80 characters).' };

  const description = (payload.description ?? '').trim() || null;
  if (description && description.length > 280) {
    return { error: 'Description is too long (max 280 characters).' };
  }

  // Schedule fields — all optional. Validation matches updateArenaSchedule.
  const dayList = Array.isArray(payload.scheduleDays) ? payload.scheduleDays : [];
  const parsedDays = dayList.map((d) => {
    if (typeof d === 'number') return d;
    if (typeof d !== 'string') return NaN;
    const token = d.trim();
    return /^\d+$/.test(token) ? Number(token) : NaN;
  });
  if (parsedDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { error: 'Schedule days must be between Sunday (0) and Saturday (6).' };
  }
  const scheduleDays = [...new Set(parsedDays)].sort((a, b) => a - b);

  const scheduleStart = (payload.scheduleStart ?? '').trim() || null;
  const scheduleEnd = (payload.scheduleEnd ?? '').trim() || null;
  if (scheduleStart && !TIME_RE.test(scheduleStart)) return { error: 'Start time must be in HH:MM format.' };
  if (scheduleEnd && !TIME_RE.test(scheduleEnd)) return { error: 'End time must be in HH:MM format.' };
  if (scheduleStart && scheduleEnd && scheduleEnd <= scheduleStart) {
    return { error: 'End time must be after start time.' };
  }

  const timezone = (payload.timezone ?? '').trim() || 'Asia/Manila';
  if (!isValidTimeZone(timezone)) return { error: 'Unrecognized timezone.' };

  const arena = await prisma.arena.create({
    data: {
      name,
      description,
      scheduleDays,
      scheduleStart,
      scheduleEnd,
      timezone,
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

/**
 * Update an arena's General settings — name (required) and an optional
 * description blurb. Manager-gated (owner or organizer). Empty description is
 * stored as null.
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

/**
 * Update an arena's matchmaking thresholds — the wait counts that promote a
 * player into the protected (⏳) and emergency bands. Manager-gated.
 * `emergencyWait` must be ≥ `starveThreshold` so the bands remain ordered.
 * Bounds come from `MAX_WAIT_THRESHOLD` in `lib/matchmaking.js` so the server
 * and the Settings UI agree.
 */
export async function updateArenaMatchmaking(
  arenaId,
  {
    starveThreshold: starveInput,
    emergencyWait: emergencyInput,
    skipRestoresPriority: skipPriorityInput,
    skipPickReplacement: skipPickInput,
  } = {},
) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  const starve = Number(starveInput);
  const emergency = Number(emergencyInput);

  if (!Number.isInteger(starve) || starve < 1 || starve > MAX_WAIT_THRESHOLD) {
    return { error: `Starve threshold must be a whole number between 1 and ${MAX_WAIT_THRESHOLD}.` };
  }
  if (!Number.isInteger(emergency) || emergency < 1 || emergency > MAX_WAIT_THRESHOLD) {
    return { error: `Emergency wait must be a whole number between 1 and ${MAX_WAIT_THRESHOLD}.` };
  }
  if (emergency < starve) {
    return { error: 'Emergency wait must be at least the starve threshold.' };
  }

  // Coerce HTML form values ("true"/"false") strictly; reject anything else
  // so a malformed POST can't silently flip the setting. Same pattern as the
  // booleans in `updateArenaMatchDefaults`.
  const asBool = (v) =>
    v === true || v === 'true' ? true : v === false || v === 'false' ? false : null;
  const skipRestoresPriority = asBool(skipPriorityInput);
  if (skipRestoresPriority === null) {
    return { error: 'Restore-priority setting must be true or false.' };
  }
  const skipPickReplacement = asBool(skipPickInput);
  if (skipPickReplacement === null) {
    return { error: 'Pick-replacement setting must be true or false.' };
  }

  const updated = await prisma.arena.updateMany({
    where: { id: arenaId },
    data: { starveThreshold: starve, emergencyWait: emergency, skipRestoresPriority, skipPickReplacement },
  });
  if (updated.count === 0) return { error: 'This arena no longer exists.' };

  // When the setting transitions to off, also wipe any lingering boosts on
  // queued paddles. Without this, the next auto-mix would still feed those
  // stale flags into `bandOf` and elevate them into the Next-in-Line band
  // even though the arena is now in legacy Skip mode — surprising the
  // manager who just disabled the setting. Idempotent: a no-op when the
  // setting was already off or when no paddles are boosted.
  if (!skipRestoresPriority) {
    await prisma.player.updateMany({
      where: { arenaId, skipBoosted: true },
      data: { skipBoosted: false },
    });
  }

  return {
    matchmaking: {
      starveThreshold: starve,
      emergencyWait: emergency,
      skipRestoresPriority,
      skipPickReplacement,
    },
  };
}

/**
 * Update an arena's match + leaderboard defaults. Manager-gated. All five
 * fields are required; the UI sends the current values for any unchanged
 * inputs so partial updates aren't a concern.
 */
export async function updateArenaMatchDefaults(
  arenaId,
  {
    targetScore: targetInput,
    autoMixDefault: autoMixInput,
    leaderboardSize: sizeInput,
    countOffScheduleGames: countOffInput,
    showPartnershipMatrix: showMatrixInput,
  } = {},
) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  const targetScore = Number(targetInput);
  if (!Number.isInteger(targetScore) || targetScore < MIN_TARGET_SCORE || targetScore > MAX_TARGET_SCORE) {
    return { error: `Target score must be a whole number between ${MIN_TARGET_SCORE} and ${MAX_TARGET_SCORE}.` };
  }

  const leaderboardSize = Number(sizeInput);
  if (!Number.isInteger(leaderboardSize) || leaderboardSize < MIN_LEADERBOARD_SIZE || leaderboardSize > MAX_LEADERBOARD_SIZE) {
    return { error: `Leaderboard size must be a whole number between ${MIN_LEADERBOARD_SIZE} and ${MAX_LEADERBOARD_SIZE}.` };
  }

  // Booleans must be strictly true/false — coerce so HTML form values
  // ("true"/"false" strings) are accepted, but reject anything else.
  const asBool = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : null);
  const autoMixDefault = asBool(autoMixInput);
  const countOffScheduleGames = asBool(countOffInput);
  const showPartnershipMatrix = asBool(showMatrixInput);
  if (autoMixDefault === null || countOffScheduleGames === null || showPartnershipMatrix === null) {
    return { error: 'Auto-mix, off-schedule, and matrix-visibility settings must be true or false.' };
  }

  const updated = await prisma.arena.updateMany({
    where: { id: arenaId },
    data: { targetScore, autoMixDefault, leaderboardSize, countOffScheduleGames, showPartnershipMatrix },
  });
  if (updated.count === 0) return { error: 'This arena no longer exists.' };
  return {
    matchDefaults: { targetScore, autoMixDefault, leaderboardSize, countOffScheduleGames, showPartnershipMatrix },
  };
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
      error: "Can't delete this player while they're on an active court. Finish their match first.",
      state: await getState(arenaId),
    };
  }
  return { state: await getState(arenaId) };
}

/**
 * Human-readable error message for each `applyLinkPlayerToMember` failure
 * reason. Shared between the direct-link path (`linkPlayerToMember`) and the
 * approval path (`approveLinkRequest`) so both report the same wording.
 */
const LINK_PLAYER_MESSAGES = {
  NO_PLAYER: 'That player no longer exists.',
  ALREADY_LINKED: 'That player is already linked to an account.',
  NOT_MEMBER: 'That user must join the arena before they can be linked.',
  MEMBER_PLAYING: 'That member is on a court. Finish their match first.',
};

/**
 * Link a walk-in (orphan) Player to a registered member inside an existing
 * transaction: the walk-in keeps its id, stats, and queue position but gains
 * a `userId`, and the member's auto-created player (if any) is merged away.
 * The caller is responsible for `lockQueue` and for translating the returned
 * `reason` into a user-facing error. Returns `{ reason }` on failure or `{}`
 * on success.
 */
async function applyLinkPlayerToMember(tx, arenaId, playerId, userId) {
  const temp = await tx.player.findFirst({
    where: { id: playerId, arenaId },
    select: { id: true, userId: true, gamesPlayed: true, rating: true },
  });
  if (!temp) return { reason: 'NO_PLAYER' };
  if (temp.userId) return { reason: 'ALREADY_LINKED' };

  const membership = await tx.arenaMembership.findUnique({
    where: { arenaId_userId: { arenaId, userId } },
  });
  if (!membership) return { reason: 'NOT_MEMBER' };

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
    if (onCourt) return { reason: 'MEMBER_PLAYING' };
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
    // Order matters: the `(arenaId, userId)` unique constraint forbids two
    // Players with the same userId in the same arena, so we MUST delete
    // `ownPlayer` before we set `userId` on the walk-in. `MatchPlayer` is
    // a snapshot (no FK), so re-pointing it before the delete is safe;
    // `Partnership` likewise has no FK to Player.
    //
    // Both players could already appear in the same finished match (the
    // walk-in and the member's auto-player were on the same court before
    // linking). Re-pointing `ownPlayer`'s row there would collide with
    // `temp`'s existing row on the `(matchId, playerId)` unique constraint,
    // so drop `ownPlayer`'s row in those matches and re-point only the rest.
    const tempMatchIds = (
      await tx.matchPlayer.findMany({
        where: { playerId: temp.id },
        select: { matchId: true },
      })
    ).map((mp) => mp.matchId);
    await tx.matchPlayer.deleteMany({
      where: { playerId: ownPlayer.id, matchId: { in: tempMatchIds } },
    });
    await tx.matchPlayer.updateMany({
      where: { playerId: ownPlayer.id },
      data: { playerId: temp.id },
    });
    await tx.partnership.deleteMany({
      where: { arenaId, OR: [{ playerA: ownPlayer.id }, { playerB: ownPlayer.id }] },
    });
    await tx.player.deleteMany({ where: { id: ownPlayer.id, arenaId } });
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
  } else {
    await tx.player.update({ where: { id: temp.id }, data: { userId } });
  }
  // Consume any pending LinkRequest tied to either side of this link so the
  // approval queue doesn't keep showing a request that would now fail with
  // `ALREADY_LINKED` (the orphan no longer is) or that is moot because the
  // claiming member has already been linked another way.
  await tx.linkRequest.deleteMany({
    where: { arenaId, OR: [{ userId }, { playerId: temp.id }] },
  });
  return {};
}

/**
 * Directly link a walk-in player to a registered member (owner or organizer):
 * the temp player keeps its id, stats, and queue position but gains a
 * `userId`, and the member's auto-created player is merged away. This is the
 * manager shortcut; members can also self-claim via `requestLinkPlayer` →
 * `approveLinkRequest`.
 */
export async function linkPlayerToMember(arenaId, playerId, userId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  let reason = '';
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    const result = await applyLinkPlayerToMember(tx, arenaId, playerId, userId);
    if (result.reason) reason = result.reason;
  });

  if (reason) return { error: LINK_PLAYER_MESSAGES[reason] };
  // Same shape as the other link-flow actions (`requestLinkPlayer`,
  // `approveLinkRequest`, etc.) — the Members tab consumes `result.error`
  // only and calls `router.refresh()` to repaint the rack, so returning
  // server state here would just be a wasted `getState` query.
  return { ok: true };
}

/** Randomly reorder everyone currently waiting in the rack. */
export async function shuffleQueue(arenaId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  let shuffledAny = false;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    shuffledAny = await applyShuffleQueueTx(tx, arenaId);
  });

  return {
    notification: shuffledAny
      ? 'Queue shuffled — all waiting players mixed.'
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
      await applyFillCourtTx(tx, arenaId, { courtId });
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

/**
 * Cancel a live court's fill: send its four players back to the FRONT of the
 * rack in their original relative order and undo every side effect of
 * {@link fillCourt}, WITHOUT recording a match or touching wins/losses/Elo.
 * Manager-only.
 *
 * Reverses, in one locked transaction:
 *   - court `playing` -> `vacant` (atomic claim, so it can't race a finish);
 *   - each player's `waitRounds` restored from the slot snapshot, and
 *     `gamesPlayed` decremented (the fill had incremented it);
 *   - the `waitRounds +1` the fill applied — but only for the exact players it
 *     bumped (recorded on the court at fill time), so a finish on another court
 *     in the meantime can't earn a phantom decrement;
 *   - the two partnership-count bumps the fill recorded.
 *
 * Rather than writing the raw snapshot positions back (which could collide with
 * players recycled/shuffled into those slots while the court was live), the
 * whole rack is renumbered 1..N with the cancelled four placed first — so
 * positions stay dense, unique, and the four land at the front as promised.
 *
 * Slots created before the snapshot columns existed carry null snapshot fields;
 * those courts can't be cancelled (no original order to restore), so we refuse
 * and tell the manager to finish the match instead.
 */
export async function cancelFill(arenaId, courtId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);
      await applyCancelFillTx(tx, arenaId, { courtId });
    });
  } catch (err) {
    // Already finished/cancelled (a concurrent action won, or a duplicate
    // submit). Surface a clear message so the manager doesn't assume their
    // cancel succeeded when nothing actually changed.
    if (err?.message === 'NOT_PLAYING') {
      return {
        error: 'This court is no longer active — it was already finished or cancelled.',
        state: await getState(arenaId),
      };
    }
    if (err?.message === 'NO_SNAPSHOT') {
      return {
        error: 'This match started before cancel was available — finish it to record the score instead.',
        state: await getState(arenaId),
      };
    }
    if (err?.message === 'INVALID_COURT') {
      return {
        error: 'This court is in an unexpected state and can\'t be cancelled — finish the match instead.',
        state: await getState(arenaId),
      };
    }
    throw err;
  }

  return { state: await getState(arenaId) };
}

/**
 * Manually edit a live court's lineup — swap partners and/or substitute
 * on-court players with waiting paddles — committing the final desired four in
 * one locked transaction. Manager-only (matches `fillCourt`/`cancelFill`).
 *
 * The caller sends the FINAL desired lineup (`team1Ids`, `team2Ids`); the
 * action diffs it against the court's current slots and applies the minimum
 * set of changes:
 *   - Subbed-IN players (in the new lineup, not currently on court): dequeued
 *     exactly like `fillCourt` — `gamesPlayed +1`, `queueOrder`/`waitRounds`
 *     cleared, `skipBoosted` cleared — and their pre-edit rack position is
 *     snapshotted onto the new slot (`prevQueueOrder`/`prevWaitRounds`) so a
 *     later `cancelFill` restores them precisely.
 *   - Subbed-OUT players: `gamesPlayed -1` (floored), slot removed, and they
 *     return to the FRONT of the rack (the whole rack is renumbered densely,
 *     the removed players first, mirroring `cancelFill`). A sub-out is the same
 *     event class as Skip-with-replacement, so it honours `Arena.skipRestoresPriority`:
 *     ON (default) the returned paddle is Next-in-Line (`skipBoosted` set,
 *     pre-stack `waitRounds` restored from the slot snapshot); OFF falls back
 *     to the legacy reset (`waitRounds = 0`, no boost).
 *   - Partnership counts are adjusted by the DELTA from `diffLineup` (only
 *     pairs that actually changed), keeping the matrix consistent with what
 *     `cancelFill`/`endMatch` later read from the final slots.
 *   - Players who merely changed teams: only their `CourtSlot.team` is rewritten
 *     (no game-count change).
 *   - `Court.fillBumpedPlayerIds` is pruned of any subbed-IN players (they no
 *     longer wait, so a later `cancelFill` must not reverse a bump for them),
 *     and a subbed-IN player who was in that set has the original fill's `+1`
 *     reversed in their slot snapshot (`prevWaitRounds = max(0, waitRounds-1)`)
 *     so cancel restores their true pre-fill fairness, not the inflated value.
 *     Subbed-OUT players were never in the set, so nothing to do for them.
 *
 * No-op (clean) if the desired lineup equals the current one. Returns a clean
 * error if the court is no longer playing, in an unexpected slot state, or a
 * subbed-in player has since left the waiting pool (raced onto a court / out of
 * the arena) so the manager can re-pick rather than misfiring.
 *
 * @param {string} arenaId
 * @param {string} courtId
 * @param {string[]} team1Ids - two player ids for Team A
 * @param {string[]} team2Ids - two player ids for Team B
 */
export async function editCourtLineup(arenaId, courtId, team1Ids, team2Ids) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  const valid = validateLineup(team1Ids, team2Ids);
  if (!valid.ok) {
    return { error: 'Pick exactly four different players, two per team.', state: await getState(arenaId) };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);

      // Court must still be live and in this arena. Read its current slots to
      // derive the lineup we're diffing against.
      const court = await tx.court.findFirst({
        where: { id: courtId, arenaId, status: 'playing' },
        select: { id: true, fillBumpedPlayerIds: true },
      });
      if (!court) throw new Error('NOT_PLAYING');

      const slots = await tx.courtSlot.findMany({ where: { courtId } });
      if (slots.length !== 4) throw new Error('INVALID_COURT');

      const current = {
        team1: slots.filter((s) => s.team === 1).map((s) => s.playerId),
        team2: slots.filter((s) => s.team === 2).map((s) => s.playerId),
      };
      // Guard against a malformed split (e.g. 3/1) slipping past the count check —
      // diffLineup's pair logic assumes exactly two players per team.
      if (current.team1.length !== 2 || current.team2.length !== 2) {
        throw new Error('INVALID_COURT');
      }
      const next = { team1: team1Ids, team2: team2Ids };
      const diff = diffLineup(current, next);
      if (!diff.changed) return; // nothing to do

      // Pre-stack rack snapshot for everyone currently on court (the original
      // four). Used to restore a subbed-OUT paddle's pre-stack waitRounds when
      // returning them to the rack as Next-in-Line, and to preserve a stayed
      // player's slot snapshot when the slots are rewritten below.
      const stayedSnap = new Map(
        slots.map((s) => [s.playerId, { prevQueueOrder: s.prevQueueOrder, prevWaitRounds: s.prevWaitRounds }]),
      );

      // Pre-edit rack snapshot for each subbed-in player, captured BEFORE the
      // dequeue so a later cancelFill can restore them precisely.
      const incomingSnap = new Map();

      // Validate subbed-in players under the lock: each must be an active,
      // waiting paddle in THIS arena and not already on any court.
      if (diff.added.length > 0) {
        const incoming = await tx.player.findMany({
          where: {
            id: { in: diff.added },
            arenaId,
            leftAt: null,
            queueOrder: { not: null },
          },
          select: { id: true, queueOrder: true, waitRounds: true },
        });
        if (incoming.length !== diff.added.length) throw new Error('QUEUE_CHANGED');
        const onCourt = await tx.courtSlot.findFirst({
          where: { playerId: { in: diff.added } },
        });
        if (onCourt) throw new Error('QUEUE_CHANGED');

        // A subbed-in paddle that the ORIGINAL fill bumped (+1 waitRounds) still
        // carries that +1 in its current waitRounds. Snapshot the PRE-bump value
        // so a later cancelFill restores their true pre-fill fairness, not the
        // inflated one — and drop them from the court's bump set so, if they are
        // later subbed back out, cancelFill won't reverse a wait credit they
        // since earned elsewhere. Both keep the fill/cancel bookkeeping exact.
        const bumpedSet = new Set(court.fillBumpedPlayerIds ?? []);
        for (const p of incoming) {
          const prevWaitRounds = bumpedSet.has(p.id) ? Math.max(0, p.waitRounds - 1) : p.waitRounds;
          incomingSnap.set(p.id, { prevQueueOrder: p.queueOrder, prevWaitRounds });
        }
        // Dequeue them onto the court (same accounting as fillCourt's dequeue).
        await tx.player.updateMany({
          where: { id: { in: diff.added } },
          data: { gamesPlayed: { increment: 1 }, queueOrder: null, waitRounds: 0, skipBoosted: false },
        });
        const addedSet = new Set(diff.added);
        if ((court.fillBumpedPlayerIds ?? []).some((id) => addedSet.has(id))) {
          await tx.court.update({
            where: { id: courtId },
            data: { fillBumpedPlayerIds: court.fillBumpedPlayerIds.filter((id) => !addedSet.has(id)) },
          });
        }
      }

      // Subbed-out players: undo their game credit and return them to the rack.
      if (diff.removed.length > 0) {
        // A sub-out is the same event class as a Skip-with-replacement (a paddle
        // yields its spot, the manager picks who fills it), so honour the same
        // arena toggle that governs `skipPlayer`. ON (default) ⇒ returned paddle
        // is Next-in-Line: `skipBoosted` set and pre-stack `waitRounds` restored
        // (from the slot snapshot) so the next auto-mix elevates them above the
        // emergency band. OFF ⇒ legacy reset (waitRounds 0, no boost). Read
        // inside the tx so a concurrent settings save can't slip between read
        // and write — mirrors skipPlayer at line 1612.
        const arena = await tx.arena.findUnique({
          where: { id: arenaId },
          select: { skipRestoresPriority: true },
        });
        const restoresPriority = arena?.skipRestoresPriority ?? true;

        await tx.player.updateMany({
          where: { id: { in: diff.removed }, gamesPlayed: { gt: 0 } },
          data: { gamesPlayed: { decrement: 1 } },
        });
        // Front-of-rack: renumber the whole active rack with removed first, then
        // the existing waiters in their current order. Only the RETURNING players
        // get waitRounds touched; everyone else keeps their wait fairness (so a
        // substitution can't wipe the rack's starvation protection).
        const others = await tx.player.findMany({
          where: { arenaId, leftAt: null, queueOrder: { not: null }, id: { notIn: diff.removed } },
          orderBy: { queueOrder: 'asc' },
          select: { id: true },
        });
        const removedSet = new Set(diff.removed);
        const ordered = [...diff.removed, ...others.map((p) => p.id)];
        for (let i = 0; i < ordered.length; i++) {
          const id = ordered[i];
          let data;
          if (!removedSet.has(id)) {
            data = { queueOrder: i + 1 };
          } else if (restoresPriority) {
            const snap = stayedSnap.get(id);
            data = {
              queueOrder: i + 1,
              waitRounds: snap?.prevWaitRounds ?? 0,
              skipBoosted: true,
            };
          } else {
            data = { queueOrder: i + 1, waitRounds: 0, skipBoosted: false };
          }
          await tx.player.update({ where: { id }, data });
        }
      }

      // Rewrite the four slots to the desired lineup. Wipe and recreate so team
      // assignments and substitutions land in one consistent shape: carry the
      // fresh snapshot for incoming players, and preserve the existing snapshot
      // (built above) for players who stayed on court so cancelFill keeps
      // working for them.
      const slotSnap = (playerId) => incomingSnap.get(playerId) ?? stayedSnap.get(playerId) ?? {};

      await tx.courtSlot.deleteMany({ where: { courtId } });
      await tx.courtSlot.createMany({
        data: [
          ...team1Ids.map((playerId) => ({ courtId, playerId, team: 1, ...slotSnap(playerId) })),
          ...team2Ids.map((playerId) => ({ courtId, playerId, team: 2, ...slotSnap(playerId) })),
        ],
      });

      // Partnership delta: only pairs that actually changed.
      for (const [x, y] of diff.pairsToUnbump) await unbumpPartnership(tx, x, y);
      for (const [x, y] of diff.pairsToBump) await bumpPartnership(tx, arenaId, x, y);
    });
  } catch (err) {
    if (err?.message === 'NOT_PLAYING') {
      return {
        error: 'This court is no longer active — it was finished or cancelled.',
        state: await getState(arenaId),
      };
    }
    if (err?.message === 'INVALID_COURT') {
      return {
        error: "This court is in an unexpected state and can't be edited — finish or cancel the match instead.",
        state: await getState(arenaId),
      };
    }
    // QUEUE_CHANGED, or a P2002 from a concurrent fill claiming a player.
    if (err?.code === 'P2002' || err?.message === 'QUEUE_CHANGED') {
      return {
        error: 'A chosen player is no longer available — the rack changed. Please try again.',
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

  // Mirror the client-side pickleball rules (target, win-by-2, no ties) on the
  // server so a stale tab or a hand-rolled action call can't write a bad
  // scoreline into match history / Elo / the weekly leaderboard.
  const target = guard.arena?.targetScore ?? DEFAULT_TARGET_SCORE;
  const check = validateMatchScore(score1, score2, target);
  if (!check.ok) {
    return {
      error: check.reason || 'Both scores are required.',
      state: await getState(arenaId),
    };
  }

  const s1 = parseInt(score1, 10);
  const s2 = parseInt(score2, 10);

  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);
      await applyEndMatchTx(tx, arenaId, { courtId, s1, s2 });
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
    // Auto-mix runs in its own transaction after the match-finish commit; if it
    // bails (arena vanished, lock contention, etc.), skip the mix and still
    // return a clean { state } to the client — the match is already saved.
    let mixed = false;
    try {
      await prisma.$transaction(async (tx) => {
        await lockQueue(tx, arenaId);
        mixed = await applyAutoMixTx(tx, arenaId);
      });
    } catch (err) {
      // ARENA_GONE (concurrent delete) is the only known non-bug failure here.
      // Anything else: rethrow so it bubbles to error reporting — the match
      // commit is unaffected either way.
      if (err?.message !== 'ARENA_GONE') throw err;
    }
    if (mixed) {
      notification = '⚡ Silo-Buster: Mixed the rack (longest-waiting up next) to keep matchups fresh and fair!';
    }
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
      data: { gamesPlayed: 0, wins: 0, losses: 0, waitRounds: 0, gamesOffset: 0, rating: RATING_BASELINE, skipBoosted: false },
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

// --- Session prep (Phase 10a) ---------------------------------------------

/**
 * Prepare the arena for an upcoming play session. Manager-gated. Empties
 * the rack (`queueOrder = null` for every active player), wipes
 * `Partnership` rows so the variety algorithm starts the new session
 * unbiased by last week's pairings, zeroes `waitRounds`, and stamps
 * `Arena.lastSessionResetAt`. The UI immediately opens the Prep Roster
 * modal after this so the manager fills the empty rack with tonight's
 * attendees in one flow — preventing the "checked-in but matrix still
 * polluted" failure mode.
 *
 * Deliberately untouched: `gamesPlayed`, `wins`, `losses`, `rating`, all
 * `Match`/`MatchPlayer` rows, and `CourtSlot` (a live match keeps playing
 * across a reset; players come off into the empty rack via `endMatch`).
 */
export async function prepareNextSession(arenaId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  // updateMany (not update) on the arena row so a delete that races in after
  // requireArenaManager passes is a clean count===0, not an uncaught P2025 —
  // same pattern as the other manager-gated arena writes. The partnership /
  // player writes already no-op on zero matched rows (a cascade-deleted arena
  // leaves nothing to match), so the whole transaction is a safe no-op then.
  let arenaGone = false;
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    await tx.partnership.deleteMany({ where: { arenaId } });
    await tx.player.updateMany({
      where: { arenaId, leftAt: null },
      data: { queueOrder: null, waitRounds: 0, skipBoosted: false },
    });
    const updated = await tx.arena.updateMany({
      where: { id: arenaId },
      data: { lastSessionResetAt: new Date() },
    });
    if (updated.count === 0) arenaGone = true;
  });

  if (arenaGone) return { error: 'This arena no longer exists.', state: await getState(arenaId) };
  return { state: await getState(arenaId) };
}

/**
 * Check a player into the rack — bottom-of-queue placement. Works for both
 * registered members and walk-ins; the Prep Roster modal uses this for
 * either kind of player. Manager-gated. Re-anchors `gamesOffset` so the
 * returning player sorts as a peer (same pattern as `activateArenaPlayer`).
 * Idempotent: a player already on the rack (or on a court mid-match) is a
 * clean no-op.
 */
export async function checkInPlayer(arenaId, playerId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    await applyCheckInTx(tx, arenaId, { playerId });
  });

  return { state: await getState(arenaId) };
}

/**
 * Check a player out of the rack — clears `queueOrder` so they don't get
 * stacked onto the next court. Manager-gated. A player currently mid-match
 * is left alone (their `queueOrder` is already null while playing).
 */
export async function checkOutPlayer(arenaId, playerId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error, state: await getState(arenaId) };

  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    await applyCheckOutTx(tx, arenaId, { playerId });
  });

  return { state: await getState(arenaId) };
}

/**
 * "Skip" a waiting paddle — yield this turn so the next paddle takes the
 * on-deck spot. Two orthogonal arena settings shape the behavior:
 *
 *   `skipRestoresPriority` — where the skipped paddle lands:
 *     On  (default) — moves just PAST on-deck (position ON_DECK_SIZE+1) with
 *                     `waitRounds` preserved and `skipBoosted=true` so the
 *                     next auto-mix elevates them into the Next-in-Line band.
 *     Off           — back of the rack with `waitRounds=0`. Legacy fairness
 *                     penalty.
 *
 *   `skipPickReplacement` — who fills the freed on-deck slot:
 *     On  (default) — manager chooses a waiting paddle (via `replacementId`).
 *     Off           — first waiting auto-fills (the prior behavior). Also the
 *                     fallback whenever a non-manager skips (self-rest) or no
 *                     `replacementId` is provided.
 *
 * Either way `gamesPlayed` is untouched (they didn't play).
 *
 * Authorization is hybrid: a signed-in member may skip THEIR OWN paddle
 * (self-service), and a manager (owner/organizer) may skip anyone — including
 * walk-ins, who have no account to self-serve. The replacement picker is
 * manager-only; a `replacementId` from a non-manager is silently ignored
 * (falls back to auto).
 *
 * No-op (clean) if the paddle is no longer eligible under the queue lock: it
 * left the rack, is no longer on deck, nobody is waiting behind the on-deck
 * group, or — when a `replacementId` is provided — that replacement has
 * since left the waiting pool (returns a clean error so the manager can pick
 * again rather than silently misfiring to the wrong paddle).
 *
 * @param {string} arenaId
 * @param {string} playerId - the paddle to skip
 * @param {string|null} [replacementId] - optional, manager-only: the waiting
 *   paddle the manager picked to fill the freed slot.
 */
export async function skipPlayer(arenaId, playerId, replacementId = null) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Please sign in.', state: await getState(arenaId) };

  // Self-service check before the lock: ownership (player.userId === user.id)
  // is stable, so reading it outside the tx is safe. Walk-ins (userId null)
  // can never be self-skipped. We also resolve manager status up front so a
  // manager skipping their own paddle still unlocks the picker — `isSelf`
  // alone used to short-circuit the manager check, which would have hidden
  // the picker in that case.
  const target = await prisma.player.findFirst({
    where: { id: playerId, arenaId },
    select: { userId: true },
  });
  const isSelf = Boolean(target?.userId && target.userId === user.id);
  const managerGuard = await requireArenaManager(arenaId);
  const isManager = !managerGuard.error;
  if (!isSelf && !isManager) {
    return { error: 'You can only rest your own paddle.', state: await getState(arenaId) };
  }

  let moved = false;
  let restoresPriority = false;
  let replacementError = '';
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    ({ moved, restoresPriority, replacementError } = await applySkipPlayerTx(tx, arenaId, {
      playerId,
      replacementId,
      isManager,
    }));
  });

  if (replacementError) {
    return { error: replacementError, state: await getState(arenaId) };
  }
  // Only confirm when something actually moved — a no-op (the paddle already
  // left the rack mid-race) must not show a false-positive success toast.
  const successMsg = restoresPriority
    ? 'Marked Next in Line — top priority on the next mix.'
    : 'Paddle sent to the back of the rack.';
  return {
    notification: moved ? successMsg : '',
    state: await getState(arenaId),
  };
}

// Typed replay failures `applyEventTx` can throw. In strict mode any of them
// rolls the whole batch back (divergence response); in best-effort mode the
// event is skipped and the rest of the batch still applies. P2002 (unique
// violation, e.g. an off_ player id colliding on a retry race) is handled
// alongside these.
const REPLAY_EVENT_ERRORS = new Set([
  'COURT_UNAVAILABLE',
  'NOT_ENOUGH',
  'QUEUE_CHANGED',
  'NOT_PLAYING',
  'NO_SNAPSHOT',
  'INVALID_COURT',
  'ALREADY_FINISHED',
  'OUTCOME_MISMATCH',
  'BAD_EVENT',
]);

const MAX_SYNC_EVENTS = 500;

/**
 * Display label for an advisory offline hold: "First L.", derived from the
 * authenticated account rather than client input. Falls back through the
 * core `name` field so a session missing the additional fields still yields
 * something presentable. Also used to scope hold clears to their owner.
 */
function offlineHoldLabel(user) {
  const first = user.firstName || user.name?.split(' ')[0] || 'A manager';
  const lastInitial = user.lastName?.charAt(0);
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

/**
 * Replay an offline session's event log against the arena, atomically.
 *
 * The client records board commands offline (with every nondeterministic
 * choice resolved and stored on the event: see `src/lib/board-engine.js`),
 * then calls this once when the connection returns. Everything happens in
 * ONE transaction under the queue lock:
 *
 *   1. Idempotency: the client-generated `batchId` is the primary key of
 *      `OfflineSyncBatch`. A retry of a batch that already committed (but
 *      whose response was lost) returns current state, applying nothing.
 *   2. Divergence check (strict mode): the board+settings fingerprint is
 *      recomputed from the database and compared to the one the client
 *      captured at offline entry. Any mismatch returns `{ divergence }`
 *      WITHOUT applying, and the manager decides: best-effort or discard.
 *   3. Events apply in order through `applyEventTx` (the same code the
 *      online actions run), with recorded outcomes validated against live
 *      reads. Strict mode: one failure rolls back everything. Best-effort
 *      mode (explicitly chosen after a divergence): failed events are
 *      skipped and reported; match results almost always survive.
 *
 * `occurredAt` on each event becomes `Match.createdAt` (clamped to the
 * offline window and monotonic within the batch) so the weekly leaderboard
 * and session stats key off court time, not sync time.
 *
 * @param {string} arenaId
 * @param {object} input - { batchId, base: {fetchedAt, fingerprint},
 *   settings, events, enteredAt, deviceLabel, mode: 'strict'|'best-effort' }
 * @returns {Promise<{state: object, appliedIds?: string[],
 *   skipped?: Array<{id: string, type: string, reason: string}>,
 *   alreadySynced?: boolean, divergence?: boolean, error?: string}>}
 */
export async function syncOfflineEvents(arenaId, input) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  const {
    batchId,
    base,
    settings: rawSettings,
    events,
    enteredAt,
    deviceLabel: rawDeviceLabel,
    mode,
  } = input ?? {};

  // Envelope validation. Anything malformed rejects the whole batch up
  // front; nothing has been applied yet, so the client keeps its log.
  if (
    typeof batchId !== 'string' ||
    !/^[0-9a-zA-Z_-]{8,64}$/.test(batchId) ||
    !Array.isArray(events) ||
    events.length > MAX_SYNC_EVENTS ||
    (mode !== 'strict' && mode !== 'best-effort')
  ) {
    return { error: 'Invalid sync batch.', state: await getState(arenaId) };
  }
  const targetScore = rawSettings?.targetScore;
  if (!Number.isInteger(targetScore) || targetScore < MIN_TARGET_SCORE || targetScore > MAX_TARGET_SCORE) {
    return { error: 'Invalid sync batch.', state: await getState(arenaId) };
  }
  const settings = { targetScore };
  const deviceLabel =
    typeof rawDeviceLabel === 'string' && rawDeviceLabel.trim()
      ? rawDeviceLabel.trim().slice(0, 80)
      : null;

  let outcome = null;
  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);

      // Retried batch that already committed: report it as synced, as-is.
      const existing = await tx.offlineSyncBatch.findUnique({ where: { id: batchId } });
      if (existing) {
        outcome = {
          alreadySynced: true,
          appliedIds: existing.appliedEventIds,
          skipped: [],
        };
        return;
      }

      const arena = await tx.arena.findUnique({
        where: { id: arenaId },
        select: {
          targetScore: true,
          starveThreshold: true,
          emergencyWait: true,
          skipRestoresPriority: true,
          skipPickReplacement: true,
        },
      });
      if (!arena) throw new Error('ARENA_GONE');

      // Strict mode: the batch only applies to the exact board (and play
      // settings) it forked from. Best-effort skips this check because the
      // manager already saw the divergence and chose to apply anyway.
      if (mode === 'strict') {
        const board = await readBoardStateTx(tx, arenaId);
        const serverFingerprint = boardFingerprint(board, arena);
        if (serverFingerprint !== base?.fingerprint) {
          outcome = { divergence: true };
          return;
        }
      }

      // Clamp event times to the offline window: never in the future, never
      // before the session started (falling back to a 24h lookback when the
      // client clock produced garbage), and monotonic within the batch.
      const now = Date.now();
      const enteredMs = Date.parse(enteredAt ?? '');
      let prevMs = Math.min(Number.isFinite(enteredMs) ? enteredMs : now - 24 * 60 * 60 * 1000, now);

      const appliedIds = [];
      const skipped = [];
      for (const event of events) {
        try {
          // Structural validation lives inside the try so a malformed item is
          // treated like any other BAD_EVENT: skipped in best-effort mode,
          // rolled back in strict mode. A garbage event never advances the
          // monotonic clock.
          if (typeof event?.id !== 'string' || event.id.length > 80 || typeof event?.type !== 'string') {
            throw new Error('BAD_EVENT');
          }
          const atMs = Date.parse(event.occurredAt ?? '');
          prevMs = Math.max(prevMs, Math.min(Number.isFinite(atMs) ? atMs : prevMs, now));
          await applyEventTx(tx, arenaId, settings, event, { occurredAt: new Date(prevMs) });
          appliedIds.push(event.id);
        } catch (err) {
          const code = err?.message;
          const isReplayError = REPLAY_EVENT_ERRORS.has(code) || err?.code === 'P2002';
          if (!isReplayError) throw err; // infrastructure failure: abort loudly
          if (mode !== 'best-effort') throw err; // strict: roll back the batch
          skipped.push({ id: event.id, type: event.type, reason: code ?? 'P2002' });
        }
      }

      await tx.offlineSyncBatch.create({
        data: {
          id: batchId,
          arenaId,
          deviceLabel,
          appliedEventIds: appliedIds,
          skippedCount: skipped.length,
        },
      });
      // The offline session this batch came from is over: release the
      // advisory hold in the same transaction so other viewers' "running
      // the board offline" banner clears with the same state push. Scoped
      // to THIS manager's own hold, so a second manager who declared after
      // this session started keeps their notice (see releaseOfflineHold).
      await tx.arena.updateMany({
        where: { id: arenaId, offlineHolderLabel: offlineHoldLabel(guard.user) },
        data: { offlineHolderLabel: null, offlineHeldAt: null },
      });
      outcome = { appliedIds, skipped };
    });
  } catch (err) {
    if (err?.message === 'ARENA_GONE') {
      return { error: 'This arena no longer exists.', state: await getState(arenaId) };
    }
    if (REPLAY_EVENT_ERRORS.has(err?.message) || err?.code === 'P2002') {
      // Strict-mode replay failure: everything rolled back. Surface it as a
      // divergence so the client offers best-effort or discard.
      return { divergence: true, state: await getState(arenaId) };
    }
    throw err;
  }

  if (outcome?.divergence) {
    return { divergence: true, state: await getState(arenaId) };
  }
  return {
    state: await getState(arenaId),
    appliedIds: outcome?.appliedIds ?? [],
    skipped: outcome?.skipped ?? [],
    ...(outcome?.alreadySynced ? { alreadySynced: true } : {}),
  };
}

/**
 * Declare an advisory "this device is running the board offline" hold.
 * Fired best-effort by the client when a manager enters offline mode while
 * the server is still reachable (flaky connection, preemptive entry); a
 * fully offline device simply can't declare, which is fine: the hold is a
 * COURTESY BANNER for other viewers, never an enforcement mechanism. The
 * sync fingerprint check is what protects correctness. Last writer wins.
 * The Arena NOTIFY trigger broadcasts the change over the existing SSE
 * stream. Cleared by {@link releaseOfflineHold} and inside
 * {@link syncOfflineEvents}.
 */
export async function declareOfflineHold(arenaId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  await prisma.arena.updateMany({
    where: { id: arenaId },
    data: { offlineHolderLabel: offlineHoldLabel(guard.user), offlineHeldAt: new Date() },
  });
  return {};
}

/**
 * Clear the advisory offline hold, but only when THIS manager is the one
 * currently shown as holding it (manager-gated; see
 * {@link declareOfflineHold}).
 *
 * The scoping matters when two managers overlap: A declares, B declares
 * (last writer wins, so B is the displayed holder), then A finishes. An
 * unscoped clear would drop B's notice while B is still offline. Two
 * DEVICES of the same manager still clear each other, which is acceptable
 * for a courtesy banner.
 */
export async function releaseOfflineHold(arenaId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  await prisma.arena.updateMany({
    where: { id: arenaId, offlineHolderLabel: offlineHoldLabel(guard.user) },
    data: { offlineHolderLabel: null, offlineHeldAt: null },
  });
  return {};
}

/**
 * Toggle whether the session boundary auto-empties the rack. Manager-gated.
 * Decoupled from `updateArenaGeneral` so the Sessions settings section
 * matches the per-section action pattern of Schedule / Matchmaking /
 * Match Defaults.
 */
export async function updateArenaSessions(arenaId, { autoResetOnSession } = {}) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  if (typeof autoResetOnSession !== 'boolean') {
    return { error: 'autoResetOnSession must be true or false.' };
  }

  const updated = await prisma.arena.updateMany({
    where: { id: arenaId },
    data: { autoResetOnSession },
  });
  if (updated.count === 0) return { error: 'This arena no longer exists.' };
  return { sessions: { autoResetOnSession } };
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

// --- Invite links ---------------------------------------------------------

/** Shape an ArenaInvite row for the client (ISO date, no creator PII). */
function serializeInvite(invite) {
  return {
    id: invite.id,
    code: invite.code,
    mode: invite.mode,
    createdAt: new Date(invite.createdAt).toISOString(),
  };
}

/**
 * Create (or reuse) an active invite link of a given mode for an arena
 * (owner/organizer only). Idempotent per active mode: if a link of that mode is
 * already live it is returned as-is, so managers never accumulate duplicates —
 * "Regenerate" in the UI revokes first, then calls this to mint a fresh code.
 */
export async function createArenaInvite(arenaId, mode) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };
  if (!isInviteMode(mode)) return { error: 'Invalid invite type.' };

  // Take a per-arena advisory lock, then check-or-create inside one transaction
  // so concurrent managers can't both miss the existing-active check and mint
  // duplicate links of the same mode (the lock guarantees one active link per
  // mode without a DB-level partial-unique constraint Prisma can't express).
  // Re-run the whole transaction on the vanishingly rare unique-code collision,
  // since a failed `create` poisons the surrounding transaction.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockArenaInvites(tx, arenaId);
        // Re-validate authority under the lock: requireArenaManager ran before
        // the transaction, so a manager demoted/removed in the meantime could
        // otherwise mint a fresh active link (createdBy = themselves) that
        // escapes the very revocation their role-loss triggers.
        if (!(await callerCanManageInvites(tx, arenaId, guard.user.id))) {
          return { error: 'You no longer have permission to manage invite links.' };
        }
        const existing = await tx.arenaInvite.findFirst({
          where: { arenaId, mode, active: true },
          select: { id: true, code: true, mode: true, createdAt: true },
        });
        if (existing) return { ok: true, invite: serializeInvite(existing) };

        const invite = await tx.arenaInvite.create({
          data: { arenaId, mode, code: generateInviteCode(), createdBy: guard.user.id },
          select: { id: true, code: true, mode: true, createdAt: true },
        });
        return { ok: true, invite: serializeInvite(invite) };
      });
    } catch (err) {
      if (err?.code === 'P2002') continue; // code collision — fresh tx + code
      throw err;
    }
  }
  return { error: 'Could not create an invite link. Please try again.' };
}

/**
 * Revoke an invite link (owner/organizer only): flips `active` off so the link
 * 404s, keeping the row for auditing. Scoped to `arenaId` so a manager can only
 * revoke their own arena's invites.
 */
export async function revokeArenaInvite(arenaId, inviteId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };
  if (!inviteId) return { error: 'Invite not found.' };

  // Serialize against an in-flight redeem (same per-arena invite lock) so a
  // revoke is authoritative — a redeem mid-flight on a leaked link can't slip a
  // join past it.
  let outcome = { ok: true };
  await prisma.$transaction(async (tx) => {
    await lockArenaInvites(tx, arenaId);
    // Re-validate authority under the lock (see createArenaInvite).
    if (!(await callerCanManageInvites(tx, arenaId, guard.user.id))) {
      outcome = { error: 'You no longer have permission to manage invite links.' };
      return;
    }
    await tx.arenaInvite.updateMany({
      where: { id: inviteId, arenaId, active: true },
      data: { active: false },
    });
  });
  return outcome;
}

/**
 * Redeem an invite link (any signed-in user). Resolves the active invite by
 * `code`, then either auto-joins the user as a MEMBER + queued player
 * (AUTO_JOIN) or files a pending JoinRequest (APPROVAL). Owners and existing
 * members short-circuit to ALREADY_MEMBER. Returns a `status` the `/join`
 * route uses to route + message:
 * `JOINED` | `PENDING` | `ALREADY_MEMBER`, each with `arenaId`.
 */
export async function redeemArenaInvite(code) {
  const guard = await requireUser();
  if (guard.error) return { error: guard.error };
  if (!code) return { error: 'This invite link is no longer valid.' };

  const invite = await prisma.arenaInvite.findFirst({
    where: { code, active: true },
    select: { mode: true, arenaId: true, arena: { select: { ownerId: true } } },
  });
  if (!invite) return { error: 'This invite link is no longer valid.' };

  const { arenaId, mode } = invite;
  const userId = guard.user.id;

  // Already in (owner or existing member) — nothing to do.
  if (invite.arena.ownerId === userId) {
    return { ok: true, status: 'ALREADY_MEMBER', arenaId };
  }
  const membership = await prisma.arenaMembership.findUnique({
    where: { arenaId_userId: { arenaId, userId } },
  });
  if (membership) return { ok: true, status: 'ALREADY_MEMBER', arenaId };

  // Take the per-arena invite lock and re-check liveness inside the same
  // transaction as the write, so a revoke that lands between the read above and
  // the membership/request write wins (closes the redeem-vs-revoke TOCTOU).
  let outcome = null;
  await prisma.$transaction(async (tx) => {
    await lockArenaInvites(tx, arenaId);
    const live = await tx.arenaInvite.findFirst({
      where: { code, active: true },
      select: { id: true },
    });
    if (!live) {
      outcome = { error: 'This invite link is no longer valid.' };
      return;
    }

    if (mode === INVITE_MODES.AUTO_JOIN) {
      await lockQueue(tx, arenaId);
      // Resolve the user first and bail if the row vanished (concurrent account
      // deletion), mirroring approveJoinRequest — activateArenaPlayer would
      // otherwise dereference a null user.
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!user) {
        outcome = { error: 'Your account could not be found.' };
        return;
      }
      await tx.arenaMembership.upsert({
        where: { arenaId_userId: { arenaId, userId } },
        create: { arenaId, userId, role: ROLES.MEMBER },
        update: {}, // already a member somehow — keep their role
      });
      await activateArenaPlayer(tx, arenaId, user);
      // Clear any stale pending request now that they're a full member.
      await tx.joinRequest.deleteMany({ where: { arenaId, userId } });
      outcome = { ok: true, status: 'JOINED', arenaId };
      return;
    }

    // Re-check membership under the lock: the pre-transaction check ran before
    // the lock, so the user may have been admitted in the meantime (e.g. a
    // manager approved another of their requests). Filing a join request for an
    // existing member would surface a confusing pending row, so short-circuit.
    // (AUTO_JOIN needs no equivalent — its membership upsert + activateArenaPlayer
    // are already idempotent.)
    const memberNow = await tx.arenaMembership.findUnique({
      where: { arenaId_userId: { arenaId, userId } },
      select: { id: true },
    });
    if (memberNow) {
      outcome = { ok: true, status: 'ALREADY_MEMBER', arenaId };
      return;
    }

    // APPROVAL — same effect as requestToJoin: file a pending request (idempotent).
    await tx.joinRequest.upsert({
      where: { arenaId_userId: { arenaId, userId } },
      create: { arenaId, userId },
      update: {},
    });
    outcome = { ok: true, status: 'PENDING', arenaId };
  });

  return outcome;
}

/**
 * Request to be linked to an existing walk-in (orphan) Player in this arena.
 * Available to any member who does not already have a linked Player in this
 * arena; the request is queued for owner/organizer approval. The
 * `[arenaId, userId]` unique key enforces one open request per member —
 * resubmitting with a different `playerId` updates the existing row in place
 * so a member can switch their pick without cancelling first.
 */
export async function requestLinkPlayer(arenaId, playerId) {
  const guard = await requireUser();
  if (guard.error) return { error: guard.error };
  if (!arenaId || !playerId) return { error: 'Player not found.' };

  // All eligibility checks AND the upsert run inside `lockQueue` so a
  // concurrent direct-link, leave/remove, or player removal cannot invalidate
  // the checks before we write. Unique-constraint races (P2002) and FK races
  // (P2003 — e.g. the orphan got cascade-deleted between read and write) are
  // translated to the same user-facing messages.
  let errorMessage = '';
  try {
    await prisma.$transaction(async (tx) => {
      await lockQueue(tx, arenaId);

      const arena = await tx.arena.findUnique({ where: { id: arenaId } });
      if (!arena) {
        errorMessage = 'Arena not found.';
        return;
      }

      // The requester must be a member of this arena. Owners have a
      // membership row too (created on arena creation / kept in sync on
      // transfer), so a single membership check covers everyone — no
      // separate isOwner branch needed.
      const membership = await tx.arenaMembership.findUnique({
        where: { arenaId_userId: { arenaId, userId: guard.user.id } },
      });
      if (!membership) {
        errorMessage = 'Join the arena before requesting a player link.';
        return;
      }

      // NOTE: we intentionally do NOT block when the requester already has
      // a linked Player here. `approveJoinRequest` auto-creates a fresh
      // Player on join (`activateArenaPlayer`), so every member arrives
      // with one — gating on that would make the canonical "claim my
      // historical walk-in" flow unreachable. `applyLinkPlayerToMember`
      // handles the merge: it folds the existing Player's stats into the
      // walk-in row, preserving everything.

      // The target must be a walk-in (orphan) Player in this arena.
      const target = await tx.player.findFirst({
        where: { id: playerId, arenaId },
        select: { id: true, userId: true, leftAt: true },
      });
      if (!target) {
        errorMessage = 'That player no longer exists.';
        return;
      }
      if (target.userId) {
        errorMessage = 'That player is already linked to an account.';
        return;
      }
      if (target.leftAt) {
        errorMessage = 'That player is no longer active in this arena.';
        return;
      }

      // Block if another member has a pending request against the same orphan.
      const existingForPlayer = await tx.linkRequest.findUnique({
        where: { arenaId_playerId: { arenaId, playerId } },
        select: { userId: true },
      });
      if (existingForPlayer && existingForPlayer.userId !== guard.user.id) {
        errorMessage = 'Another member already requested to be linked to that player.';
        return;
      }

      await tx.linkRequest.upsert({
        where: { arenaId_userId: { arenaId, userId: guard.user.id } },
        create: { arenaId, userId: guard.user.id, playerId },
        update: { playerId }, // member switched their pick before approval
      });
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      return { error: 'Another member already requested to be linked to that player.' };
    }
    if (err?.code === 'P2003') {
      return { error: 'That player no longer exists.' };
    }
    throw err;
  }
  if (errorMessage) return { error: errorMessage };
  return { ok: true };
}

/**
 * Approve a pending link request (owner or organizer): the walk-in Player is
 * merged into the requesting member via `applyLinkPlayerToMember`, and the
 * request row is consumed.
 */
export async function approveLinkRequest(arenaId, requestId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  let reason = '';
  await prisma.$transaction(async (tx) => {
    await lockQueue(tx, arenaId);
    const request = await tx.linkRequest.findFirst({
      where: { id: requestId, arenaId },
      select: { id: true, userId: true, playerId: true },
    });
    if (!request) {
      reason = 'NO_REQUEST';
      return;
    }
    const result = await applyLinkPlayerToMember(tx, arenaId, request.playerId, request.userId);
    if (result.reason) {
      reason = result.reason;
      // Terminal reasons can never become approvable later (the orphan is
      // gone, already linked, or the requester has since left the arena),
      // so consume the row to clear the queue. `MEMBER_PLAYING` is
      // retriable once the match ends — keep the row so the manager can
      // try again from the same place in the list.
      if (reason !== 'MEMBER_PLAYING') {
        await tx.linkRequest.deleteMany({ where: { id: request.id } });
      }
      return;
    }
    // Belt-and-suspenders cleanup by request id. `applyLinkPlayerToMember`
    // already deletes by `userId` OR `playerId` on success (which covers
    // this row), so this line is effectively a no-op there. Kept explicit
    // so future maintainers reading the approve path see the contract
    // ("the request is gone after a successful approve") without having
    // to trace through the shared helper.
    await tx.linkRequest.deleteMany({ where: { id: request.id } });
  });

  if (reason === 'NO_REQUEST') return { error: 'That link request no longer exists.' };
  if (reason) return { error: LINK_PLAYER_MESSAGES[reason] };
  return { ok: true };
}

/** Reject (delete) a pending link request (owner or organizer). */
export async function rejectLinkRequest(arenaId, requestId) {
  const guard = await requireArenaManager(arenaId);
  if (guard.error) return { error: guard.error };

  await prisma.linkRequest.deleteMany({ where: { id: requestId, arenaId } });
  return { ok: true };
}

/**
 * Cancel your own pending link request in this arena. Deliberately does not
 * gate on arena membership (unlike `requestLinkPlayer`): the delete is
 * scoped by `userId`, so a non-member call simply matches zero rows. Cheap,
 * symmetric with "leave deletes my own state", and avoids a wasted lookup.
 */
export async function cancelLinkRequest(arenaId) {
  const guard = await requireUser();
  if (guard.error) return { error: guard.error };
  if (!arenaId) return { error: 'Arena not found.' };

  await prisma.linkRequest.deleteMany({ where: { arenaId, userId: guard.user.id } });
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
    // Invite lock before queue lock: keeps the global order consistent with
    // redeemArenaInvite so role-loss invite revocation is serialized against an
    // in-flight redeem (authoritative) without risking a deadlock.
    await lockArenaInvites(tx, arenaId);
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

  // Update the role and revoke a demoted manager's links in ONE transaction
  // under the invite lock. Doing both atomically (vs role-update then a separate
  // revoke tx) closes the window where a just-demoted organizer could race a
  // createArenaInvite — which now re-checks role under the same lock — to mint a
  // fresh link, and avoids leaving links live if a second tx failed.
  return prisma.$transaction(async (tx) => {
    await lockArenaInvites(tx, arenaId);
    // role: { not: OWNER } is belt-and-suspenders — never touch the owner row.
    const updated = await tx.arenaMembership.updateMany({
      where: { arenaId, userId, role: { not: ROLES.OWNER } },
      data: { role },
    });
    if (updated.count === 0) return { error: 'That user is not a member of this arena.' };
    if (role === ROLES.MEMBER) {
      await tx.arenaInvite.updateMany({
        where: { arenaId, createdBy: userId, active: true },
        data: { active: false },
      });
    }
    return { ok: true };
  });
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
    // Invite lock before queue lock — see leaveArena: serializes this member's
    // invite revocation against an in-flight redeem, deadlock-free.
    await lockArenaInvites(tx, arenaId);
    await lockQueue(tx, arenaId);
    removed = await removeArenaMember(tx, arenaId, userId);
  });
  if (!removed) {
    return { error: "Can't remove this member while they're on an active court. Finish their match first." };
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
