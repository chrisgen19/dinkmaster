import { test, expect } from '@playwright/test';
import { fillRegisterForm } from './helpers';

// E2E coverage for the manager skip-with-replacement picker modal lifecycle.
// The server action (skipPlayer) is unit-tested in actions.test.js; this spec
// covers the CLIENT orchestration that unit tests can't reach: the modal
// opening, the "confirm disabled until a replacement is picked" contract,
// confirming a pick, and the dismiss paths (Escape / Cancel).

/** Register a fresh owner and land on a new arena they manage. */
async function registerAndCreateArena(page, arenaName) {
  await page.goto('/register');
  await fillRegisterForm(page, { firstName: 'Pick', lastName: 'Manager' });
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
 * Build a five-paddle rack: the owner is auto-added as paddle #1, then four
 * walk-ins fill #2–5. On-deck is the top four (owner + Wanda, Xavier, Yolanda);
 * Zane is the lone waiting paddle — the only valid replacement, which keeps the
 * picker assertions deterministic.
 */
async function buildFivePlayerRack(page) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await addWalkIn(page, 'Wanda');
  await addWalkIn(page, 'Xavier');
  await addWalkIn(page, 'Yolanda');
  await addWalkIn(page, 'Zane');
  await page.getByRole('button', { name: 'Close roster' }).click();
  await expect(page.getByText('5 in rack')).toBeVisible();
}

/** Expand an on-deck row's action panel and click its Skip button. */
async function openPickerFor(page, name) {
  await page.getByRole('button', { name: `Show actions for ${name}` }).click();
  await page.getByRole('button', { name: new RegExp(`Step ${name} away`) }).click();
}

test.describe('skip-with-replacement picker', () => {
  test('manager picks a replacement and confirms the skip', async ({ page }) => {
    await registerAndCreateArena(page, `Picker Arena ${Date.now()}`);
    await buildFivePlayerRack(page);

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
    await buildFivePlayerRack(page);

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
    await expect(page.getByText('5 in rack')).toBeVisible();
    await expect(page.getByText(/Marked Next in Line/)).toBeHidden();
  });
});
