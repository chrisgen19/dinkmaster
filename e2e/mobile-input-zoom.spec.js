import { test, expect } from '@playwright/test';
import { registerAndSignIn } from './helpers';

/**
 * iOS Safari zooms the page in whenever you focus an input whose computed
 * font-size is under 16px, and it does not zoom back out afterwards. The whole
 * layout is left magnified mid-session, which on the Prep roster means the
 * manager loses sight of the rack while typing a name.
 *
 * The fix is `text-base pointer-fine:text-sm`, keyed off pointer type rather
 * than a width breakpoint. `sm:text-sm` looks equivalent and is not: a phone in
 * landscape reports a layout width well past `sm` (750px on a 13, 814px on a
 * 14 Pro Max) while still being the same zooming touch device, so a width
 * breakpoint puts the bug straight back the moment the manager rotates.
 *
 * Nothing about that is visible in review — the markup looks fine and every
 * desktop browser behaves — so it is asserted here on computed styles, in both
 * orientations, plus the desktop half so the compact type can't silently grow.
 *
 * This is a computed-style proxy, not a WebKit behaviour test: the suite runs
 * Chromium only (see playwright.config.js), so it can prove the CSS resolves to
 * >=16px under a coarse pointer but cannot observe Safari actually zooming.
 *
 * SCOPE: the Prep roster only. `/login` and `/register` still sit at 14px and
 * will fail this if extended to them; that is a known follow-up, not an
 * oversight.
 */
const DESKTOP = { width: 1280, height: 900 };

/** Layout sizes of an iPhone 13, whose landscape width (750) clears `sm`. */
const ORIENTATIONS = [
  ['portrait', { width: 390, height: 780 }],
  ['landscape', { width: 750, height: 390 }],
];

/**
 * Computed font-size of every visible input inside `root`, smallest first.
 * Scoped to the modal rather than the document so an input added elsewhere on
 * the arena page can never shift the counts asserted below.
 */
async function inputFontSizes(root) {
  return root.evaluate((el) =>
    [...el.querySelectorAll('input, textarea, select')]
      .filter((node) => node.checkVisibility() && node.type !== 'hidden')
      .map((node) => ({
        px: parseFloat(getComputedStyle(node).fontSize),
        name:
          node.getAttribute('placeholder') || node.getAttribute('aria-label') || node.type,
      }))
      .sort((a, b) => a.px - b.px),
  );
}

/** Assert `count` inputs are all >=16px in both phone orientations. */
async function expectNoZoom(page, dialog, count, what) {
  for (const [label, size] of ORIENTATIONS) {
    await page.setViewportSize(size);
    const fields = await inputFontSizes(dialog);
    expect(fields.length, `${what} in ${label}`).toBe(count);
    expect(fields.filter((f) => f.px < 16), `${what} zooms iOS in ${label}`).toEqual([]);
  }
}

test('prep roster inputs do not trigger iOS zoom on a touch device', async ({
  page,
  context,
}) => {
  // Build at desktop width: the arena page's Add button sits behind the mobile
  // nav at 390px. The measurements below all happen back at phone width.
  await page.setViewportSize(DESKTOP);
  await registerAndSignIn(page, { firstName: 'Zoom', lastName: 'Check' });

  await page.getByRole('link', { name: /New arena/ }).click();
  await page.getByPlaceholder(/Saturday Open Play/).fill(`Zoom ${Date.now()}`);
  await page.getByRole('button', { name: 'Create arena' }).click();
  await expect(page).toHaveURL(/\/arena\/.+/);

  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Prep roster' });
  await expect(dialog).toBeVisible();

  // The search field only renders once the roster passes ROSTER_SEARCH_MIN, so
  // stock it first — otherwise this test would silently assert on nothing.
  await dialog.getByRole('button', { name: '+ Walk-in' }).click();
  for (const name of ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay']) {
    await dialog.getByPlaceholder('First name').fill(name);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
  }

  // Desktop half, measured while the pointer is still fine. Without this a fix
  // that drops the variant and leaves a bare `text-base` would pass everything
  // below while quietly enlarging the desktop form.
  const onDesktop = await inputFontSizes(dialog);
  expect(onDesktop.length, 'walk-in form should expose both name inputs').toBe(2);
  expect(onDesktop.map((f) => f.px), 'desktop keeps the compact type').toEqual([14, 14]);

  // Chromium derives `pointer: coarse` from touch emulation, which is a
  // context-level flag that setViewportSize does not touch. Without this the
  // page reports a fine pointer even at 390px and every check below is vacuous.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  await expectNoZoom(page, dialog, 2, 'walk-in name inputs');

  await page.setViewportSize(ORIENTATIONS[0][1]);
  await dialog.getByRole('button', { name: 'Done adding walk-ins' }).click();
  await expect(dialog.getByPlaceholder('Search players…')).toBeVisible();

  await expectNoZoom(page, dialog, 1, 'roster search field');
});
