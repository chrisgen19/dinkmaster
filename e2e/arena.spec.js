import { test, expect } from '@playwright/test';
import { uniqueEmail, PASSWORD, fillRegisterForm } from './helpers';

async function registerFreshUser(page) {
  await page.goto('/register');
  await fillRegisterForm(page, { firstName: 'Arena', lastName: 'Maker' });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/arenas');
}

async function createArenaFromDirectory(page, arenaName) {
  await page.getByRole('link', { name: /New arena/ }).click();
  await expect(page).toHaveURL('/arenas/new');
  await page.getByPlaceholder(/Saturday Open Play/).fill(arenaName);
  await page.getByRole('button', { name: 'Create arena' }).click();
}

test.describe('arenas', () => {
  test('a signed-in user can create an arena and manage it', async ({ page }) => {
    await registerFreshUser(page);

    const arenaName = `E2E Arena ${Date.now()}`;
    await createArenaFromDirectory(page, arenaName);

    // Lands on the new arena, which the creator owns and can manage.
    await expect(page).toHaveURL(/\/arena\/.+/);
    await expect(page.getByRole('heading', { name: arenaName })).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Bradley, Jane, Chloe')).toBeEnabled();
  });

  test('a guest sees arenas read-only', async ({ page, request }) => {
    // Create an arena via a registered account, then visit it as a guest.
    const email = uniqueEmail();
    await request.post('/api/auth/sign-up/email', {
      data: { name: 'Owner', email, password: PASSWORD },
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
    await expect(page.getByPlaceholder('Sign in as the owner to add players')).toBeDisabled();
  });

  test('a second user can join an arena', async ({ page }) => {
    // User A creates an arena.
    await registerFreshUser(page);
    const arenaName = `Joinable Arena ${Date.now()}`;
    await createArenaFromDirectory(page, arenaName);
    await expect(page).toHaveURL(/\/arena\/.+/);
    const arenaUrl = page.url();

    // User A signs out; user B registers and opens the arena.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await registerFreshUser(page);
    await page.goto(arenaUrl);

    // User B is not a member yet — join, then the member banner replaces the CTA.
    const joinButton = page.getByRole('button', { name: 'Join this arena' });
    await expect(joinButton).toBeVisible();
    await joinButton.click();

    await expect(page.getByText(/You're a member of this arena/)).toBeVisible();
    await expect(joinButton).toBeHidden();
  });
});
