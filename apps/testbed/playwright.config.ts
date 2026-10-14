import { defineConfig } from '@playwright/test';

/**
 * Gesture tests: drive the real testbed with a mouse and touch, check where
 * modules land in the store. Run with `npm run e2e` from the repo root.
 * First time on a new machine: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 1000 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM, args: ['--headless=new'] } : {},
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
  },
});
