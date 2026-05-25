import { test, expect } from '@playwright/test';

/** A fresh email per call so e2e runs never collide on the unique constraint. */
const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
const PASSWORD = 'e2epassword123';

/**
 * Fill every required field on the register form. The page demands first/last
 * name, email, password, phone, address, birthday, and gender — anything less
 * trips the client-side guard before the submit reaches Better Auth.
 */
async function fillRegisterForm(page, { email = uniqueEmail(), password = PASSWORD } = {}) {
  await page.getByPlaceholder('First name').fill('E2E');
  await page.getByPlaceholder('Last name').fill('Organizer');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min. 8 characters)').fill(password);
  await page.getByPlaceholder('Phone number').fill('5550100');
  await page.getByPlaceholder('Address').fill('123 Court Lane');
  await page.locator('input[type="date"]').fill('1995-01-01');
  await page.locator('select').selectOption('Prefer not to say');
}

test.describe('registration', () => {
  test('creates an account and lands signed in on the directory', async ({ page }) => {
    await page.goto('/register');
    await fillRegisterForm(page);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/arenas');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('rejects a password shorter than 8 characters', async ({ page }) => {
    await page.goto('/register');
    // Fill all the required fields so the client-side completeness guard passes
    // and the test actually exercises the password-length branch.
    await fillRegisterForm(page, { password: 'short' });
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

  test('preserves ?next= return path through login (deep link to /arenas/new)', async ({ page, request }) => {
    // Seed an account via the API so this test exercises just the redirect flow.
    const email = uniqueEmail();
    await request.post('/api/auth/sign-up/email', {
      data: { name: 'E2E Deep Link', email, password: PASSWORD },
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
