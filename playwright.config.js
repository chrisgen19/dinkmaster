import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config. Tests run against a real dev server (started below)
 * and a real database, since the auth flow writes User/Session rows.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Generous expect timeout: the first navigation to a route in `next dev`
  // triggers on-demand compilation, which can exceed the 5s default.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
