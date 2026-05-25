/** Shared Playwright helpers. Keep both spec files in sync via this module. */

/** A fresh email per call so e2e runs never collide on the unique constraint. */
export const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
export const PASSWORD = 'e2epassword123';

/**
 * Fill every required field on the register form. The page demands first/last
 * name, email, password, phone, address, birthday, and gender — anything less
 * trips the client-side guard before submit reaches Better Auth. Single source
 * of truth so a form change can't break one spec file while the other passes.
 */
export async function fillRegisterForm(page, {
  firstName = 'E2E',
  lastName = 'Organizer',
  email = uniqueEmail(),
  password = PASSWORD,
} = {}) {
  await page.getByPlaceholder('First name').fill(firstName);
  await page.getByPlaceholder('Last name').fill(lastName);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min. 8 characters)').fill(password);
  await page.getByPlaceholder('Phone number').fill('5550100');
  await page.getByPlaceholder('Address').fill('123 Court Lane');
  await page.locator('input[type="date"]').fill('1995-01-01');
  await page.locator('select').selectOption('Prefer not to say');
}
