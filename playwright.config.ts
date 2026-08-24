import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:4173/Finance-Pocket-App/',
    // In environments with a pre-installed browser (no `playwright install`),
    // point CHROMIUM_PATH at it; unset means Playwright's own download.
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
    // The share-target and update-prompt flows depend on a real service worker.
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/Finance-Pocket-App/',
    reuseExistingServer: true,
  },
});
