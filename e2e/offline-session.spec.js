import { test, expect } from '@playwright/test';
import { uniqueEmail, PASSWORD, fillRegisterForm } from './helpers';

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

async function registerFreshManager(page) {
  const email = uniqueEmail();
  await page.goto('/register');
  await fillRegisterForm(page, { firstName: 'Offline', lastName: 'Manager', email });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/arenas');
  return email;
}

async function createArena(page, arenaName) {
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

/** Enter offline mode via the connection-lost prompt. */
async function enterOfflineMode(page) {
  await expect(page.getByText(/Connection lost/)).toBeVisible();
  await page.getByRole('button', { name: 'Run offline' }).click();
  await expect(page.getByText(/Running the board locally/)).toBeVisible();
}

test.describe('offline session mode (production build)', () => {
  test('full round trip: run offline, reload into the SW shell, reconnect and sync', async ({ page, context }) => {
    await registerFreshManager(page);
    const arenaUrl = await createArena(page, `Offline E2E ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay']);
    await waitForServiceWorker(page);

    // Real network loss: a failed server action offers the offline prompt.
    await context.setOffline(true);
    await page.getByRole('button', { name: /Stack Next 4 Paddles/ }).first().click();
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

  test('flaky network: other viewers see the hold, divergence resolves best-effort', async ({ page, browser }) => {
    const email = await registerFreshManager(page);
    const arenaUrl = await createArena(page, `Hold E2E ${Date.now()}`);
    await addWalkIns(page, ['Ana', 'Ben', 'Cai', 'Dee', 'Eli', 'Fay']);

    // Second browser, same manager account, watching the live board.
    const contextB = await browser.newContext({ baseURL: 'http://localhost:3021' });
    const pageB = await contextB.newPage();
    await pageB.goto('/login');
    await pageB.getByPlaceholder('Email').fill(email);
    await pageB.getByPlaceholder('Password').fill(PASSWORD);
    await pageB.getByRole('button', { name: 'Sign in' }).click();
    await expect(pageB).toHaveURL('/arenas');
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

  test('mid-session reload with connectivity resumes the log and auto-syncs', async ({ page }) => {
    await registerFreshManager(page);
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
});
