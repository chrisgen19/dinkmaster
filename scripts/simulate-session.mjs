/**
 * Simulate a live arena session against the real database.
 *
 * Usage (bundle first — it imports `@/` aliased ESM/TS sources):
 *   ./node_modules/.bin/esbuild scripts/simulate-session.mjs --bundle \
 *     --platform=node --format=esm --packages=external --alias:@=./src \
 *     --outfile=.sim-build.mjs
 *   node --env-file=.env .sim-build.mjs <arenaId> [matches] [--dry]
 *
 * `--dry` reads and prints the chosen matchups without writing anything. It
 * cannot advance the board (no court ever flips state), so it re-reads the
 * same top-4 each pass and stops at the round safety bound — use it to eyeball
 * one stacking decision, not to preview a whole session.
 *
 * Each round finishes every playing court and re-stacks it from the rack,
 * going through the SAME transaction helpers the server actions use
 * (`applyEndMatchTx` / `applyAutoMixTx` / `applyFillCourtTx`), so queue
 * fairness, partnership counts, Elo, match history AND the team split all
 * behave exactly as they do in production — no outcome is injected.
 *
 * The per-stack readout re-scores the split production chose using the same
 * `src/lib/pairing.js` helpers, so the printed crossed/gap/repeat numbers
 * describe the shipped rule rather than a copy of it.
 */
import { prisma } from '@/lib/prisma.js';
import {
  lockQueue,
  applyFillCourtTx,
  applyEndMatchTx,
  applyAutoMixTx,
} from '@/lib/board-apply.js';
import { RECENT_MATCH_WINDOW, rankMatchups, recentResults } from '@/lib/pairing.js';
import { eloToDupr } from '@/lib/rating.js';
import { validateMatchScore } from '@/lib/scoring.js';

const [arenaId, matchesArg, ...flags] = process.argv.slice(2);
const DRY_RUN = flags.includes('--dry');
const MAX_MATCHES = Number(matchesArg ?? 20);

if (!arenaId) {
  console.error('Usage: node .sim-build.mjs <arenaId> [matches] [--dry|--write]');
  process.exit(1);
}

// A simulated session writes real Match rows and permanently moves real Elo —
// `applyEndMatchTx` has no inverse, so a mistake here can only be undone by
// resetting the arena. Two guards, because arenas belonging to real clubs live
// in the same database as the sandbox ones:
//   1. refuse any non-local DATABASE_URL outright
//   2. require an explicit --write for the run to touch anything
if (!DRY_RUN) {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? '').hostname;
    } catch {
      return '';
    }
  })();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`Refusing to simulate against a non-local database (host: ${host || 'unparseable'}).`);
    process.exit(1);
  }
  if (!flags.includes('--write')) {
    console.error(
      'This writes real matches and moves real Elo, irreversibly.\n' +
        `Re-run with --write to simulate arena ${arenaId}, or --dry to inspect without writing.`,
    );
    process.exit(1);
  }
}

// --- Reporting helpers ----------------------------------------------------

const avg = (ratings) => (ratings[0] + ratings[1]) / 2;

/** The recent matches in the shape `src/lib/pairing.js` consumes, newest first. */
async function recentMatchesFor(tx) {
  const rows = await tx.match.findMany({
    where: { arenaId },
    orderBy: { createdAt: 'desc' },
    take: RECENT_MATCH_WINDOW,
    select: { score1: true, score2: true, players: { select: { playerId: true, team: true } } },
  });
  return rows.map((m) => ({
    score1: m.score1,
    score2: m.score2,
    team1: m.players.filter((mp) => mp.team === 1).map((mp) => mp.playerId),
    team2: m.players.filter((mp) => mp.team === 2).map((mp) => mp.playerId),
  }));
}

// --- Score generation -----------------------------------------------------

/** Expected win probability for team A, from the same Elo curve as rating.js. */
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));

/**
 * Invent a plausible, RULES-VALID scoreline: the favourite usually wins, and
 * the closer the two sides are rated, the closer the score (deuce included).
 */
