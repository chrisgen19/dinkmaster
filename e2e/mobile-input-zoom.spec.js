import { test, expect } from '@playwright/test';
import { registerAndSignIn } from './helpers';

/**
 * iOS Safari zooms the page in whenever you focus an input whose computed
 * font-size is under 16px, and it does not zoom back out afterwards. The whole
 * layout is left magnified mid-session, which on the Prep roster means the
 * manager loses sight of the rack while typing a name.
 *
 * Nothing about that is visible in review — the markup looks fine and every
 * desktop browser behaves — so it is asserted here instead, on computed styles
 * at phone width. `text-base sm:text-sm` is the fix: 16px on touch, unchanged
 * on desktop.
 *
 * SCOPE: the Prep roster only. `/login` and `/register` still sit at 14px and
 * will fail this if extended to them; that is a known follow-up, not an
 * oversight.
 */
const PHONE = { width: 390, height: 780 };

/** Computed font-size of every visible input, smallest first. */
async function inputFontSizes(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('input, textarea, select')]
      .filter((el) => el.offsetParent !== null && el.type !== 'hidden')
      .map((el) => ({
        px: parseFloat(getComputedStyle(el).fontSize),
        name: el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.type,
      }))
      .sort((a, b) => a.px - b.px),
  );
}

test('prep roster inputs do not trigger iOS zoom at phone width', async ({ page }) => {
  // Build at desktop width: the arena page's Add button sits behind the mobile
  // nav at 390px. The measurements below all happen back at phone width.
  await page.setViewportSize({ width: 1280, height: 900 });
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

  await page.setViewportSize(PHONE);

  const walkInFields = await inputFontSizes(page);
  expect(walkInFields.length, 'walk-in form should expose both name inputs').toBe(2);
  expect(walkInFields.filter((f) => f.px < 16)).toEqual([]);

  await dialog.getByRole('button', { name: 'Done adding walk-ins' }).click();
  await expect(dialog.getByPlaceholder('Search players…')).toBeVisible();

  const searchField = await inputFontSizes(page);
  expect(searchField.length, 'search bar should be the only input on show').toBe(1);
  expect(searchField.filter((f) => f.px < 16)).toEqual([]);
});
