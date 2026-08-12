import { test, expect } from '@playwright/test';
import { PASSWORD, registerAndSignIn } from './helpers';

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

  test('an organizer can hand-fill a short deck and stack it', async ({ page }) => {
    await registerAndSignIn(page);
    await createArena(page, `Top Up ${Date.now()}`);
    const arenaUrl = page.url();

    // Eight paddles. After one game there are two recent winners, so the
    // winners deck sits at 2 of 4 and can never stack on its own — the case
    // this feature exists for. The other four (2 real losers + the 2 who
    // haven't played) fill the losers deck, leaving 2 in Waiting to draw from.
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dev', 'Eve', 'Fay', 'Gus']);
    await enableDeckMode(page, arenaUrl);
    await playAGame(page, 8);

    // Two empty slots offered, and no stack button until they're filled.
    const addSlot = page.getByRole('button', { name: 'Add a paddle to the winners deck' });
    await expect(page.getByText('needs 2 more').first()).toBeVisible();
    await expect(addSlot.first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Stack the winners deck/ })).toHaveCount(0);

    // Fill both slots from Waiting.
    for (let i = 0; i < 2; i++) {
      await addSlot.first().click();
      const dialog = page.getByRole('dialog', { name: 'Add to Winners' });
      await dialog.getByRole('listitem').first().getByRole('button').click();
      await dialog.getByRole('button', { name: 'Add to deck' }).click();
      await expect(dialog).toHaveCount(0);
    }

    // Deck is complete: the slots are gone and it offers its own stack button.
    await expect(addSlot).toHaveCount(0);
    await expect(page.getByText('needs 2 more')).toHaveCount(0);

    // Send them out. Four leave the rack, and the court goes live.
    await page.getByRole('button', { name: /^Stack the winners deck/ }).first().click();
    await expect(page.getByText('4 in rack').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Finish Game & Record Score/ }).first()).toBeVisible();
  });

  test('never offers a paddle who is already on the other deck', async ({ page }) => {
    // The pool is Waiting only: topping up a short deck must not break a deck
    // that was ready to play. With nobody waiting the picker says so rather
    // than offering someone it would be wrong to take.
    await registerAndSignIn(page);
    await createArena(page, `No Steal ${Date.now()}`);
    const arenaUrl = page.url();

    // Six paddles: after a game the winners deck is 2, the losers deck is 4,
    // and Waiting is empty — every remaining paddle is spoken for.
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dev', 'Eve']);
    await enableDeckMode(page, arenaUrl);
    await playAGame(page, 6);

    await page.getByRole('button', { name: 'Add a paddle to the winners deck' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add to Winners' });
    await expect(dialog.getByText('Nobody waiting')).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(0);
  });

  test('labels each racked paddle with how their last game went', async ({ page }) => {
    // Independent of deck mode — every arena gets the chip, so this runs with
    // the setting untouched.
    await registerAndSignIn(page);
    await createArena(page, `Last Result ${Date.now()}`);

    // Exactly one court's worth, so the same four recycle and every racked
    // paddle carries a result once the game is recorded.
    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);

    // Nothing played yet: no chips at all, rather than four blank ones.
    await expect(page.getByLabel('Won their last game')).toHaveCount(0);
    await expect(page.getByLabel('Lost their last game')).toHaveCount(0);

    await playAGame(page, 4);

    // Two winners and two losers are back on the rack, each labelled. The rack
    // renders twice (desktop sidebar + mobile block), so count per visible one.
    const won = page.getByLabel('Won their last game');
    const lost = page.getByLabel('Lost their last game');
    await expect(won.first()).toBeVisible();
    await expect(lost.first()).toBeVisible();
    expect(await won.count()).toBe(await lost.count());
    await expect(won.first()).toHaveText('W');
    await expect(lost.first()).toHaveText('L');
  });

  test('a board already open picks up the mode being toggled elsewhere', async ({ page, browser }) => {
    // The setting decides which four this client names in `fillCourt`'s
    // `expected` guard, so a board holding a stale value doesn't just look
    // wrong — the server refuses every stack it sends. And because the refusal
    // carries board state only, a client that couldn't learn the new value
    // would retry into the same refusal forever. So the mode rides the board
    // stream, and the Arena notify trigger covers its column.
    const email = await registerAndSignIn(page);
    await createArena(page, `Live Toggle ${Date.now()}`);
    const arenaUrl = page.url();
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dev', 'Eve', 'Fay', 'Gus']);
    await playAGame(page, 8);

    // This board is showing the classic single group.
    await expect(page.getByText('On deck · next court').first()).toBeVisible();
    await expect(page.getByText('Winners · next court')).toHaveCount(0);

    // A second manager turns win/lose decks on from Settings.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto('/login');
    await page2.getByPlaceholder('Email').fill(email);
    await page2.getByPlaceholder('Password').fill(PASSWORD);
    await page2.getByRole('button', { name: 'Sign in' }).click();
    await expect(page2).toHaveURL('/arenas');
    await enableDeckMode(page2, arenaUrl);
    await ctx2.close();

    // The first board repaints into deck mode on its own — no reload.
    await expect(page.getByText('Winners · next court').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('On deck · next court')).toHaveCount(0);
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
