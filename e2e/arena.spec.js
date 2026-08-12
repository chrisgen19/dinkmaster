import { test, expect } from '@playwright/test';
import { uniqueEmail, PASSWORD, fillRegisterForm } from './helpers';

async function registerFreshUser(page, email = uniqueEmail()) {
  await page.goto('/register');
  await fillRegisterForm(page, { firstName: 'Arena', lastName: 'Maker', email });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/arenas');
  return email;
}

async function createArenaFromDirectory(page, arenaName) {
  await page.getByRole('link', { name: /New arena/ }).click();
  await expect(page).toHaveURL('/arenas/new');
  await page.getByPlaceholder(/Saturday Open Play/).fill(arenaName);
  await page.getByRole('button', { name: 'Create arena' }).click();
}

/**
 * Add walk-ins through the Prep Roster modal, which checks each straight onto
 * the rack. Waits for every row to land so chained adds can't race the write.
 */
async function addWalkIns(page, names) {
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Prep roster' });
  // The footer bar shows search by default; "+ Walk-in" swaps it to the form,
  // which then stays open across consecutive adds.
  await dialog.getByRole('button', { name: '+ Walk-in' }).click();
  for (const name of names) {
    await dialog.getByPlaceholder('First name').fill(name);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByText(name, { exact: false })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Close roster' }).click();
}

/**
 * The short display names on one side of the single playing court.
 *
 * Coupled to court-card.js markup: each side renders a `Team A`/`Team B`
 * caption followed by a sibling <ul> of names. Only a PLAYING court renders
 * those captions, so this resolves unambiguously while one court is live.
 */
async function teamNames(page, label) {
  const list = page
    .locator(`xpath=//*[normalize-space(text())="${label}"]/following-sibling::ul[1]`)
    .first();
  await expect(list.locator('li')).toHaveCount(2);
  return (await list.locator('li').allInnerTexts()).map((s) => s.trim());
}

/**
 * The viewer's own DUPR rating for this arena, read from the My Stats tab.
 *
 * Coupled to arena-mystats.js: the "This arena · DUPR" tile renders its label
 * above the value, so the value is the eyebrow's next sibling. Everyone starts
 * at 1000 Elo, which maps to 3.500.
 */
async function myDupr(page) {
  await page.getByRole('tab', { name: /My Stats/ }).click();
  const value = page
    .locator('xpath=//p[normalize-space(text())="This arena · DUPR"]/following-sibling::p[1]')
    .first();
  await expect(value).toBeVisible();
  return Number((await value.innerText()).trim());
}

test.describe('arenas', () => {
  test('a signed-in user can create an arena and manage it', async ({ page }) => {
    await registerFreshUser(page);

    const arenaName = `E2E Arena ${Date.now()}`;
    await createArenaFromDirectory(page, arenaName);

    // Lands on the new arena, which the creator owns and can manage.
    await expect(page).toHaveURL(/\/arena\/.+/);
    await expect(page.getByRole('heading', { name: arenaName })).toBeVisible();
    
    // In Phase 5, the input is hidden inside the Add modal. We assert that the Add button is visible instead.
    await expect(page.getByRole('button', { name: 'Add', exact: true }).first()).toBeEnabled();
  });

  test('a guest sees arenas read-only', async ({ page, request }) => {
    // Create an arena via a registered account, then visit it as a guest.
    const email = uniqueEmail();
    await request.post('/api/auth/sign-up/email', {
      data: { name: 'Owner', email, password: PASSWORD, firstName: 'Owner', lastName: 'Account' },
    });

    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/arenas');

    const arenaName = `Guest View Arena ${Date.now()}`;
    await createArenaFromDirectory(page, arenaName);
    await expect(page).toHaveURL(/\/arena\/.+/);
    const arenaUrl = page.url();

    // Sign out, then revisit the arena as a guest — viewing works, managing is locked.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await page.goto(arenaUrl);
    await expect(page.getByRole('heading', { name: arenaName })).toBeVisible();
    
    // In Phase 5, the prep input placeholder doesn't exist for guests. Instead, they see the read-only notice banner.
    await expect(page.getByText("You're viewing this arena. Only its owner and organizers can manage it.")).toBeVisible();
  });

  test('a second user can join an arena', async ({ page }) => {
    // User A creates an arena.
    const emailA = await registerFreshUser(page);
    const arenaName = `Joinable Arena ${Date.now()}`;
    await createArenaFromDirectory(page, arenaName);
    await expect(page).toHaveURL(/\/arena\/.+/);
    const arenaUrl = page.url();

    // User A signs out; user B registers and opens the arena.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    const emailB = await registerFreshUser(page);
    await page.goto(arenaUrl);

    // User B is not a member yet — clicks "Request to join"
    const joinButton = page.getByRole('button', { name: 'Request to join' });
    await expect(joinButton).toBeVisible();
    await joinButton.click();

    // Shows pending state for User B
    await expect(page.getByText('Request pending approval')).toBeVisible();
    await expect(joinButton).toBeHidden();

    // User B signs out
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Log back in as User A (owner) to approve User B
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(emailA);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/arenas');
    await page.goto(arenaUrl);

    // Open members tab, navigate to Requests pill, and approve
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('tab', { name: /Requests/ }).click();
    await page.getByRole('button', { name: 'Accept' }).click();
    // Wait for the approval to round-trip before signing out: the request
    // row disappears (list re-renders from the server) only after the
    // membership is persisted, so this removes the race where User B logs
    // in before approveJoinRequest commits.
    await expect(page.getByText('No pending requests.')).toBeVisible();

    // User A signs out
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Log back in as User B
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(emailB);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/arenas');
    await page.goto(arenaUrl);

    // User B is now a member
    await expect(page.getByText(/You're a member of this arena/)).toBeVisible();
  });

  // Covers the ONLINE board round trip end to end: the real `fillCourt` and
  // `endMatch` server actions, against a real database, driven from the UI.
  // The offline equivalent lives in offline-session.spec.js.
  //
  // SCOPE NOTE: the closing "winners get split up" assertion is a rotation
  // regression guard, NOT a test of the pairing rule in src/lib/pairing.js.
  // With four players it cannot distinguish the two: the pair that just won
  // necessarily just partnered, so their partnership count is 1 while both
  // cross pairs sit at 0 — which means the OLD lowest-partnership rule breaks
  // them up for its own unrelated reason. Verified by reverting the rule and
  // watching this test still pass. Discriminating the rule needs two recent
  // winners who did NOT partner each other, i.e. winners from two different
  // matches, which auto-mix then reorders nondeterministically. That coverage
  // lives in src/lib/pairing.test.js, where the inputs can be pinned.
  test('a manager can stack a court, record a score, and re-stack', async ({ page }) => {
    await registerFreshUser(page);
    await createArenaFromDirectory(page, `Stack Arena ${Date.now()}`);
    await expect(page).toHaveURL(/\/arena\/.+/);

    // Exactly four on the rack: the owner (auto-added as paddle #1) plus three
    // walk-ins. Four is deliberate — one court's worth, so the same four
    // recycle and re-stack, and auto-mix stays out of it (it needs >4 waiting).
    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);
    await expect(page.getByText('4 in rack').first()).toBeVisible();

    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();

    // The court is live with two a side, and the rack is drained.
    const firstA = await teamNames(page, 'Team A');
    const firstB = await teamNames(page, 'Team B');
    expect(new Set([...firstA, ...firstB]).size).toBe(4);
    await expect(page.getByText('0 in rack').first()).toBeVisible();

    // Team A takes it 11-5, making them the recent winners and B the losers.
    await page.getByRole('button', { name: /Finish Game & Record Score/ }).first().click();
    await page.getByRole('textbox', { name: 'Team A score' }).fill('11');
    await page.getByRole('textbox', { name: 'Team B score' }).fill('5');
    await page.getByRole('button', { name: 'Save Score' }).click();
    await expect(page.getByText('4 in rack').first()).toBeVisible();

    // Re-stack the same four; the winning pair must not be sent back out
    // together (see the SCOPE NOTE above on what this does and doesn't prove).
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
    const secondA = await teamNames(page, 'Team A');
    const secondB = await teamNames(page, 'Team B');

    for (const side of [secondA, secondB]) {
      expect(side.filter((n) => firstA.includes(n))).toHaveLength(1);
      expect(side.filter((n) => firstB.includes(n))).toHaveLength(1);
    }
  });

  // Covers the correction round trip through the real `updateMatchScore`
  // action: the History ledger's per-row pencil reopens the SAME dialog the
  // finish flow uses, pre-filled, and a winner-preserving edit persists.
  test('a manager can correct a recorded score from the History tab', async ({ page }) => {
    await registerFreshUser(page);
    await createArenaFromDirectory(page, `Correction Arena ${Date.now()}`);
    await expect(page).toHaveURL(/\/arena\/.+/);

    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();

    await page.getByRole('button', { name: /Finish Game & Record Score/ }).first().click();
    await page.getByRole('textbox', { name: 'Team A score' }).fill('11');
    await page.getByRole('textbox', { name: 'Team B score' }).fill('5');
    await page.getByRole('button', { name: 'Save Score' }).click();
    await expect(page.getByText('4 in rack').first()).toBeVisible();

    await page.getByRole('tab', { name: /Match Log/ }).click();
    const ledger = page.getByRole('tabpanel', { name: /Match Log/ });
    await expect(ledger.getByText('5', { exact: true })).toBeVisible();

    // A freshly recorded match carries no edit mark.
    await expect(ledger.getByText('Edited')).toHaveCount(0);

    // The dialog opens seeded with the recorded scoreline, not blank.
    await ledger.getByRole('button', { name: /Correct score for/ }).first().click();
    await expect(page.getByRole('textbox', { name: 'Team A score' })).toHaveValue('11');
    await expect(page.getByRole('textbox', { name: 'Team B score' })).toHaveValue('5');

    // A winner-preserving correction lands in the ledger.
    await page.getByRole('textbox', { name: 'Team A score' }).fill('11');
    await page.getByRole('textbox', { name: 'Team B score' }).fill('9');
    await page.getByRole('button', { name: 'Save Correction' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(ledger.getByText('9', { exact: true })).toBeVisible();
    // ...and the row now says so, so the rewrite isn't invisible to the
    // players who were on that court.
    await expect(ledger.getByText('Edited')).toHaveCount(1);
  });

  // Deleting a match must unwind everything it counted for, not just remove
  // the row. Two matches are played so the rating stays visible after the
  // delete (a player with no games shows "—"), which lets the test assert the
  // rating returns to exactly its value before the deleted match. Both rows
  // are from this session, so both offer deletion.
  test('a manager can delete a match from the current session', async ({ page }) => {
    await registerFreshUser(page);
    await createArenaFromDirectory(page, `Delete Arena ${Date.now()}`);
    await expect(page).toHaveURL(/\/arena\/.+/);

    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);

    const playMatch = async (a, b) => {
      // myDupr() leaves the viewer on My Stats, so come back to the board.
      await page.getByRole('tab', { name: /Active Courts/ }).click();
      await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
      await page.getByRole('button', { name: /Finish Game & Record Score/ }).first().click();
      await page.getByRole('textbox', { name: 'Team A score' }).fill(a);
      await page.getByRole('textbox', { name: 'Team B score' }).fill(b);
      await page.getByRole('button', { name: 'Save Score' }).click();
      await expect(page.getByText('4 in rack').first()).toBeVisible();
    };

    await playMatch('11', '5');
    const afterFirst = await myDupr(page);
    await playMatch('11', '7');
    expect(await myDupr(page)).not.toBeCloseTo(afterFirst, 3);

    await page.getByRole('tab', { name: /Match Log/ }).click();
    const ledger = page.getByRole('tabpanel', { name: /Match Log/ });
    await expect(ledger.locator('article')).toHaveCount(2);
    // Offered on every row from this session, not just the newest — deleting
    // the duplicate you spotted three games ago is the case that happens.
    await expect(ledger.getByRole('button', { name: /Delete match on/ })).toHaveCount(2);

    await ledger.getByRole('button', { name: /Delete match on/ }).first().click();
    const confirm = page.getByRole('alertdialog');
    // The dialog names the match it is about to remove.
    await expect(confirm).toContainText('11');
    await expect(confirm).toContainText('7');
    await confirm.getByRole('button', { name: 'Delete Match' }).click();

    // The row is gone...
    await expect(ledger.locator('article')).toHaveCount(1);
    // ...and the rating is back exactly where it stood before that match.
    expect(await myDupr(page)).toBeCloseTo(afterFirst, 3);
  });

  // The scores-in-the-wrong-boxes correction: the whole result inverts, which
  // means reversing the Elo the finish banked (see `applyMatchReversalTx`).
  // Ratings are asserted through the leaderboard's DUPR column, since that is
  // where a manager would notice a bad reversal.
  test('a manager can correct a match whose winner was entered backwards', async ({ page }) => {
    await registerFreshUser(page);
    await createArenaFromDirectory(page, `Flip Arena ${Date.now()}`);
    await expect(page).toHaveURL(/\/arena\/.+/);

    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();

    await page.getByRole('button', { name: /Finish Game & Record Score/ }).first().click();
    await page.getByRole('textbox', { name: 'Team A score' }).fill('11');
    await page.getByRole('textbox', { name: 'Team B score' }).fill('5');
    await page.getByRole('button', { name: 'Save Score' }).click();
    await expect(page.getByText('4 in rack').first()).toBeVisible();

    // Everyone started level at 3.500, so the owner (auto-added as paddle #1,
    // hence always one of the four) has now moved off it in one direction.
    const ratingBefore = await myDupr(page);
    expect(ratingBefore).not.toBeCloseTo(3.5, 3);

    await page.getByRole('tab', { name: /Match Log/ }).click();
    const ledger = page.getByRole('tabpanel', { name: /Match Log/ });
    await ledger.getByRole('button', { name: /Correct score for/ }).first().click();
    await page.getByRole('textbox', { name: 'Team A score' }).fill('5');
    await page.getByRole('textbox', { name: 'Team B score' }).fill('11');
    await page.getByRole('button', { name: 'Save Correction' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // The ledger now credits Team B, and the win badge moved with it.
    const row = ledger.locator('article').first();
    await expect(row.getByText('11', { exact: true })).toBeVisible();
    await expect(row.getByText('Win')).toHaveCount(1);

    // The reversal is symmetric: the swing the finish applied is exactly the
    // swing the flip takes back, mirrored about the 3.500 starting point.
    const ratingAfter = await myDupr(page);
    expect(ratingAfter).toBeCloseTo(3.5 - (ratingBefore - 3.5), 3);
  });
});
