import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { databaseName, e2eDatabaseUrl, maintenanceUrl } from './e2e-database.js';

const run = promisify(execFile);

/**
 * Prepare the throwaway e2e database before any spec runs:
 *
 *   1. create it if this is the first run on this machine,
 *   2. bring it up to the current schema (`prisma migrate deploy`),
 *   3. empty every table, so each run starts from nothing.
 *
 * Step 3 is the point. Test data used to pile up run after run in the
 * development database until the suite strangled itself (#163); truncating at
 * the start means the suite can never be slowed by its own history, and a
 * failed run leaves its rows behind for inspection rather than being wiped on
 * the way out.
 *
 * Shared by both Playwright configs, so neither suite can write to the
 * database you develop against. Each passes its own database through its
 * `webServer.env`, which is what this reads — so the two suites prepare
 * different databases and can run at the same time.
 */
export default async function globalSetup(config) {
  const url = config?.webServer?.env?.DATABASE_URL ?? e2eDatabaseUrl();
  const name = databaseName(url);

  const admin = new pg.Client({ connectionString: maintenanceUrl(url) });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) {
      // No parameter binding for identifiers, and `name` is derived from the
      // developer's own DATABASE_URL rather than any request input.
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`[e2e] created database ${name}`);
    }
  } finally {
    await admin.end();
  }

  await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
  });

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    // Everything except Prisma's own migration ledger, which must survive or
    // the next `migrate deploy` would try to replay every migration.
    const { rows } = await db.query(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'`,
    );
    if (rows.length > 0) {
      const list = rows.map((r) => `"${r.tablename.replace(/"/g, '""')}"`).join(', ');
      // One statement so foreign keys never block the order, and identities
      // restart so ids don't creep upward across runs.
      await db.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
    console.log(`[e2e] ${name} ready (${rows.length} tables emptied)`);
  } finally {
    await db.end();
  }
}
