import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:4200',
    channel: process.env.E2E_BROWSER_CHANNEL,
    ignoreHTTPSErrors: process.env.E2E_IGNORE_TLS === 'true',
    trace: 'retain-on-failure',
  },
});