function simulateScore(r1, r2, target) {
  const pTeam1 = expected(avg(r1), avg(r2));
  const team1Wins = Math.random() < pTeam1;
  // Closeness of the match drives how near the loser gets to the target.
  const closeness = 1 - Math.abs(pTeam1 - 0.5) * 2; // 1 = even, 0 = mismatch
  const deuce = Math.random() < 0.12 * closeness + 0.03;

  let winner = target;
  let loser = Math.min(
    target - 2,
    Math.max(0, Math.round((target - 2) * (0.35 + 0.55 * closeness * Math.random()))),
  );
  if (deuce) {
    const extra = 1 + Math.floor(Math.random() * 3);
    loser = target - 1 + extra - 1;
    winner = loser + 2;
  }
  const [s1, s2] = team1Wins ? [winner, loser] : [loser, winner];
  const check = validateMatchScore(String(s1), String(s2), target);
  if (!check.ok) throw new Error(`generated invalid score ${s1}-${s2}: ${check.reason}`);
  return { s1, s2 };
}

// --- Simulation -----------------------------------------------------------

const name = (p) => `${p.firstName}${p.lastName ? ` ${p.lastName}` : ''}`;
const dupr = (elo) => eloToDupr(elo).toFixed(3);

const stats = {
  matches: 0,
  fills: 0,
  fullyCrossed: 0,
  partiallyCrossed: 0,
  uncrossed: 0,
  gaps: [],
  repeatPairings: 0,
  margins: [],
};

