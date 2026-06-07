import { test, expect } from '@playwright/test';
import * as path from 'path';

// Opt-in helper, not part of the regular suite: capturing a full-page PNG on
// every `pnpm test:e2e` run would add time and an artifact write for nothing.
// Run with: E2E_CAPTURE_HOMEPAGE=1 pnpm test:e2e -- e2e/screenshot.spec.js
test('capture homepage screenshot', async ({ page }) => {
  test.skip(!process.env.E2E_CAPTURE_HOMEPAGE, 'Set E2E_CAPTURE_HOMEPAGE=1 to enable');
  await page.goto('/');
  // Wait on a stable signal instead of a fixed sleep: too short on a cold
  // dev-server compile, wasteful on warm runs.
  await expect(page.getByRole('heading', { name: /Ditch the Whiteboard/i })).toBeVisible();

  const screenshotPath = path.resolve('homepage_screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);
});
