import { test, expect } from '@playwright/test';
import { openSignedInContext } from './helpers';

/**
 * The activity lifecycle end to end: a schedule materializes into sessions, a
 * manager opens one, games played land in THAT session's standings, and opening
 * the next freezes the first as history.
 *
 * This is the flow the unit tests can't reach — it crosses the server action,
 * the board, and two routes. Both bugs shipped during this feature (offline
 * match attribution, and a TDZ in the arena route) were the kind only a run
 * like this catches.
 *
 * One signed-in context for the whole file: Better Auth rate-limits sign-up in
 * production, so re-registering per test starts returning 429s. The arena is
 * built once in `beforeAll` so a failure in one test doesn't cascade through
 * the rest for want of a URL.
 */
test.describe('activities', () => {
  let context;
  let page;
  let arenaUrl;

  /** Every weekday, so a session exists within a day of "now" whenever this runs. */
  const ALL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  test.beforeAll(async ({ browser }) => {
    ({ context, page } = await openSignedInContext(browser, {
      form: { firstName: 'Activity', lastName: 'Organizer' },
    }));

    // Deliberately NOT named "Activities" — the arena name renders as an <h1>
    // and would collide with the page's own heading in a role selector.
    await page.goto('/arenas/new');
    await page.getByPlaceholder(/Saturday Open Play/).fill(`Dink Club E2E ${Date.now()}`);
    await page.getByRole('button', { name: 'Create arena' }).click();
    await expect(page).toHaveURL(/\/arena\/.+/);
    arenaUrl = page.url();

    await page.goto(`${arenaUrl}/settings/schedule`);
    for (const day of ALL_DAYS) {
      const toggle = page.getByRole('button', { name: day, exact: true });
      if (await toggle.count()) await toggle.first().click();
    }
    await page.getByRole('button', { name: 'Save schedule' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('a schedule materializes into upcoming activities', async () => {
    // Saving the schedule materializes immediately — a manager shouldn't have
    // to reload to see the calendar fill in.
    await page.goto(`${arenaUrl}/activities`);
    await expect(page.getByRole('heading', { name: 'Activities', exact: true })).toBeVisible();
    await expect(page.locator('li').filter({ hasText: /Upcoming|Live now/ }).first()).toBeVisible();
  });

  test('the manager can RSVP and the count reflects it', async () => {
    await page.goto(`${arenaUrl}/activities`);

    const going = page.getByRole('button', { name: /I.m going/ }).first();
    await expect(going).toBeVisible();
    await going.click();

    // Server-confirmed: the count comes from a fresh server render, not the
    // optimistic flip.
    await expect(page.getByText(/1 going/).first()).toBeVisible();
  });

  test('games land in the open activity’s standings', async () => {
    await page.goto(arenaUrl);

    // Fill the rack: the owner is already player 1, so three walk-ins make four.
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Prep roster' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '+ Walk-in' }).click();
    for (const name of ['Bea', 'Caleb', 'Dita']) {
      await dialog.getByPlaceholder('First name').fill(name);
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'Done adding walk-ins' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Play one game.
    await page.getByRole('button', { name: 'Stack Next 4 Paddles' }).first().click();
    await page.getByRole('button', { name: 'Finish Game & Record Score' }).first().click();
    await page.getByLabel('Team A score', { exact: true }).fill('11');
    await page.getByLabel('Team B score', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Save Score' }).click();

    // The rack tile proves the match was attributed to the open activity —
    // these counts come from `computeActivityStats`, which matches on
    // `Match.activityId` and would read 0 if the stamping were wrong.
    await expect(page.getByText(/1 games · 1W · 0L/).first()).toBeVisible();

    // Now confirm it from the activity's own page. Reload first: the Activities
    // tab is fed by server-rendered props, and filling the first court
    // auto-opened an activity that the page load predates.
    await page.reload();
    await page.getByRole('tab', { name: /Activities/ }).first().click();
    await page.getByRole('link', { name: /Live now/ }).first().click();

    await expect(page.getByRole('heading', { name: /Standings/ })).toBeVisible();
    // Four players, one game: the two winners sit at 100%.
    await expect(page.getByText('100%').first()).toBeVisible();
  });

  test('opening the next activity freezes the first with its record intact', async () => {
    // Capture the open activity before crossing the boundary.
    await page.goto(`${arenaUrl}/activities`);
    const liveHref = await page
      .locator('li')
      .filter({ hasText: 'Live now' })
      .locator('a[href*="/activities/"]')
      .first()
      .getAttribute('href');
    expect(liveHref, 'an activity should be open before this test').toBeTruthy();

    // Cross it from the board's prep banner, accepting the confirm.
    await page.goto(arenaUrl);
    const prep = page.getByRole('button', { name: /Prepare next session|Start this activity/ }).first();
    if (await prep.count()) {
      page.once('dialog', (d) => d.accept());
      await prep.click();
      // The prep roster opens straight after; stash it.
      await page.keyboard.press('Escape');
    }

    // The finished session is now history — and its standings are unchanged.
    // Nothing about closing a session may rewrite what happened inside it.
    await page.goto(liveHref);
    await expect(page.getByText('Finished')).toBeVisible();
    await expect(page.getByText('100%').first()).toBeVisible();
  });

  test('a manager can create a one-off session outside the schedule', async () => {
    await page.goto(`${arenaUrl}/activities`);
    await page.getByRole('button', { name: /New one-off session/ }).click();

    const title = `Club Championship ${Date.now()}`;
    await page.getByLabel(/^Title/).fill(title);

    // Two days out, not two years: with every weekday scheduled the upcoming
    // list is already dense, and `listActivities` takes 20 — a far-future
    // session would be paged off the end and the assertion below would fail
    // for a reason that has nothing to do with creating it.
    //
    // 06:00 avoids the unique-start collision: this arena has no configured
    // times, so its generated windows all begin at local midnight.
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Date').fill(soon);
    await page.getByLabel('Starts').fill('06:00');
    await page.getByLabel('Ends').fill('08:00');
    await page.getByRole('button', { name: 'Create session' }).click();

    await expect(page.getByText(title)).toBeVisible();
  });

  test('a spectator sees the calendar but no RSVP controls', async ({ browser }) => {
    // The activities pages are public, matching the arena board — but answering
    // for yourself needs membership.
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(`${arenaUrl}/activities`);

    await expect(guestPage.getByRole('heading', { name: 'Activities', exact: true })).toBeVisible();
    await expect(guestPage.getByRole('button', { name: /I.m going/ })).toHaveCount(0);
    await expect(guestPage.getByRole('button', { name: /New one-off session/ })).toHaveCount(0);

    await guest.close();
  });
});
