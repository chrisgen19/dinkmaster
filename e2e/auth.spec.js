import { test, expect } from '@playwright/test';

/** A fresh email per call so e2e runs never collide on the unique constraint. */
const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
const PASSWORD = 'e2epassword123';

test.describe('registration', () => {
  test('creates an account and lands signed in on the directory', async ({ page }) => {
    await page.goto('/register');
    await page.getByPlaceholder('Full name').fill('E2E Organizer');
    await page.getByPlaceholder('Email').fill(uniqueEmail());
    await page.getByPlaceholder('Password (min. 8 characters)').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/arenas');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('rejects a password shorter than 8 characters', async ({ page }) => {
    await page.goto('/register');
    await page.getByPlaceholder('Full name').fill('E2E Organizer');
    await page.getByPlaceholder('Email').fill(uniqueEmail());
    await page.getByPlaceholder('Password (min. 8 characters)').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByTestId('auth-error')).toContainText(/8 characters/i);
    await expect(page).toHaveURL('/register');
  });
});

test.describe('login', () => {
  test('signs in with valid credentials', async ({ page, request }) => {
    // Seed an account directly through the Better Auth API, then test the UI.
    const email = uniqueEmail();
    const res = await request.post('/api/auth/sign-up/email', {
      data: { name: 'E2E Login', email, password: PASSWORD },
    });
    expect(res.ok()).toBeTruthy();

    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/arenas');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(uniqueEmail());
    await page.getByPlaceholder('Password').fill('wrongpassword123');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByTestId('auth-error')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });
});
