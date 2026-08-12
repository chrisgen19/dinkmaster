import { defineConfig, devices } from '@playwright/test';
import { e2eDatabaseUrl } from './e2e/e2e-database.js';

/**
 * Playwright e2e config. Tests run against a real dev server (started below)
 * and a real database, since the auth flow writes User/Session rows.
 *
 * That database is a THROWAWAY one, never the database you develop against —
 * see `e2e/e2e-database.js` and `e2e/global-setup.js`, which create it,
 * migrate it, and empty it before every run.
 */
export default defineConfig({
  testDir: './e2e',
  // Offline/PWA specs need a production build (the service worker is
  // disabled in dev) and run via playwright.offline.config.js instead.
  testIgnore: '**/offline-*.spec.js',
  globalSetup: './e2e/global-setup.js',
  // 60s, not 30: this config never reuses a running server (see below), so the
  // first spec to touch a route pays `next dev`'s on-demand compilation. The
  // old 30s budget left almost no headroom for that once a spec did any real
  // work, which is how a slow directory page turned into a "flaky" suite.
  timeout: 60_000,
  // Generous expect timeout: the first navigation to a route in `next dev`
  // triggers on-demand compilation, which can exceed the 5s default.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry, so `trace: 'on-first-retry'` below can actually produce a
  // trace — with the default of 0 retries it never fired, and a failure left
  // nothing to inspect. A spec that passes only on retry still reports as
  // flaky, so this hides nothing.
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3022',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Port 3022: 3020 is `pnpm dev`, 3021 is the offline config. Its own port
    // plus `reuseExistingServer: false` means a running dev server is never
    // reused — which matters more than it sounds. A reused dev server holds
    // the DEVELOPMENT database connection and whatever modules it compiled
    // before your last edit, so the suite would either write to the wrong
    // database or test stale code, both of which look like product bugs.
    // BETTER_AUTH_URL must follow the port or Better Auth rejects the
    // sign-up/sign-in calls as cross-origin.
    command: 'next dev -p 3022',
    url: 'http://localhost:3022',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      BETTER_AUTH_URL: 'http://localhost:3022',
    },
  },
});
