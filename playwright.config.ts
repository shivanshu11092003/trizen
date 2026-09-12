import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Codex images may already provide a newer shared Chromium build. Normal local
// and CI installs fall back to Playwright's own managed executable.
const sharedChromium = '/home/phenom/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: existsSync(sharedChromium) ? { executablePath: sharedChromium } : undefined,
  },
  webServer: {
    command: 'pnpm --filter web dev --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
