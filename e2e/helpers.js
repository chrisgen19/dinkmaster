/** Shared Playwright helpers. Keep all spec files in sync via this module. */

import { expect } from '@playwright/test';

/** A fresh email per call so e2e runs never collide on the unique constraint. */
export const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
export const PASSWORD = 'e2epassword123';

/**
 * Fill the register form. Only first/last name, email, and password are
 * required; phone, address, birthday, and gender are optional and live under
 * the collapsed "Add more details" section. Pass `withOptional: true` to expand
 * that section and fill it too. Single source of truth so a form change can't
 * break one spec file while the other passes.
 */
export async function fillRegisterForm(page, {
  firstName = 'E2E',
  lastName = 'Organizer',
  email = uniqueEmail(),
  password = PASSWORD,
  withOptional = false,
} = {}) {
  await page.getByPlaceholder('First name').fill(firstName);
  await page.getByPlaceholder('Last name').fill(lastName);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min. 8 characters)').fill(password);

  if (withOptional) {
    await page.getByRole('button', { name: /Add more details/ }).click();
    await page.getByPlaceholder('Phone number').fill('5550100');
    await page.getByPlaceholder('Address').fill('123 Court Lane');
    await page.locator('input[type="date"]').fill('1995-01-01');
    await page.locator('select').selectOption('Prefer not to say');
  }
}

/**
 * Register a fresh account and land signed in on the arena directory.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [options] - forwarded to {@link fillRegisterForm}
 * @returns {Promise<string>} the account's email
 */
export async function registerAndSignIn(page, options = {}) {
  const email = options.email ?? uniqueEmail();
  await page.goto('/register');
  await fillRegisterForm(page, { ...options, email });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/arenas');
  return email;
}

/**
 * Open ONE signed-in context for a whole spec file, registering a single
 * account for it.
 *
 * Necessary against a production server: Better Auth enables rate limiting
 * only in production (it's off in dev), and sign-up is capped at a few
 * requests per window, so a suite that registers in every test starts
 * getting 429s partway through. Sharing one context also keeps the service
 * worker registered between tests and skips per-test sign-in round trips.
 *
 * Call from `test.beforeAll` and close the context in `test.afterAll`.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {object} [args]
 * @param {string} [args.baseURL] - base URL for the context
 * @param {object} [args.form] - forwarded to {@link fillRegisterForm}
 * @returns {Promise<{context: import('@playwright/test').BrowserContext,
 *   page: import('@playwright/test').Page, email: string}>}
 */
export async function openSignedInContext(browser, { baseURL, form = {} } = {}) {
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  const email = await registerAndSignIn(page, form);
  return { context, page, email };
}
