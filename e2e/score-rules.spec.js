import { test, expect } from '@playwright/test';
import { PASSWORD, registerAndSignIn } from './helpers';

// E2E coverage for the scoring rules: the win-by margin (#176) and the arena
// target (#181). Both are unit-tested to death in `src/lib/scoring.test.js` and
// pinned server-side in `actions.test.js`. What only a browser can prove is the
// part a manager actually touches:
//
//   - a no-deuce game can be RECORDED, end to end, through the real dialog;
//   - the per-game override really is per-game, and does not quietly rewrite
//     the arena for every game after it;
//   - a board already open picks up a rule changed in another tab. That last
//     one is the one that fails silently: a stale tab blocks legal scorelines,
//     and offline it freezes the stale value onto the pending log where
//     `board-fingerprint` hashes it, returning a whole sync batch as a phantom
//     divergence. Same shape as `win-lose-decks.spec.js:287` for deck mode.

/** Create an arena from the directory and land on its board. */
async function createArena(page, name) {
  await page.getByRole('link', { name: /New arena/ }).click();
  await expect(page).toHaveURL('/arenas/new');
  await page.getByPlaceholder(/Saturday Open Play/).fill(name);
  await page.getByRole('button', { name: 'Create arena' }).click();
  await expect(page).toHaveURL(/\/arena\/.+/);
}

/** Add walk-ins through the Prep Roster modal. Owner is already paddle #1. */
async function addWalkIns(page, names) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Prep roster' });
  await dialog.getByRole('button', { name: '+ Walk-in' }).click();
  for (const name of names) {
    await dialog.getByPlaceholder('First name').fill(name);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByText(name, { exact: false })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Close roster' }).click();
  await expect(page.getByText(`${names.length + 1} in rack`).first()).toBeVisible();
}

/** Save Settings → Match Defaults and come back to the board. */
async function setMatchDefaults(page, arenaUrl, { targetScore, winBy }) {
  await page.goto(`${arenaUrl}/settings/match-defaults`);
  if (targetScore !== undefined) {
    await page.getByLabel('Target score').fill(String(targetScore));
  }
  if (winBy !== undefined) {
    await page.getByLabel('Win by').selectOption(String(winBy));
  }
  await page.getByRole('button', { name: 'Save match defaults' }).click();
  await expect(page.getByText('Saved.').first()).toBeVisible();
}

/** Stack the first open court and open its score dialog. */
async function stackAndOpenScore(page) {
  await page.getByRole('button', { name: /^Stack /, exact: false }).first().click();
  await page.getByRole('button', { name: /Finish Game & Record Score/ }).first().click();
  return page.getByRole('dialog', { name: /Court/ });
}

/** Type a scoreline into the open dialog. */
async function enterScore(page, a, b) {
  await page.getByRole('textbox', { name: 'Team A score' }).fill(String(a));
  await page.getByRole('textbox', { name: 'Team B score' }).fill(String(b));
}

const saveScore = (page) => page.getByRole('button', { name: 'Save Score' });

// The dialog says the active rule twice: as the selected toggle, and again in
// the hint line under it. Assert the toggle's checked state — "Win by 2" as
// bare text is ambiguous between the two, and the toggle is the thing that
// actually drives validation.
const ruleToggle = (dialog, rule) => dialog.getByRole('radio', { name: rule });

/** Open the Match Log tab and confirm a scoreline landed in the ledger. The
 *  board tab shows the rack, not recorded scores. Each score is its own
 *  element, so assert them separately rather than as one "11 - 10" string. */
async function expectRecorded(page, a, b) {
  await page.getByRole('tab', { name: /Match Log/ }).click();
  const ledger = page.getByRole('tabpanel', { name: /Match Log/ });
  await expect(ledger.getByText(String(a), { exact: true }).first()).toBeVisible();
  await expect(ledger.getByText(String(b), { exact: true }).first()).toBeVisible();
}

