import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { e2eDatabaseUrl, databaseName } from './e2e-database.js';

/**
 * Unit tests for the e2e database resolver. Worth testing despite being test
 * infrastructure: `e2e/global-setup.js` TRUNCATES whatever this returns, so a
 * hole in the development-database guard doesn't fail a test — it deletes the
 * rows you develop against.
 *
 * A `.test.js` file, so vitest runs it and Playwright (which matches
 * `*.spec.js`) does not.
 */

const DEV = 'postgres://user:pw@localhost:5432/dinkmaster';
const TOUCHED = ['DATABASE_URL', 'E2E_DATABASE_URL', 'E2E_OFFLINE_DATABASE_URL'];

/**
 * Stop `.env` from repopulating what a test just deleted.
 *
 * `e2eDatabaseUrl` loads `.env` on every call — deliberately, so an override
 * written there works — and a normal checkout has `DATABASE_URL` in it. So
 * `delete process.env.DATABASE_URL` alone does NOT produce an unconfigured
 * environment: the next call reads it straight back off disk.
 */
function withoutDotEnv() {
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {});
}

describe('e2eDatabaseUrl()', () => {
  const saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    delete process.env.E2E_DATABASE_URL;
    delete process.env.E2E_OFFLINE_DATABASE_URL;
    process.env.DATABASE_URL = DEV;
  });

  afterEach(() => {
    // Restored key by key, NOT by reassigning `process.env`. Assigning to it
    // replaces Node's live environment object with a plain one, after which
    // `process.loadEnvFile` writes stop showing up in `process.env` — which
    // silently made the two tests below pass for the wrong reason, and only
    // when the whole file ran in order.
    for (const key of TOUCHED) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  it('suffixes the development database name', () => {
    expect(databaseName(e2eDatabaseUrl())).toBe('dinkmaster_e2e');
  });

  it('gives each suite its own database', () => {
    const offline = e2eDatabaseUrl({
      suffix: 'e2e_offline',
      overrideVar: 'E2E_OFFLINE_DATABASE_URL',
    });
    expect(databaseName(offline)).toBe('dinkmaster_e2e_offline');
    expect(databaseName(offline)).not.toBe(databaseName(e2eDatabaseUrl()));
  });

  it('decodes an escaped database name before suffixing', () => {
    // Otherwise the suffix lands on the escape and `pg`, which decodes the
    // pathname when it connects, would reach a different database than the one
    // setup created.
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/my%20db';
    expect(databaseName(e2eDatabaseUrl())).toBe('my db_e2e');
  });

  it('honours an explicit override', () => {
    process.env.E2E_DATABASE_URL = 'postgres://user:pw@localhost:5432/somewhere_else';
    expect(e2eDatabaseUrl()).toBe('postgres://user:pw@localhost:5432/somewhere_else');
  });

  describe('development-database guard', () => {
    // Every spelling below names the SAME database as DEV. Setup truncates
    // what it is handed, so each of these has to be refused.
    it.each([
      ['identical', 'postgres://user:pw@localhost:5432/dinkmaster'],
      ['default port omitted', 'postgres://user:pw@localhost/dinkmaster'],
      ['loopback by ip', 'postgres://user:pw@127.0.0.1:5432/dinkmaster'],
      ['loopback by ip, no port', 'postgres://user:pw@127.0.0.1/dinkmaster'],
      ['different credentials', 'postgres://other:other@localhost:5432/dinkmaster'],
      ['percent-encoded name', 'postgres://user:pw@localhost:5432/dinkmaster'],
    ])('refuses an override that is the development database (%s)', (_label, override) => {
      process.env.E2E_DATABASE_URL = override;
      expect(() => e2eDatabaseUrl()).toThrow(/development database/i);
    });

    it('allows a different database on the same server', () => {
      process.env.E2E_DATABASE_URL = 'postgres://user:pw@localhost/dinkmaster_scratch';
      expect(() => e2eDatabaseUrl()).not.toThrow();
    });

    it('allows the same database name on a different server', () => {
      process.env.E2E_DATABASE_URL = 'postgres://user:pw@db.example.test:5432/dinkmaster';
      expect(() => e2eDatabaseUrl()).not.toThrow();
    });

    it('does not block when there is no development database to compare against', () => {
      withoutDotEnv();
      delete process.env.DATABASE_URL;
      process.env.E2E_DATABASE_URL = 'postgres://user:pw@localhost:5432/anything';
      expect(() => e2eDatabaseUrl()).not.toThrow();
    });
  });

  it('explains itself when nothing is configured', () => {
    withoutDotEnv();
    delete process.env.DATABASE_URL;
    expect(() => e2eDatabaseUrl()).toThrow(/DATABASE_URL/);
  });
});
