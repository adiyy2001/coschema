import { defineConfig, devices } from '@playwright/test';

export const PAGES_PORT = 4337;

export default defineConfig({
  testDir: './pages',
  outputDir: './test-results/pages',
  globalSetup: './support/pages-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/pages' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PAGES_PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: undefined } }],
});