test.describe('scoring rules', () => {
  test('an arena on sudden death records an 11-10, and refuses a 12-10', async ({ page }) => {
    // The scoreline the whole feature exists for: win-by-2 makes game length
    // unbounded, which breaks any schedule with courts on a timer.
    await registerAndSignIn(page);
    await createArena(page, `Sudden Death ${Date.now()}`);
    const arenaUrl = page.url();
    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);

    await setMatchDefaults(page, arenaUrl, { winBy: 1 });
    await page.goto(arenaUrl);

    const dialog = await stackAndOpenScore(page);
    await expect(ruleToggle(dialog, /Sudden death/)).toBeChecked();

    // A winner ABOVE the target is unreachable under this rule: play stops on
    // the winning point, so 12-10 is a typo rather than a deuce result.
    await enterScore(page, 12, 10);
    await expect(dialog.getByRole('alert')).toContainText(/Sudden death ends at 11/);
    await expect(saveScore(page)).toBeDisabled();

    // ...and the one-point win, rejected before this feature, now saves.
    await enterScore(page, 11, 10);
    await expect(saveScore(page)).toBeEnabled();
    await saveScore(page).click();

    await expect(page.getByText('4 in rack').first()).toBeVisible();
    await expectRecorded(page, 11, 10);
  });

  test('the per-game override applies to one game only', async ({ page }) => {
    // The arena stays on win-by-2 throughout. A manager running a single
    // no-deuce round before the courts close should not have to rewrite the
    // rule for every game after it.
    await registerAndSignIn(page);
    await createArena(page, `One Game Only ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);

    const dialog = await stackAndOpenScore(page);
    await expect(ruleToggle(dialog, /Win by 2/)).toBeChecked();

    // Refused under the arena's own rule...
    await enterScore(page, 11, 10);
    await expect(dialog.getByRole('alert')).toContainText(/won by 2/);

    // ...until the organizer flips the toggle for THIS game, which says so.
    await ruleToggle(dialog, /Sudden death/).click();
    await expect(dialog.getByText(/This game only/)).toBeVisible();
    await expect(saveScore(page)).toBeEnabled();
    await saveScore(page).click();
    // Wait for the dialog to actually leave before touching the board again.
    // Its backdrop covers the Stack button, so on a loaded machine the next
    // click lands on a still-unmounting overlay and is swallowed — which is
    // exactly how this test flaked under full-suite contention while passing
    // every time in isolation.
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('4 in rack').first()).toBeVisible();

    // The next game is back to the arena's rule: the override did not persist.
    const next = await stackAndOpenScore(page);
    await expect(ruleToggle(next, /Win by 2/)).toBeChecked();
    await expect(next.getByText(/This game only/)).toHaveCount(0);
    await enterScore(page, 11, 10);
    await expect(saveScore(page)).toBeDisabled();
  });

  test('an open score dialog picks up a rule changed in another tab', async ({ page, browser }) => {
    // Both values reach the dialog as props of the arena page, and SSE
    // reconciles the board rather than the settings — so without them riding
    // the board stream this dialog would keep validating against what the page
    // was served with, and the server's own refusal could not correct it.
    const email = await registerAndSignIn(page);
    await createArena(page, `Live Rules ${Date.now()}`);
    const arenaUrl = page.url();
    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);

    const dialog = await stackAndOpenScore(page);
    await expect(dialog.getByText('First to 11')).toBeVisible();
    await expect(ruleToggle(dialog, /Win by 2/)).toBeChecked();

    // A second manager changes BOTH rules while that dialog sits open.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto('/login');
    await page2.getByPlaceholder('Email').fill(email);
    await page2.getByPlaceholder('Password').fill(PASSWORD);
    await page2.getByRole('button', { name: 'Sign in' }).click();
    await expect(page2).toHaveURL('/arenas');
    await setMatchDefaults(page2, arenaUrl, { targetScore: 15, winBy: 1 });
    await ctx2.close();

    // The dialog repaints on its own — no reload, and without being reopened.
    await expect(dialog.getByText('First to 15')).toBeVisible({ timeout: 15000 });
    await expect(ruleToggle(dialog, /Sudden death/)).toBeChecked();

    // ...and validation follows the new rule, not the one this page was served.
    await enterScore(page, 15, 14);
    await expect(saveScore(page)).toBeEnabled();
    await saveScore(page).click();
    await expect(page.getByText('4 in rack').first()).toBeVisible();
    await expectRecorded(page, 15, 14);
  });
});
