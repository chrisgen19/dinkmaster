import { test } from '@playwright/test';
import * as path from 'path';

test('capture homepage screenshot', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000);
  
  const screenshotPath = path.resolve('homepage_screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);
});
