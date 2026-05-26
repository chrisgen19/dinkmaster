import { test, expect } from '@playwright/test';
import { uniqueEmail, PASSWORD, fillRegisterForm } from './helpers';

test.describe('registration', () => {
  test('creates an account and lands signed in on the directory', async ({ page }) => {
    await page.goto('/register');
    await fillRegisterForm(page);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/arenas');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('creates an account with the optional details section filled', async ({ page }) => {
    await page.goto('/register');
    await fillRegisterForm(page, { withOptional: true });
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/arenas');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('rejects a password shorter than 8 characters', async ({ page }) => {
    await page.goto('/register');
    // Fill the required fields so the client-side completeness guard passes
    // and the test actually exercises the password-length branch.
    await fillRegisterForm(page, { password: 'short' });
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByTestId('auth-error')).toContainText(/8 characters/i);
    await expect(page).toHaveURL('/register');
  });

  test('preserves ?next= return path through registration (deep link to /arenas/new)', async ({ page }) => {
    // Land on /login with the deep-link query, follow the "Create one" cross-link
    // (which must carry `next` through), then complete registration.
    await page.goto('/login?next=%2Farenas%2Fnew');
    await page.getByRole('link', { name: /Create one/ }).click();
    await expect(page).toHaveURL(/\/register\?next=%2Farenas%2Fnew$/);

    await fillRegisterForm(page);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/arenas/new');
    await expect(page.getByRole('heading', { name: /Create a new arena/i })).toBeVisible();
  });
});

test.describe('login', () => {
  test('signs in with valid credentials', async ({ page, request }) => {
    // Seed an account directly through the Better Auth API, then test the UI.
    const email = uniqueEmail();
    const res = await request.post('/api/auth/sign-up/email', {
      data: { name: 'E2E Login', email, password: PASSWORD, firstName: 'E2E', lastName: 'Login' },
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

  test('preserves ?next= return path through login (deep link to /arenas/new)', async ({ page, request }) => {
    // Seed an account via the API so this test exercises just the redirect flow.
    const email = uniqueEmail();
    await request.post('/api/auth/sign-up/email', {
      data: { name: 'E2E Deep Link', email, password: PASSWORD, firstName: 'E2E', lastName: 'DeepLink' },
    });

    // Hitting the auth-gated page as a guest should send us to /login with `next`.
    await page.goto('/arenas/new');
    await expect(page).toHaveURL(/\/login\?next=%2Farenas%2Fnew$/);

    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Lands on the original destination, not the default /arenas.
    await expect(page).toHaveURL('/arenas/new');
    await expect(page.getByRole('heading', { name: /Create a new arena/i })).toBeVisible();
  });
});