async function run() {
  const arena = await prisma.arena.findUnique({
    where: { id: arenaId },
    select: { id: true, name: true, targetScore: true, autoMixDefault: true },
  });
  if (!arena) throw new Error(`Arena ${arenaId} not found`);
  const target = arena.targetScore;

  console.log(`\n▶ Simulating "${arena.name}" — ${MAX_MATCHES} matches to ${target}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  let round = 0;
  while (stats.matches < MAX_MATCHES) {
    round += 1;

    // 1. Finish every court that is currently playing.
    const playing = await prisma.court.findMany({
      where: { arenaId, status: 'playing' },
      orderBy: { position: 'asc' },
      include: { slots: { include: { player: true } } },
    });

    for (const court of playing) {
      if (stats.matches >= MAX_MATCHES) break;
      const t1 = court.slots.filter((s) => s.team === 1);
      const t2 = court.slots.filter((s) => s.team === 2);
      if (t1.length !== 2 || t2.length !== 2) {
        console.log(`  ⚠ ${court.name} has a malformed lineup (${court.slots.length} slots) — skipping`);
        continue;
      }
      const { s1, s2 } = simulateScore(
        t1.map((s) => s.player.rating),
        t2.map((s) => s.player.rating),
        target,
      );
      const winner = s1 > s2 ? t1 : t2;

      if (!DRY_RUN) {
        await prisma.$transaction(async (tx) => {
          await lockQueue(tx, arenaId);
          await applyEndMatchTx(tx, arenaId, { courtId: court.id, s1, s2 });
        });
      }
      stats.matches += 1;
      stats.margins.push(Math.abs(s1 - s2));
      console.log(
        `  R${round} ${court.name}: ${t1.map((s) => name(s.player)).join(' + ')} ${s1}-${s2} ` +
          `${t2.map((s) => name(s.player)).join(' + ')}  → ${winner.map((s) => name(s.player)).join(' + ')} win`,
      );

      // 2. Auto-mix the rack, exactly as endMatch does.
      const queuedCount = await prisma.player.count({
        where: { arenaId, leftAt: null, queueOrder: { not: null } },
      });
      if (arena.autoMixDefault && queuedCount > 4 && !DRY_RUN) {
        await prisma.$transaction(async (tx) => {
          await lockQueue(tx, arenaId);
          await applyAutoMixTx(tx, arenaId);
        });
      }
    }

    // 3. Re-stack every vacant court from the top of the rack.
    const vacant = await prisma.court.findMany({
      where: { arenaId, status: 'vacant' },
      orderBy: { position: 'asc' },
    });

    for (const court of vacant) {
      const filled = await fillOne(court);
      if (!filled) break; // not enough waiting players — stop trying other courts
    }

    if (round > MAX_MATCHES * 2 + 5) {
      console.log('  ⚠ stopping: rounds exceeded the safety bound (rack likely too small)');
      break;
    }
  }
}

/** Stack one vacant court with the balanced split. Returns false if the rack is short. */
async function fillOne(court) {
  let summary = null;

  const attempt = async (tx) => {
    const queued = await tx.player.findMany({
      where: { arenaId, leftAt: null, queueOrder: { not: null } },
      orderBy: { queueOrder: 'asc' },
      take: 4,
      select: { id: true, firstName: true, lastName: true, rating: true },
    });
    if (queued.length < 4) return false;

    // Snapshot the ranking inputs BEFORE the fill, so the readout can score
    // whichever split production settles on.
    const ids = queued.map((p) => p.id);
    const results = recentResults(await recentMatchesFor(tx), ids);
    const ratings = new Map(queued.map((p) => [p.id, p.rating]));
    const pairs = await tx.partnership.findMany({
      where: { arenaId, playerA: { in: ids }, playerB: { in: ids } },
    });
    const pairCount = (x, y) => {
      const [a, b] = x < y ? [x, y] : [y, x];
      return pairs.find((r) => r.playerA === a && r.playerB === b)?.count ?? 0;
    };
    const ranked = rankMatchups(ids, { results, ratings, pairCount });

    // No `outcome` — production's own rule picks the split.
    let chosen = ranked[0];
    if (!DRY_RUN) {
      await applyFillCourtTx(tx, arenaId, { courtId: court.id });
      const slots = await tx.courtSlot.findMany({
        where: { courtId: court.id },
        select: { playerId: true, team: true },
      });
      const team1 = slots.filter((s) => s.team === 1).map((s) => s.playerId);
      chosen = ranked.find((m) => m.team1.every((id) => team1.includes(id)) || m.team2.every((id) => team1.includes(id)));
      if (!chosen) throw new Error('production picked a split outside the three ranked options');
    }

    const label = (id) => {
      const p = queued.find((q) => q.id === id);
      return `${name(p)} [${results.get(id) ?? '-'} ${dupr(p.rating)}]`;
    };
    summary = { best: chosen, label, ids, alternatives: ranked };
    return true;
  };

  const ok = DRY_RUN
    ? await attempt(prisma)
    : await prisma.$transaction(async (tx) => {
        await lockQueue(tx, arenaId);
        return attempt(tx);
      });

  if (!ok) {
    console.log(`  … ${court.name} stays open (fewer than 4 waiting)`);
    return false;
  }

  const { best, label } = summary;
  stats.fills += 1;
  stats.gaps.push(best.ratingGap);
  stats.repeatPairings += best.repeats;
  if (best.crossCount === 2) stats.fullyCrossed += 1;
  else if (best.crossCount === 1) stats.partiallyCrossed += 1;
  else stats.uncrossed += 1;

  console.log(
    `     ↳ stack ${court.name}: ${best.team1.map(label).join(' + ')}  vs  ${best.team2.map(label).join(' + ')}` +
      `   (gap ${best.ratingGap.toFixed(1)} Elo, crossed ${best.crossCount}/2, repeats ${best.repeats})`,
  );
  return true;
}

async function report() {
  const players = await prisma.player.findMany({
    where: { arenaId, leftAt: null },
    orderBy: [{ rating: 'desc' }],
    select: { firstName: true, lastName: true, gamesPlayed: true, wins: true, losses: true, rating: true, queueOrder: true },
  });

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log('\n── Session summary ──────────────────────────────────');
  console.log(`matches played this run : ${stats.matches}`);
  console.log(`courts stacked          : ${stats.fills}`);
  console.log(
    `winner+loser pairing    : ${stats.fullyCrossed} both sides, ${stats.partiallyCrossed} one side, ${stats.uncrossed} neither`,
  );
  console.log(`mean team rating gap    : ${mean(stats.gaps).toFixed(1)} Elo (${(mean(stats.gaps) * 0.005).toFixed(3)} DUPR)`);
  console.log(`mean winning margin     : ${mean(stats.margins).toFixed(1)} points`);
  console.log(`repeat partnerships     : ${stats.repeatPairings} across ${stats.fills} stacks`);

  console.log('\n── Standings ────────────────────────────────────────');
  console.table(
    players.map((p) => ({
      player: name(p),
      dupr: dupr(p.rating),
      elo: p.rating,
      games: p.gamesPlayed,
      W: p.wins,
      L: p.losses,
      rack: p.queueOrder ?? 'on court',
    })),
  );
}

try {
  await run();
  await report();
} finally {
  await prisma.$disconnect();
}
