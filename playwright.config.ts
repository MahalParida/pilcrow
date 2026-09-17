import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: process.env.RECORD_DEMO ? [] : ['**/demo.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: { command: 'node tests/e2e/server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
