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
 * suffixing the database name (`dinkmaster` -> `dinkmaster_e2e`). Each suite
 * has its OWN escape hatch — `E2E_DATABASE_URL` and
 * `E2E_OFFLINE_DATABASE_URL` — because a single shared override would collapse
 * both suites onto one database and quietly undo the isolation below.
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
 * `.env` is loaded FIRST, so an override written there works the same as one
 * exported by the shell — otherwise the documented escape hatch would be
 * silently ignored for anyone who put it in the obvious place.
 *
 * @param {object} [options]
 * @param {string} [options.suffix='e2e'] - appended to the development database name.
 * @param {string} [options.overrideVar='E2E_DATABASE_URL'] - env var that replaces
 *   the derived URL outright. Per-suite by design; see the module comment.
 * @returns {string}
 * @throws {Error} when no `DATABASE_URL` is available to derive from, or when
 *   the result would point at the development database.
 */
export function e2eDatabaseUrl({ suffix = 'e2e', overrideVar = 'E2E_DATABASE_URL' } = {}) {
  loadDotEnv();

  const override = process.env[overrideVar];
  if (override) return assertNotDevelopmentDatabase(override, overrideVar);

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      `e2e needs DATABASE_URL (or ${overrideVar}) to derive its throwaway database.`,
    );
  }

  const url = new URL(base);
  // Decode before appending: a name with escaped characters ("my%20db") would
  // otherwise have the suffix stapled to the ESCAPE, and `pg` decodes the
  // pathname when it connects — so we'd create one database and connect to
  // another. Re-encoded on the way out for the same reason.
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) throw new Error(`DATABASE_URL names no database: ${base}`);
  url.pathname = `/${encodeURIComponent(`${name}_${suffix}`)}`;
  return url.toString();
}

/**
 * Refuse a URL that resolves to the development database.
 *
 * Global setup TRUNCATES whatever it is handed, so a mistyped override would
 * not merely run tests in the wrong place — it would delete the rows you
 * develop against. Cheap to check, catastrophic to miss.
 */
function assertNotDevelopmentDatabase(url, overrideVar) {
  const dev = process.env.DATABASE_URL;
  if (!dev) return url;
  const same = (a, b) => {
    try {
      const x = new URL(a);
      const y = new URL(b);
      return x.host === y.host && databaseName(x.toString()) === databaseName(y.toString());
    } catch {
      return false; // unparseable: let Prisma produce the real error
    }
  };
  if (same(url, dev)) {
    throw new Error(
      `${overrideVar} points at the development database (${databaseName(dev)}). ` +
        'e2e empties its database before every run, so this is refused.',
    );
  }
  return url;
}

/** Same server, but pointed at the default maintenance database, so the e2e
 *  one can be created from a connection that doesn't depend on it existing. */
export function maintenanceUrl(e2eUrl) {
  const url = new URL(e2eUrl);
  url.pathname = '/postgres';
  return url.toString();
}

/** The database name inside a connection string, decoded as `pg` will read it. */
export function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}
