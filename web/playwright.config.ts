import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test (CLAUDE.md §14): login → approve transfer, against the running portal (:3100), API (:4100),
 * live Fabric network and Mailpit (:8126). Start them first (`npm run dev` here and in ../backend).
 * PLAYWRIGHT_CHROMIUM_PATH points at a pre-installed Chromium when the bundled one is not downloaded.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3100',
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
