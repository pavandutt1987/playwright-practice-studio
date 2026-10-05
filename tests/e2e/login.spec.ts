import { test, expect } from '@playwright/test';

/**
 * End-to-end suite for the Login Authentication playground target.
 * Run with:  npx playwright test
 *
 * The page is deliberately loaded with real HTTP calls (no route mocking) so the
 * suite covers the FastAPI auth API, the HttpOnly session cookie and the DOM.
 */

const VALID = { username: 'admin', password: 'password123' };

test.beforeEach(async ({ request }) => {
  // Clear any lockout left over from a previous run.
  await request.delete('/api/auth/attempts/admin');
  await request.post('/api/auth/logout');
});

test.describe('Login Authentication target', () => {
  test('signs in with valid credentials and renders the session banner', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill(VALID.username);
    await page.getByLabel('Password').fill(VALID.password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByTestId('welcome-banner')).toBeVisible();
    await expect(page.getByTestId('welcome-banner')).toContainText('Alex Admin');
    await expect(page.getByTestId('session-username')).toHaveText('admin');
    await expect(page.getByTestId('session-role')).toHaveText('Administrator');
    await expect(page.getByTestId('login-view')).toBeHidden();
  });

  test('shows inline validation errors when fields are empty', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-button').click();

    await expect(page.getByTestId('username-error')).toHaveText('Username is required.');
    await expect(page.getByTestId('password-error')).toHaveText('Password is required.');
    await expect(page.getByLabel('Username')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('status-message')).toHaveAttribute('data-state', 'validation');
  });

  test('rejects a wrong password with the 401 error state', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill(VALID.username);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByTestId('login-button').click();

    const status = page.getByTestId('status-message');
    await expect(status).toHaveAttribute('data-state', 'invalid-credentials');
    await expect(status).toContainText('Invalid username or password');
    await expect(page.getByTestId('attempts-counter')).toContainText('4 of 5 attempts remaining');
    await expect(page.getByTestId('welcome-banner')).toBeHidden();
  });

  test('keeps the session across a reload when Remember me is checked', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill(VALID.username);
    await page.getByLabel('Password').fill(VALID.password);
    await page.getByTestId('remember-checkbox').check();
    await page.getByTestId('login-button').click();
    await expect(page.getByTestId('welcome-banner')).toBeVisible();

    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === 'pps_session');
    expect(session, 'pps_session cookie should be set').toBeTruthy();
    expect(session!.httpOnly).toBe(true);
    expect(session!.expires).not.toBe(-1); // persistent cookie => "remembered"

    await page.reload();
    await expect(page.getByTestId('welcome-banner')).toBeVisible();
    await expect(page.getByTestId('session-username')).toHaveText('admin');
  });

  test('uses a session cookie when Remember me is unchecked', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill(VALID.username);
    await page.getByLabel('Password').fill(VALID.password);
    await page.getByTestId('login-button').click();
    await expect(page.getByTestId('welcome-banner')).toBeVisible();

    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === 'pps_session');
    expect(session).toBeTruthy();
    expect(session!.expires).toBe(-1);
  });

  test('signing out returns to the login form and ends the session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill(VALID.username);
    await page.getByLabel('Password').fill(VALID.password);
    await page.getByTestId('login-button').click();
    await expect(page.getByTestId('welcome-banner')).toBeVisible();

    await page.getByTestId('logout-button').click();
    await expect(page.getByTestId('login-view')).toBeVisible();
    await expect(page.getByTestId('status-message')).toContainText('signed out');

    await page.reload();
    await expect(page.getByTestId('login-view')).toBeVisible();
    await expect(page.getByTestId('welcome-banner')).toBeHidden();
  });

  test('blocks a locked-out account even with the right password', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Username').fill('locked_out_user');
    await page.getByLabel('Password').fill('locked123');
    await page.getByTestId('login-button').click();

    await expect(page.getByTestId('status-message')).toHaveAttribute('data-state', 'account-locked');
    await expect(page.getByTestId('status-message')).toContainText('locked out');
  });

  test('toggles password visibility', async ({ page }) => {
    await page.goto('/login');
    const password = page.getByLabel('Password');

    await expect(password).toHaveAttribute('type', 'password');
    await page.getByTestId('toggle-password').click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByTestId('toggle-password').click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  test('locks the form temporarily after five failed attempts (429)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill(VALID.username);
    await page.getByLabel('Password').fill('nope');

    for (let attempt = 0; attempt < 5; attempt++) {
      await page.getByTestId('login-button').click();
      await expect(page.getByTestId('login-button')).toBeEnabled();
    }

    const status = page.getByTestId('status-message');
    await expect(status).toContainText('Try again in');
    await expect(page.getByTestId('login-button')).toBeDisabled();
  });
});
