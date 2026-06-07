import { test, expect } from '@playwright/test';
import { uniqueEmail, PASSWORD, fillRegisterForm } from './helpers';

async function registerFreshUser(page, email = uniqueEmail()) {
  await page.goto('/register');
  await fillRegisterForm(page, { firstName: 'Arena', lastName: 'Maker', email });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/arenas');
  return email;
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
    
    // In Phase 5, the input is hidden inside the Add modal. We assert that the Add button is visible instead.
    await expect(page.getByRole('button', { name: 'Add', exact: true }).first()).toBeEnabled();
  });

  test('a guest sees arenas read-only', async ({ page, request }) => {
    // Create an arena via a registered account, then visit it as a guest.
    const email = uniqueEmail();
    await request.post('/api/auth/sign-up/email', {
      data: { name: 'Owner', email, password: PASSWORD, firstName: 'Owner', lastName: 'Account' },
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
    
    // In Phase 5, the prep input placeholder doesn't exist for guests. Instead, they see the read-only notice banner.
    await expect(page.getByText("You're viewing this arena. Only its owner and organizers can manage it.")).toBeVisible();
  });

  test('a second user can join an arena', async ({ page }) => {
    // User A creates an arena.
    const emailA = await registerFreshUser(page);
    const arenaName = `Joinable Arena ${Date.now()}`;
    await createArenaFromDirectory(page, arenaName);
    await expect(page).toHaveURL(/\/arena\/.+/);
    const arenaUrl = page.url();

    // User A signs out; user B registers and opens the arena.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    const emailB = await registerFreshUser(page);
    await page.goto(arenaUrl);

    // User B is not a member yet — clicks "Request to join"
    const joinButton = page.getByRole('button', { name: 'Request to join' });
    await expect(joinButton).toBeVisible();
    await joinButton.click();

    // Shows pending state for User B
    await expect(page.getByText('Request pending approval')).toBeVisible();
    await expect(joinButton).toBeHidden();

    // User B signs out
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Log back in as User A (owner) to approve User B
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(emailA);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/arenas');
    await page.goto(arenaUrl);

    // Open members tab, navigate to Requests pill, and approve
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('tab', { name: /Requests/ }).click();
    await page.getByRole('button', { name: 'Accept' }).click();
    // Wait for the approval to round-trip before signing out: the request
    // row disappears (list re-renders from the server) only after the
    // membership is persisted, so this removes the race where User B logs
    // in before approveJoinRequest commits.
    await expect(page.getByText('No pending requests.')).toBeVisible();

    // User A signs out
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Log back in as User B
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(emailB);
    await page.getByPlaceholder('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/arenas');
    await page.goto(arenaUrl);

    // User B is now a member
    await expect(page.getByText(/You're a member of this arena/)).toBeVisible();
  });
});
