import { defineConfig, devices } from '@playwright/test';
import { e2eDatabaseUrl } from './e2e/e2e-database.js';

// Let context.route() intercept requests issued BY the service worker.
// Without this, aborting/offlining page requests leaves SW-initiated fetches
// untouched, so a NetworkOnly navigation still reaches the server and the
// offline fallback shell can never be exercised. Must be set before any
// browser launches, hence here in the config module.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

/**
 * Offline/PWA e2e config. Runs against a PRODUCTION build (`next build` +
 * `next start`) because the service worker is disabled in development
 * (layout.js gates registration on NODE_ENV), so `pnpm test:e2e`'s dev
 * server can never exercise precache, the offline fallback shell, or
 * anything SW-driven. Slower to boot (full build), so it's a separate
 * config with its own script: `pnpm test:e2e:offline`.
 *
 * Shares the dev-server config's throwaway database and global setup, so
 * neither suite writes to the database you develop against.
 */
export default defineConfig({
  testDir: './e2e',
  // Only the offline specs; the dev-server config ignores this same glob.
  testMatch: '**/offline-*.spec.js',
  globalSetup: './e2e/global-setup.js',
  // Same reasoning as the dev-server config: `trace: 'on-first-retry'` below
  // is dead config without a retry, and these specs are the ones whose
  // failures are hardest to reconstruct after the fact.
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3021',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium-prod', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Port 3021, NOT the dev server's 3020: with `reuseExistingServer` a
    // running `pnpm dev` would otherwise be reused, and the service worker
    // is disabled in development, so every offline assertion would fail
    // against a server that never registers one.
    // BETTER_AUTH_URL must follow the port or Better Auth rejects the
    // sign-up/sign-in calls as cross-origin.
    command: 'pnpm build && PORT=3021 BETTER_AUTH_URL=http://localhost:3021 pnpm start',
    url: 'http://localhost:3021',
    // Its OWN e2e database, not the development one and not the dev-server
    // suite's — global setup empties whichever database it prepares, so a
    // shared one would let a concurrent run wipe this one mid-test. `pnpm
    // start` runs `migrate deploy` against it too, a no-op after setup.
    // Its own override var too, so pointing one suite elsewhere can't
    // silently collapse both onto the same database.
    env: {
      DATABASE_URL: e2eDatabaseUrl({
        suffix: 'e2e_offline',
        overrideVar: 'E2E_OFFLINE_DATABASE_URL',
      }),
      // Its own build directory too, so this config's production build can't
      // overwrite the `.next` your dev server is serving from — which used to
      // mean an offline run left `pnpm dev` handing out chunks the build had
      // just deleted.
      NEXT_DIST_DIR: '.next-e2e-offline',
    },
    // Never reuse a server here, unlike the dev config. This command REBUILDS
    // into .next, so a leftover server from an interrupted run would keep
    // serving a precache manifest whose hashed chunks the new build just
    // deleted: the service worker then hangs in `installing` and every
    // offline assertion fails in a way that looks like a product bug.
    // Always starting fresh also makes an occupied port fail loudly.
    reuseExistingServer: false,
    timeout: 300_000, // full production build + migrate deploy
  },
});
