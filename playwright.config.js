import os from 'node:os';
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
  // Explicit, rather than Playwright's default (which also claims `*.test.js`):
  // the e2e harness has vitest unit tests beside its specs, and Playwright must
  // not try to run them. `.spec.js` is Playwright, `.test.js` is vitest.
  testMatch: '**/*.spec.js',
  // Offline/PWA specs need a production build (the service worker is
  // disabled in dev) and run via playwright.offline.config.js instead.
  testIgnore: '**/offline-*.spec.js',
  globalSetup: './e2e/global-setup.js',
  // 90s, not the old 30s. This config never reuses a running server and builds
  // into its own directory (see below), so the first run after a fresh
  // checkout compiles every route from cold — measured, that pushed the
  // heaviest specs past a 60s budget while a `pnpm dev` server competed for
  // the machine. Later runs reuse `.next-e2e` and finish well inside it.
  timeout: 90_000,
  // Generous expect timeout: the first navigation to a route in `next dev`
  // triggers on-demand compilation, which can exceed the 5s default.
  //
  // 15s is enough, and the temptation to raise it should be resisted. When five
  // unrelated specs once blew this budget at the same time, on-demand
  // compilation looked like the obvious culprit and was NOT the cause — see the
  // `workers` note below for the measurements. Raising it would have hidden an
  // oversubscribed machine behind a number that looked merely conservative.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Capped, NOT Playwright's local default of half the cores (6 here). Nine
  // spec files across six workers means six browsers driving ONE `next dev`
  // server, and that server is the bottleneck: extra workers do not buy
  // throughput, they just oversubscribe the machine and stretch every
  // individual step.
  //
  // Measured on a 12-core box, the same create-arena spec:
  //   1 worker  -> 13s   (cold cache and warm cache both; compilation is NOT
  //                       the driver, which the `timeout` note above predates)
  //   6 workers -> 38s   (load average 13+, i.e. fully saturated)
  //
  // That ~3x stretch is what pushed steps past the 15s `expect` budget, and it
  // read as five unrelated specs failing in five different files — each worker
  // starving the others. A bigger budget would only have hidden it: the work
  // was not slow, it was starved.
  //
  // Two, not one: the suite still overlaps a browser's think-time with another
  // file's server work, so wall clock stays close to the uncapped run while
  // leaving headroom on a machine that is also running `pnpm dev`. Capping it
  // made the suite both steadier AND faster (3.5m vs 4.8m), because the retries
  // it stopped triggering cost more than the lost parallelism.
  //
  // One on CI, where a runner is typically 2-4 cores: two workers there is the
  // same oversubscription this cap exists to prevent, just at a smaller scale.
  //
  // Two is a CEILING, not a target. Playwright's own local default is
  // `ceil(cores / 2)`, which is 1 on a 2-core box (a Codespace, a constrained
  // container) — so hard-coding 2 there would RAISE concurrency and recreate
  // the very oversubscription this cap exists to prevent. Take whichever is
  // lower, and never go below 1.
  //
  // Raise either number only with a measured before/after, and remember
  // `pnpm test:e2e:offline` may be running at the same time on its own server
  // (that config needs no cap — it has a single spec file, so it is already
  // effectively one worker).
  workers: process.env.CI ? 1 : Math.max(1, Math.min(2, Math.ceil(os.cpus().length / 2))),
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
      // Its own build directory, which is what actually lets this server
      // coexist with `pnpm dev`: Next refuses a second `next dev` for the
      // same project directory whatever port it is given. Also keeps the two
      // compilation caches apart, so neither can serve the other's stale
      // modules. See `distDir` in next.config.mjs.
      NEXT_DIST_DIR: '.next-e2e',
    },
  },
});
