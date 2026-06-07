import { test, expect } from '@playwright/test';
import { uniqueEmail, PASSWORD, fillRegisterForm } from './helpers';

// E2E coverage for the manager skip-with-replacement picker modal lifecycle.
// The server action (skipPlayer) is unit-tested in actions.test.js; this spec
// covers the CLIENT orchestration that unit tests can't reach: the modal
// opening, the "confirm disabled until a replacement is picked" contract,
// confirming a pick, the dismiss paths (Escape / Cancel), and the
// keep-open-on-raced-replacement retry branch.

/**
 * Register a fresh owner (with a known email so a second session can log in as
 * them) and land on a new arena they manage.
 */
async function registerAndCreateArena(page, arenaName, email = uniqueEmail()) {
  await page.goto('/register');
  await fillRegisterForm(page, { firstName: 'Pick', lastName: 'Manager', email });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/arenas');

  await page.getByRole('link', { name: /New arena/ }).click();
  await expect(page).toHaveURL('/arenas/new');
  await page.getByPlaceholder(/Saturday Open Play/).fill(arenaName);
  await page.getByRole('button', { name: 'Create arena' }).click();
  await expect(page).toHaveURL(/\/arena\/.+/);
}

/**
 * Add a walk-in via the Prep Roster modal (which `addPlayer` checks straight
 * onto the rack). Assumes the modal is already open; waits for the new row to
 * land so adds can be chained without racing the server write.
 */
async function addWalkIn(page, first) {
  const dialog = page.getByRole('dialog', { name: 'Prep roster' });
  await dialog.getByPlaceholder('First name').fill(first);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText(first, { exact: false })).toBeVisible();
}

/**
 * Build a rack: the owner is auto-added as paddle #1, then the given walk-ins
 * fill the rest. The top four are on-deck; any beyond that wait. Walk-in names
 * are distinct (no substring overlap) so row/list selectors stay unambiguous.
 */
async function buildRack(page, walkInNames) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  for (const name of walkInNames) await addWalkIn(page, name);
  await page.getByRole('button', { name: 'Close roster' }).click();
  await expect(page.getByText(`${walkInNames.length + 1} in rack`).first()).toBeVisible();
}

/** Expand an on-deck row's action panel and click its Skip button. */
async function openPickerFor(page, name) {
  await page.getByRole('button', { name: `Show actions for ${name}` }).click();
  await page.getByRole('button', { name: new RegExp(`Step ${name} away`) }).click();
}

