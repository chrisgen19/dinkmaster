import { test, expect } from '@playwright/test';
import { openSignedInContext } from './helpers';

const BASE_URL = 'http://localhost:3021';

/**
 * Offline session mode e2e, against a PRODUCTION build (see
 * playwright.offline.config.js): the service worker only registers there.
 *
 * Network emulation notes, learned the hard way:
 *  - `context.setOffline(true)` blocks page-initiated requests (server
 *    action POSTs bypass the SW, which handles GET only), but NOT fetches
 *    issued by the service worker itself. So it's enough to trigger the
 *    "connection lost" entry path, but an offline reload would still load
 *    the live page through the SW.
 *  - Truly failing an SW-handled navigation needs `context.route()` +
 *    abort, which only sees SW fetches when
 *    PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 (set in the config).
 *  - A synthetic `window.dispatchEvent(new Event('offline'))` triggers the
 *    entry prompt while the server stays REACHABLE: the flaky-network
 *    scenario. Used for the hold/divergence specs so the other browser and
 *    the sync endpoint stay live.
 */

async function createArena(page, arenaName) {
  await page.goto('/arenas');
  await page.getByRole('link', { name: /New arena/ }).click();
  await page.getByPlaceholder(/Saturday Open Play/).fill(arenaName);
  await page.getByRole('button', { name: 'Create arena' }).click();
  await expect(page).toHaveURL(/\/arena\/.+/);
  return page.url();
}

/** Add walk-ins through the prep roster modal, then close it. */
async function addWalkIns(page, names) {
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const firstNameInput = page.getByPlaceholder('First name');
  for (const name of names) {
    await firstNameInput.fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await page.keyboard.press('Escape');
}

/** Resolve when the service worker controls the page (prod build only). */
async function waitForServiceWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, 5000); // clientsClaim usually already took control
      });
    }
  });
}

/**
 * Wait for offline mode to be active. The board switches AUTOMATICALLY on a
 * genuine offline signal (a real drop or a synthetic `offline` event), so
 * there is no "Run offline" prompt to click on this path.
 */
async function enterOfflineMode(page) {
  await expect(page.getByText(/Running the board locally/)).toBeVisible();
}

