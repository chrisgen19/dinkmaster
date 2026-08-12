import { test, expect } from '@playwright/test';
import { uniqueEmail, PASSWORD, fillRegisterForm } from './helpers';

// E2E coverage for the on-deck guard on "Stack Next 4 Paddles".
//
// The guard itself is unit-tested in actions.test.js; what only a browser can
// prove is the round trip a manager actually experiences: a rack view that has
// gone stale, a tap that is REFUSED rather than silently stacking four players
// the manager never saw, and a second tap that succeeds against the repainted
// rack. Staleness is forced by cutting this page's realtime stream, which is
// the real-world version of it (a zombie SSE connection, a phone that was
// asleep, a second manager acting a moment sooner).

async function registerAndCreateArena(page, arenaName, email = uniqueEmail()) {
  await page.goto('/register');
  await fillRegisterForm(page, { firstName: 'Fill', lastName: 'Manager', email });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/arenas');

  await page.getByRole('link', { name: /New arena/ }).click();
  await expect(page).toHaveURL('/arenas/new');
  await page.getByPlaceholder(/Saturday Open Play/).fill(arenaName);
  await page.getByRole('button', { name: 'Create arena' }).click();
  await expect(page).toHaveURL(/\/arena\/.+/);
}

/** Add one walk-in through the Prep Roster modal (assumes it is already open). */
async function addWalkIn(page, first) {
  const dialog = page.getByRole('dialog', { name: 'Prep roster' });
  await dialog.getByPlaceholder('First name').fill(first);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText(first, { exact: false })).toBeVisible();
}

/** Owner is paddle #1; the walk-ins fill in behind them. */
async function buildRack(page, walkInNames) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Prep roster' }).getByRole('button', { name: '+ Walk-in' }).click();
  for (const name of walkInNames) await addWalkIn(page, name);
  await page.getByRole('button', { name: 'Close roster' }).click();
  await expect(page.getByText(`${walkInNames.length + 1} in rack`).first()).toBeVisible();
}

/** The two names showing under a live court's "Team A" / "Team B" heading. */
async function teamNames(page, label) {
  const list = page
    .locator(`xpath=//*[normalize-space(text())="${label}"]/following-sibling::ul[1]`)
    .first();
  await expect(list.locator('li')).toHaveCount(2);
  return (await list.locator('li').allInnerTexts()).map((s) => s.trim());
}

/** Sign a second browser context in as the same manager, on the same arena. */
async function secondSession(browser, email, arenaUrl) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/arenas');
  await page.goto(arenaUrl);
  return { ctx, page };
}

test.describe('stacking a court against a stale rack', () => {
  test('refuses the fill, then stacks the real on-deck four on the retry', async ({ page, browser }) => {
    const email = uniqueEmail();
    await registerAndCreateArena(page, `Fill Guard ${Date.now()}`, email);
    // Six paddles: four on deck, two waiting. Enough that removing an on-deck
    // paddle promotes a waiter and genuinely changes the top four.
    await buildRack(page, ['Ana', 'Ben', 'Cai', 'Dev', 'Eve']);
    const arenaUrl = page.url();

    // Cut this page's realtime stream and reload so it reconnects into the
    // abort. From here its rack is frozen at whatever the reload rendered.
    await page.route('**/api/arena/**/stream', (route) => route.abort());
    await page.reload();
    await expect(page.getByText('6 in rack').first()).toBeVisible();

    // Second session takes on-deck paddle Ana off the rack, promoting Eve into
    // the on-deck four. The first page hears nothing.
    const { ctx: ctx2, page: page2 } = await secondSession(browser, email, arenaUrl);
    await page2.getByRole('button', { name: 'Show actions for Ana' }).click();
    await page2.getByRole('button', { name: 'Take Ana off the rack' }).click();
    await expect(page2.getByText('5 in rack').first()).toBeVisible();
    await ctx2.close();

    // The stale page still shows Ana on deck — the exact wrong picture a
    // manager taps against.
    await expect(page.getByText('6 in rack').first()).toBeVisible();

    // Tap Stack. The server sees a different top four and refuses; no court is
    // filled, and the rack repaints from the rejection's fresh state.
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
    await expect(page.getByRole('alert').first()).toContainText(
      'The court or queue changed while loading. Please try again.',
    );
    // Nothing was stacked: no court is playing, and the rack repainted from
    // the rejection's fresh state (6 → 5).
    await expect(page.getByRole('button', { name: /Finish Game & Record Score/ })).toHaveCount(0);
    await expect(page.getByText('5 in rack').first()).toBeVisible();

    // Retry against the truth: this one stacks the four that were REALLY on
    // deck. Ana, unracked before the tap, is nowhere near the court.
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
    await expect(page.getByText('1 in rack').first()).toBeVisible();
    // Rack was: owner, Ana, Ben, Cai, Dev, Eve. Ana left, so the true on-deck
    // four were owner, Ben, Cai, Dev — and Eve is the one still waiting.
    const onCourt = [...(await teamNames(page, 'Team A')), ...(await teamNames(page, 'Team B'))];
    expect(new Set(onCourt).size).toBe(4);
    for (const name of ['Ben', 'Cai', 'Dev']) {
      expect(onCourt.some((n) => n.includes(name))).toBe(true);
    }
    expect(onCourt.some((n) => n.includes('Ana'))).toBe(false);
  });
});
