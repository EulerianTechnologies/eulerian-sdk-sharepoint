import { defineConfig, devices } from '@playwright/test';

// The harness keeps hits in memory and tests reset it: run serially.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../temp/playwright-report' }]] : 'list',
  outputDir: '../temp/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:8401',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'perl harness.pl',
    cwd: __dirname,
    url: 'http://127.0.0.1:8402/hits',
    reuseExistingServer: !process.env.CI,
    env: { HARNESS_LOG_LEVEL: 'warn' }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ]
});
