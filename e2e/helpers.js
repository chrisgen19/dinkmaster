/** Shared Playwright helpers. Keep both spec files in sync via this module. */

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