test.describe('offline session mode (production build)', () => {
  // ONE signed-in context for the whole file, as manager "Offline Manager"
  // (whose hold banner reads "Offline M."). Registering per test would trip
  // Better Auth's rate limiter, which is enabled only in production -
  // exactly what this project runs against. Sharing the context also keeps
  // the service worker registered between tests; isolation comes from each
  // test creating its own arena.
  let context;
  let page;
  test.beforeAll(async ({ browser }) => {
    ({ context, page } = await openSignedInContext(browser, {
      baseURL: BASE_URL,
      form: { firstName: 'Offline', lastName: 'Manager' },
    }));
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test('full round trip: run offline, reload into the SW shell, reconnect and sync', async () => {
    const arenaUrl = await createArena(page, `Offline E2E ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay']);
    await waitForServiceWorker(page);

    // Real network loss: the board switches to offline mode on its own.
    await context.setOffline(true);
    await enterOfflineMode(page);

    // A local rotation: fill a court, record 11-7.
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
    await expect(page.getByText(/1 change saved on this device/)).toBeVisible();
    await page.getByRole('button', { name: /Finish Game & Record Score/ }).first().click();
    await page.getByRole('textbox', { name: 'Team A score' }).fill('11');
    await page.getByRole('textbox', { name: 'Team B score' }).fill('7');
    await page.getByRole('button', { name: 'Save Score' }).click();
    await expect(page.getByText(/2 changes saved on this device/)).toBeVisible();

    // Abort EVERYTHING (including SW fetches) so the NetworkOnly navigation
    // truly fails and the precached fallback shell takes over. Precache
    // lookups are cache hits, not network, so the shell still renders.
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/showing the board saved/i)).toBeVisible();
    await expect(page.getByText(/unsynced/i)).toBeVisible();
    expect(page.url()).toBe(arenaUrl); // shell serves IN PLACE of the arena URL

    // Reconnect: the live page resumes the session and auto-syncs.
    await context.unroute('**/*');
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText(/Offline session synced: 2 changes saved/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Running the board locally/)).toHaveCount(0);

    // The offline match is in the log with its score.
    await page.getByRole('tab', { name: /Match Log/ }).first().click();
    await expect(page.getByText('11', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('7', { exact: true }).first()).toBeVisible();
  });

  test('Edit Teams works offline: substitute a waiter, then sync', async () => {
    const arenaUrl = await createArena(page, `Edit Teams E2E ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay']);
    await waitForServiceWorker(page);

    // Fill a court ONLINE first (Ana-Ben-Cai-Dee on court, Eli + Fay waiting),
    // so there's a live lineup to edit once the connection drops.
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
    await expect(page.getByRole('button', { name: 'Edit Teams' }).first()).toBeVisible();

    // Enter offline mode via a synthetic offline event: the server stays
    // reachable, so the earlier fill and the later sync both work while the
    // Edit Teams path runs entirely through the local engine.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await enterOfflineMode(page);

    // Substitute Ana out for Eli (a waiter) via the manual team editor. Scope
    // the picks to the dialog so the rack's own "Eli" controls behind the
    // modal can't intercept the selector.
    await page.getByRole('button', { name: 'Edit Teams' }).first().click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('button', { name: 'Replace Ana' }).click();
    await expect(editor.getByText(/Replace Ana/)).toBeVisible(); // picker opened
    await editor.getByRole('button').filter({ has: page.getByText('Eli', { exact: true }) }).click();
    await editor.getByRole('button', { name: 'Save Lineup' }).click();
    await expect(page.getByText(/1 change saved on this device/)).toBeVisible();

    // Sync and confirm the substitution persisted server-side.
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText(/Offline session synced: 1 change saved/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Running the board locally/)).toHaveCount(0);

    // Reload from the server (no local state) and confirm the swap persisted.
    // Court slots render as "View <name>'s profile" list items; rack rows don't,
    // so these two assertions cleanly separate on-court from waiting.
    await page.goto(arenaUrl);
    await expect(page.getByRole('listitem', { name: /View Eli.s profile/ })).toBeVisible();
    await expect(page.getByRole('listitem', { name: /View Ana.s profile/ })).toHaveCount(0);
  });

  test('flaky network: other viewers see the hold, divergence resolves best-effort', async ({ browser }) => {
    const arenaUrl = await createArena(page, `Hold E2E ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay']);

    // Second browser, same manager account (shared storage state, so no
    // extra sign-in round trip), watching the live board.
    const contextB = await browser.newContext({ baseURL: BASE_URL, storageState: await context.storageState() });
    const pageB = await contextB.newPage();
    await pageB.goto(arenaUrl);
    await expect(pageB.getByText(/running this board offline/)).toHaveCount(0);

    // A's device THINKS it lost the connection (synthetic event), but the
    // server stays reachable, so entering offline mode declares the hold.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await enterOfflineMode(page);
    await expect(pageB.getByText(/Offline M\. is running this board offline/)).toBeVisible({ timeout: 10_000 });

    // B mutates the live board: checks OUT the on-deck walk-in Ana.
    // `has:` with an exact text locator, NOT `hasText: 'Ana'` — the latter is
    // a case-insensitive substring match, so it also matches the manager row
    // ("Offline M-ana-ger") and resolves to two elements.
    await pageB.getByRole('button', { name: 'Add', exact: true }).first().click();
    await pageB
      .getByRole('listitem')
      .filter({ has: pageB.getByText('Ana', { exact: true }) })
      .getByRole('button', { name: /In/ })
      .click();
    await pageB.keyboard.press('Escape');

    // A, still offline-mode: adds a walk-in (survives replay) and fills a
    // court whose recorded top-4 includes Ana (will no longer apply).
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByPlaceholder('First name').fill('Zed');
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByText('Zed', { exact: true }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
    await expect(page.getByText(/2 changes saved on this device/)).toBeVisible();

    // Strict sync detects the divergence; the manager applies what fits.
    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText(/The arena changed while you were offline/)).toBeVisible();
    await page.getByRole('button', { name: /Apply what still fits/ }).click();
    await expect(page.getByText(/Offline session synced: 1 change saved/)).toBeVisible({ timeout: 20_000 });
    // .first(): banners render once per responsive layout (desktop + mobile).
    await expect(page.getByText(/1 offline change could not be applied/).first()).toBeVisible();

    // Hold released inside the sync transaction; B converges: banner gone,
    // Zed on the board, Ana off the rack.
    await expect(pageB.getByText(/running this board offline/)).toHaveCount(0, { timeout: 10_000 });
    await expect(pageB.getByText('Zed', { exact: true }).first()).toBeVisible();

    await contextB.close();
  });

  test('a session that recorded nothing still releases the hold on exit', async ({ browser }) => {
    const arenaUrl = await createArena(page, `Empty Hold E2E ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben']);

    const contextB = await browser.newContext({ baseURL: BASE_URL, storageState: await context.storageState() });
    const pageB = await contextB.newPage();
    await pageB.goto(arenaUrl);

    // Enter offline mode and record NOTHING, then sync. The zero-event path
    // skips the sync endpoint (which is what normally clears the hold), so
    // it has to release the hold itself or B keeps the banner for the whole
    // client-side TTL.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await enterOfflineMode(page);
    await expect(pageB.getByText(/is running this board offline/)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Sync now' }).click();
    await expect(page.getByText(/Running the board locally/)).toHaveCount(0);
    await expect(pageB.getByText(/is running this board offline/)).toHaveCount(0, { timeout: 10_000 });

    await contextB.close();
  });

  test('mid-session reload with connectivity resumes the log and auto-syncs', async () => {
    await createArena(page, `Resume E2E ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben', 'Cai']);

    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await enterOfflineMode(page);

    // One local change: add a walk-in.
    await page.getByRole('button', { name: 'Add', exact: true }).first().click();
    await page.getByPlaceholder('First name').fill('Rex');
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByText('Rex', { exact: true }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(/1 change saved on this device/)).toBeVisible();

    // Reload with the network actually up: the live page loads, the pending
    // log resumes, and (navigator.onLine) the session syncs immediately.
    await page.reload();
    await expect(page.getByText(/Offline session synced: 1 change saved/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Running the board locally/)).toHaveCount(0);
    await expect(page.getByText('Rex', { exact: true }).first()).toBeVisible();
  });

  test('an action failing while the browser is online prompts, not auto-switch', async () => {
    await createArena(page, `Ambiguous E2E ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dee']);
    await waitForServiceWorker(page);

    // Fail the next board action while navigator.onLine stays TRUE by aborting
    // the server-action POST (no setOffline). This is the ambiguous case (the
    // failure could be a server error, not a dropped connection), so the board
    // must offer the prompt rather than auto-switching to offline mode.
    const failPost = (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue();
    await page.route('**/arena/**', failPost);
    try {
      await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
      await expect(page.getByText(/Connection lost/)).toBeVisible();
      // The board did NOT auto-enter (the browser still reports online).
      await expect(page.getByText(/Running the board locally/)).toHaveCount(0);
      // Dismissing leaves the board online; no offline session was started.
      await page.getByRole('button', { name: 'Dismiss' }).click();
      await expect(page.getByText(/Connection lost/)).toHaveCount(0);
    } finally {
      await page.unroute('**/arena/**');
    }
  });
});
