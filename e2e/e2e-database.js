/**
 * The throwaway database the e2e suites run against.
 *
 * Every e2e run registers users and creates arenas, and nothing cleaned up
 * after them — so a shared database silently accumulated hundreds of test
 * arenas. That isn't just untidy: `/arenas` renders every arena it finds, so
 * the directory got slower with each run until the multi-login spec crossed
 * its 30s timeout and failed deterministically (see the analysis in #163).
 *
 * So the suites get their own database, derived from `DATABASE_URL` by
 * suffixing the database name (`dinkmaster` -> `dinkmaster_e2e`). Set
 * `E2E_DATABASE_URL` to point somewhere else entirely.
 *
 * Each config passes its OWN suffix, so the dev-server suite and the offline
 * suite never share a database. They can be run at the same time — which
 * matters because global setup empties the database on the way in, and a
 * shared one would let whichever started second wipe the other mid-run.
 *
 * Nothing here writes to the development database.
 */

/** Load `.env` into `process.env` without clobbering anything already set. */
function loadDotEnv() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Absent or unreadable: the caller falls back to the ambient environment,
    // which is how CI would supply these.
  }
}

/**
 * Connection string for a suite's e2e database.
 *
 * @param {string} [suffix='e2e'] - appended to the development database name.
 * @returns {string}
 * @throws {Error} when no `DATABASE_URL` is available to derive from.
 */
export function e2eDatabaseUrl(suffix = 'e2e') {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;

  loadDotEnv();
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'e2e needs DATABASE_URL (or E2E_DATABASE_URL) to derive its throwaway database.',
    );
  }

  const url = new URL(base);
  // pathname is "/<database>"; a trailing slash or empty name means the URL
  // never named one, which Prisma would reject anyway.
  const name = url.pathname.replace(/^\//, '');
  if (!name) throw new Error(`DATABASE_URL names no database: ${base}`);
  url.pathname = `/${name}_${suffix}`;
  return url.toString();
}

/** Same server, but pointed at the default maintenance database, so the e2e
 *  one can be created from a connection that doesn't depend on it existing. */
export function maintenanceUrl(e2eUrl) {
  const url = new URL(e2eUrl);
  url.pathname = '/postgres';
  return url.toString();
}

/** The database name inside a connection string. */
export function databaseName(url) {
  return new URL(url).pathname.replace(/^\//, '');
}
