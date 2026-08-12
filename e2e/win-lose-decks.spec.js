import { test, expect } from '@playwright/test';
import { registerAndSignIn } from './helpers';

// E2E coverage for win-vs-win / lose-vs-lose decks.
//
// The deck rule itself is unit-tested (src/lib/decks.test.js) and both engines
// are pinned in actions.test.js / board-engine.test.js. What only a browser can
// prove is the thing a manager actually experiences across a real session: the
// rack starts as ONE group because nobody has won yet, the second group appears
// as results come in, and the Stack button then names the deck it will send
// out and alternates between them. That whole arc spans two finished games, a
// settings save, and the server's alternation pointer surviving a repaint —
// none of which a unit test sees end to end.

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

/** Turn the mode on from Settings → Matchmaking and come back to the board. */
async function enableDeckMode(page, arenaUrl) {
  await page.goto(`${arenaUrl}/settings/matchmaking`);
  await page.getByRole('checkbox', { name: /Win vs win, lose vs lose/ }).check();
  await page.getByRole('button', { name: 'Save matchmaking' }).click();
  await expect(page.getByText(/Saved/).first()).toBeVisible();
  await page.goto(arenaUrl);
}

/** The two names under a live court's "Team A" / "Team B" heading. */
async function teamNames(page, label) {
  const list = page
    .locator(`xpath=//*[normalize-space(text())="${label}"]/following-sibling::ul[1]`)
    .first();
  await expect(list.locator('li')).toHaveCount(2);
  return (await list.locator('li').allInnerTexts()).map((s) => s.trim());
}

/** Stack the first open court, play it out 11-5, and return the winning pair. */
async function playAGame(page, expectedRackAfter) {
  await page.getByRole('button', { name: /^Stack /, exact: false }).first().click();
  const winners = await teamNames(page, 'Team A');
  await page.getByRole('button', { name: /Finish Game & Record Score/ }).first().click();
  await page.getByRole('textbox', { name: 'Team A score' }).fill('11');
  await page.getByRole('textbox', { name: 'Team B score' }).fill('5');
  await page.getByRole('button', { name: 'Save Score' }).click();
  await expect(page.getByText(`${expectedRackAfter} in rack`).first()).toBeVisible();
  return winners;
}

test.describe('win/lose decks', () => {
  test('the rack splits into two decks as results land, and stacks alternate', async ({ page }) => {
    await registerAndSignIn(page);
    await createArena(page, `Decks ${Date.now()}`);
    const arenaUrl = page.url();

    // Eight paddles: exactly enough for both decks to reach four after two
    // finished games. A new arena ships with two courts, so nothing else to set up.
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dev', 'Eve', 'Fay', 'Gus']);
    await enableDeckMode(page, arenaUrl);

    // Game one: nobody has a result yet, so every paddle counts as a loser and
    // the rack draws its usual single group — the manager sees no deck split.
    await expect(page.getByText('On deck · next court').first()).toBeVisible();
    await expect(page.getByText('Winners · next court')).toHaveCount(0);

    const firstWinners = await playAGame(page, 8);

    // Two winners now exist, so the second group appears — still short of four,
    // and labelled as such rather than silently hidden.
    await expect(page.getByText('Winners · next court').first()).toBeVisible();
    await expect(page.getByText('Losers · next court').first()).toBeVisible();
    await expect(page.getByText('needs 2 more').first()).toBeVisible();

    // Game two draws the losers deck (the winners deck can't stack yet), which
    // takes the four who haven't played.
    const secondWinners = await playAGame(page, 8);

    // Both decks are full now, so the button names the deck that is up next.
    // The winners went last two games ago, so the alternation is back on them.
    const stackButton = page.getByRole('button', { name: /Stack Winners · 4/ }).first();
    await expect(stackButton).toBeVisible();
    await expect(page.getByText('Up next').first()).toBeVisible();

    // Send the winners out. Exactly the four who won their last game go on.
    await stackButton.click();
    const firstCourt = [
      ...(await teamNames(page, 'Team A')),
      ...(await teamNames(page, 'Team B')),
    ];
    const expectedWinners = [...firstWinners, ...secondWinners];
    expect(new Set(firstCourt).size).toBe(4);
    for (const name of expectedWinners) {
      expect(firstCourt).toContain(name);
    }

    // The four losers are all that's left racked, so there is no longer a
    // choice to make and the rack goes back to one plain group — the same rule
    // that kept game one from being labelled "Losers".
    await expect(page.getByText('4 in rack').first()).toBeVisible();
    await expect(page.getByText('On deck · next court').first()).toBeVisible();
    await expect(page.getByText('Winners · next court')).toHaveCount(0);

    // Stacking the second court sends out the four who are left — which, since
    // court one took exactly the winners, is the losers' game. Asserted by
    // elimination rather than by re-reading names: both courts live and an
    // empty rack means all eight are out, and the winners are accounted for.
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
    await expect(page.getByText('0 in rack').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Finish Game & Record Score/ })).toHaveCount(2);
  });

  test('leaves the rack alone when the mode is off', async ({ page }) => {
    // The opt-in half of the contract: an arena that never touches the setting
    // must look and behave exactly as it did before this shipped.
    await registerAndSignIn(page);
    await createArena(page, `No Decks ${Date.now()}`);

    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dev', 'Eve', 'Fay', 'Gus']);
    await playAGame(page, 8);

    await expect(page.getByText('On deck · next court').first()).toBeVisible();
    await expect(page.getByText('Winners · next court')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first()).toBeVisible();
  });
});
