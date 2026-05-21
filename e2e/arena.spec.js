import { test, expect } from '@playwright/test';

/** A fresh email per call so e2e runs never collide on the unique constraint. */
const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
const PASSWORD = 'e2epassword123';

async function registerFreshUser(page) {
  await page.goto('/register');
  await page.getByPlaceholder('Full name').fill('Arena Maker');
  await page.getByPlaceholder('Email').fill(uniqueEmail());
  await page.getByPlaceholder('Password (min. 8 characters)').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');
}

test.describe('arenas', () => {
  test('a signed-in user can create an arena and manage it', async ({ page }) => {
    await registerFreshUser(page);

    const arenaName = `E2E Arena ${Date.now()}`;
    await page.getByPlaceholder(/New arena name/).fill(arenaName);
    await page.getByRole('button', { name: 'Create arena' }).click();

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
    await expect(page).toHaveURL('/');

    const arenaName = `Guest View Arena ${Date.now()}`;
    await page.getByPlaceholder(/New arena name/).fill(arenaName);
    await page.getByRole('button', { name: 'Create arena' }).click();
    await expect(page).toHaveURL(/\/arena\/.+/);
    const arenaUrl = page.url();

    // Sign out, then revisit the arena as a guest — viewing works, managing is locked.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await page.goto(arenaUrl);
    await expect(page.getByRole('heading', { name: arenaName })).toBeVisible();
    await expect(page.getByPlaceholder('Sign in as the owner to add players')).toBeDisabled();
  });
});