test.describe('skip-with-replacement picker', () => {
  test('manager picks a replacement and confirms the skip', async ({ page }) => {
    await registerAndCreateArena(page, `Picker Arena ${Date.now()}`);
    // 5 paddles: owner + Wanda/Xavier/Yolanda on-deck, Zane the lone waiting
    // paddle (the only valid replacement — keeps assertions deterministic).
    await buildRack(page, ['Wanda', 'Xavier', 'Yolanda', 'Zane']);

    // Skipping the on-deck walk-in "Wanda" opens the picker (manager + the
    // default skipPickReplacement setting + a waiting paddle available).
    await openPickerFor(page, 'Wanda');
    const dialog = page.getByRole('dialog', { name: /Skip Wanda/ });
    await expect(dialog).toBeVisible();

    // Confirm is disabled until a replacement is selected.
    const confirm = dialog.getByRole('button', { name: 'Skip + Pick' });
    await expect(confirm).toBeDisabled();

    // The lone waiting paddle (Zane) is the only option; pick it.
    await dialog.getByRole('button', { name: /Zane/ }).click();
    await expect(confirm).toBeEnabled();

    await confirm.click();

    // Picker closes and the success toast confirms the skip went through.
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Marked Next in Line/)).toBeVisible();
  });

  test('Escape and Cancel dismiss the picker without skipping', async ({ page }) => {
    await registerAndCreateArena(page, `Picker Dismiss ${Date.now()}`);
    await buildRack(page, ['Wanda', 'Xavier', 'Yolanda', 'Zane']);

    // Escape closes the picker.
    await openPickerFor(page, 'Xavier');
    const dialog = page.getByRole('dialog', { name: /Skip Xavier/ });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Cancel closes it too. Re-open (the row collapsed when the picker opened).
    await openPickerFor(page, 'Xavier');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    // No skip happened — the rack still holds all five paddles and no success
    // toast was shown.
    await expect(page.getByText('5 in rack').first()).toBeVisible();
    await expect(page.getByText(/Marked Next in Line/)).toBeHidden();
  });

  test('search filters the list, and Escape clears the query before closing', async ({ page }) => {
    await registerAndCreateArena(page, `Picker Search ${Date.now()}`);
    // 7 in rack (owner + 6 walk-ins); on-deck is the first 4, so Zane/Quinn/
    // Rosa wait. Skipping an on-deck paddle (Xavier) opens a picker listing
    // those three — enough rows for the filter to actually narrow.
    await buildRack(page, ['Wanda', 'Xavier', 'Yolanda', 'Zane', 'Quinn', 'Rosa']);

    await openPickerFor(page, 'Xavier');
    const dialog = page.getByRole('dialog', { name: /Skip Xavier/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Quinn/ })).toBeVisible();

    // Typing narrows the waiting list to matching names only.
    const search = dialog.getByLabel('Search players by name');
    await search.fill('zan');
    await expect(dialog.getByRole('button', { name: /Zane/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Quinn/ })).toBeHidden();

    // Esc with text present clears the query WITHOUT dismissing the modal —
    // the field stops propagation so the window-level close listener never
    // fires (native type=search semantics).
    await search.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(search).toHaveValue('');
    await expect(dialog.getByRole('button', { name: /Quinn/ })).toBeVisible();

    // Esc again (field now empty) propagates and closes the modal.
    await search.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('keeps the picker open with an alert when the picked replacement is taken', async ({ page, browser }) => {
    const email = uniqueEmail();
    await registerAndCreateArena(page, `Picker Race ${Date.now()}`, email);
    // 6 paddles so TWO wait (Zane, Quinn): after Zane is raced away mid-pick,
    // Quinn remains, proving the "pick again from the refreshed list" retry.
    await buildRack(page, ['Wanda', 'Xavier', 'Yolanda', 'Zane', 'Quinn']);

    await openPickerFor(page, 'Wanda');
    const dialog = page.getByRole('dialog', { name: /Skip Wanda/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Zane/ }).click();
    await expect(dialog.getByRole('button', { name: 'Skip + Pick' })).toBeEnabled();

    // Second session as the same manager removes Zane from the rack — the exact
    // race the keep-open branch guards against. The first session's modal is
    // left untouched (Zane still selected, now stale).
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto('/login');
    await page2.getByPlaceholder('Email').fill(email);
    await page2.getByPlaceholder('Password').fill(PASSWORD);
    await page2.getByRole('button', { name: 'Sign in' }).click();
    await expect(page2).toHaveURL('/arenas');
    await page2.goto(page.url());
    await page2.getByRole('button', { name: 'Show actions for Zane' }).click();
    await page2.getByRole('button', { name: 'Take Zane off the rack' }).click();
    await expect(page2.getByText('5 in rack').first()).toBeVisible(); // 6 → 5
    await ctx2.close();

    // Confirm the now-stale pick. The server no-ops (Zane no longer waiting) and
    // the picker must STAY open, show the inline alert, refresh the list (Zane
    // gone, Quinn still pickable), and disable confirm until a fresh pick.
    await dialog.getByRole('button', { name: 'Skip + Pick' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText(/no longer available/i);
    await expect(dialog.getByRole('button', { name: 'Skip + Pick' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: /Zane/ })).toBeHidden();
    await expect(dialog.getByRole('button', { name: /Quinn/ })).toBeVisible();

    // Re-picking the surviving paddle recovers the flow.
    await dialog.getByRole('button', { name: /Quinn/ }).click();
    await dialog.getByRole('button', { name: 'Skip + Pick' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Marked Next in Line/)).toBeVisible();
  });
});
