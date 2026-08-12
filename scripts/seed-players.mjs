/**
 * Seed walk-in players into an arena for simulation/testing.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-players.mjs <arenaId> [targetCount]
 *
 * Mirrors `addArenaPlayer` (src/lib/board-apply.js): each player is credited the
 * current group-average games metric via `gamesOffset` and appended to the bottom
 * of the rack under the same advisory lock the app uses.
 */
import pg from 'pg';
import { randomBytes } from 'node:crypto';

const QUEUE_LOCK_KEY = 920425;

const NAMES = [
  ['Miguel', 'Santos'], ['Andrea', 'Cruz'], ['Rafael', 'Reyes'], ['Bianca', 'Torres'],
  ['Diego', 'Ramos'], ['Camille', 'Villanueva'], ['Enzo', 'Mercado'], ['Patricia', 'Lim'],
  ['Nico', 'Aquino'], ['Jasmine', 'Dela Cruz'], ['Marco', 'Bautista'], ['Trisha', 'Gonzales'],
  ['Paolo', 'Navarro'], ['Kaye', 'Domingo'], ['Vince', 'Castillo'], ['Sofia', 'Alcantara'],
  ['Leo', 'Pascual'], ['Mika', 'Fernandez'], ['Jerome', 'Salazar'], ['Denise', 'Ocampo'],
  ['Carlo', 'Manalo'], ['Hannah', 'Ilagan'], ['Ryan', 'Escobar'], ['Bea', 'Tolentino'],
  ['Gabriel', 'Sarmiento'], ['Lara', 'Buenaventura'], ['Adrian', 'Yap'], ['Nadine', 'Panganiban'],
  ['Julian', 'Rivera'], ['Ella', 'Marquez'], ['Tristan', 'Abad'], ['Mariel', 'Cabrera'],
];

/** cuid-ish id: matches the shape of Prisma's `cuid()` output closely enough for seed rows. */
const makeId = () => `c${randomBytes(12).toString('hex')}`;

const [arenaId, targetArg] = process.argv.slice(2);
if (!arenaId) {
  console.error('Usage: node --env-file=.env scripts/seed-players.mjs <arenaId> [targetCount]');
  process.exit(1);
}
const target = Number(targetArg ?? 21);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [QUEUE_LOCK_KEY, arenaId]);

  const arena = await client.query('SELECT id, name FROM "Arena" WHERE id = $1', [arenaId]);
  if (arena.rowCount === 0) throw new Error(`Arena ${arenaId} not found`);

  const active = await client.query(
    'SELECT "firstName", "lastName", "gamesPlayed", "gamesOffset" FROM "Player" WHERE "arenaId" = $1 AND "leftAt" IS NULL',
    [arenaId],
  );
  const existing = active.rowCount;
  const toAdd = Math.max(0, target - existing);
  console.log(`Arena "${arena.rows[0].name}" has ${existing} active player(s); adding ${toAdd} to reach ${target}.`);
  if (toAdd === 0) {
    await client.query('COMMIT');
    process.exit(0);
  }

  // Group-average ordering metric, so seeded latecomers rotate as peers.
  const gamesOffset = existing
    ? Math.round(active.rows.reduce((sum, p) => sum + p.gamesPlayed + p.gamesOffset, 0) / existing)
    : 0;

  const maxOrder = await client.query(
    'SELECT COALESCE(MAX("queueOrder"), 0) AS max FROM "Player" WHERE "arenaId" = $1 AND "leftAt" IS NULL',
    [arenaId],
  );
  let order = Number(maxOrder.rows[0].max);

  const taken = new Set(active.rows.map((p) => `${p.firstName} ${p.lastName ?? ''}`.trim()));
  const pool = NAMES.filter(([f, l]) => !taken.has(`${f} ${l}`));
  if (pool.length < toAdd) throw new Error(`Only ${pool.length} unused seed names available for ${toAdd} players`);

  const added = [];
  for (let i = 0; i < toAdd; i++) {
    const [firstName, lastName] = pool[i];
    order += 1;
    await client.query(
      `INSERT INTO "Player" (id, "arenaId", "userId", "firstName", "lastName", "queueOrder", "gamesOffset", "createdAt")
       VALUES ($1, $2, NULL, $3, $4, $5, $6, NOW())`,
      [makeId(), arenaId, firstName, lastName, order, gamesOffset],
    );
    added.push(`${firstName} ${lastName} (#${order})`);
  }

  await client.query('COMMIT');
  console.log(`Added ${added.length}: ${added.join(', ')}`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
