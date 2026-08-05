import { test, expect } from '@playwright/test';
import { registerAndSignIn } from './helpers';

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 780 };

test('prep roster uses pointer-appropriate dismiss controls and ignores backdrop taps', async ({
  page,
  context,
}) => {
  // Open the roster at desktop width: the arena page's Add button sits behind
  // the mobile navigation at phone width.
  await page.setViewportSize(DESKTOP);
  await registerAndSignIn(page, { firstName: 'Dismiss', lastName: 'Check' });

  await page.getByRole('link', { name: /New arena/ }).click();
  await page.getByPlaceholder(/Saturday Open Play/).fill(`Dismiss ${Date.now()}`);
  await page.getByRole('button', { name: 'Create arena' }).click();
  await expect(page).toHaveURL(/\/arena\/.+/);

  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Prep roster' });
  await expect(dialog).toBeVisible();

  const headerDismiss = dialog.getByRole('button', { name: 'Done, close roster' });
  const headerDoneLabel = headerDismiss.getByText('Done', { exact: true });
  const headerCloseIcon = headerDismiss.locator('svg');
  const footerDismiss = dialog.getByTestId('prep-roster-footer-done');

  // Fine pointers keep the compact header icon and the existing footer action.
  await expect(headerDoneLabel).toBeHidden();
  await expect(headerCloseIcon).toBeVisible();
  await expect(footerDismiss).toBeVisible();

  // Switch the input modality as well as the viewport. Width alone must not
  // choose the control because a phone can clear a width breakpoint in landscape.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.setViewportSize(PHONE);

  await expect(headerDoneLabel).toBeVisible();
  await expect(headerCloseIcon).toBeHidden();
  await expect(headerDismiss).toHaveCSS('min-height', '44px');
  await expect(footerDismiss).toBeHidden();

  // Outside taps are deliberately inert for this immediate-save management
  // workflow; users dismiss it explicitly with Done/close or Escape.
  await page.getByTestId('prep-roster-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toBeVisible();
});
