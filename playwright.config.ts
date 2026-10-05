import { defineConfig } from '@playwright/test';

/**
 * Playwright Test config for the Login Authentication target.
 *
 *   npx playwright test                # headless
 *   npx playwright test --headed       # watch the browser
 *   npx playwright test --ui           # interactive UI mode
 *
 * The built-in `webServer` block boots the studio (FastAPI) automatically and
 * reuses an already running instance, so `start_mac.sh` / `start.bat` can stay open.
 * On Windows/macOS change `python` to whichever command you used for setup
 * (e.g. `python3`, or `.venv/bin/python`).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python -m uvicorn app.server:app --host 127.0.0.1 --port 8000',
    url: 'http://127.0.0.1:8000/api/auth/users',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
